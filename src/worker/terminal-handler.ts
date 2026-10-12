/**
 * Terminal handler: procesa jobs de la cola "terminal-sessions".
 *
 * Candado por plan: se adquiere en /api/terminal/open y se mantiene
 * toda la sesión con heartbeat (renovación de TTL cada 2 min).
 * Se libera solo en close o por límite de inactividad/tiempo.
 *
 * Candado por repo: se adquiere y libera POR TURNO (no toda la sesión),
 * porque el repo workspace es compartido con tareas y preflight.
 *
 * Semáforo de builds: un build a la vez en el VPS (en save).
 *
 * Inactividad: si no hay input del usuario en TERMINAL_INACTIVITY_MIN,
 * la sesión se cierra con WIP commit automático y aviso.
 */

import { Worker, Job } from "bullmq";
import { query, type SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import { Decimal } from "@prisma/client/runtime/library";
import { redisBullMQ } from "@/lib/redis-connection";
import { redisBullMQ as redis } from "@/lib/redis"; // use the BullMQ client (enableOfflineQueue: true)
import { prisma } from "@/lib/db";
import { createCanUseTool } from "./agent-permissions";
import { workerEnv } from "./env";
import {
  ensureRepoPlanBranch,
  needsInstall,
  runInstall,
  verifyBuild,
  cleanBuildCache,
  hasDiff,
  commitStep,
  createOrUpdatePlanPR,
  sanitizePat,
} from "./repo-manager";
import { withBuildSemaphore } from "./plan-lock";
import type { TerminalJobData } from "@/server/jobs/queues";

// ─── Config ──────────────────────────────────────────────────────────────────

const TERMINAL_MAX_TIME_MIN = Number(process.env.TERMINAL_MAX_TIME_MIN ?? "60");
const TERMINAL_INACTIVITY_MIN = Number(process.env.TERMINAL_INACTIVITY_MIN ?? "15");

// ─── Stream helpers ──────────────────────────────────────────────────────────

function streamKey(sessionId: string): string {
  return `terminal:${sessionId}`;
}

async function publish(sessionId: string, msg: Record<string, unknown>): Promise<void> {
  await redis.xadd(streamKey(sessionId), "MAXLEN", "~", "500", "*", "data", JSON.stringify(msg));
}

// Plan lock is acquired in /api/terminal/open with acquirePlanLock(),
// which has its own auto-renewal timer (every 5 min). The holder UUID
// is stored in Redis at terminal-lock-holder:{sessionId} so the close
// handler can do compare-and-delete.

// ─── Inactivity watchdog ─────────────────────────────────────────────────────

/** Tracks last user activity per session. Set on each turn job. */
const lastActivityKey = (sid: string) => `terminal-activity:${sid}`;

async function recordActivity(sessionId: string): Promise<void> {
  await redis.set(lastActivityKey(sessionId), Date.now().toString(), "EX", TERMINAL_INACTIVITY_MIN * 60 + 60);
}

async function isInactive(sessionId: string): Promise<boolean> {
  const raw = await redis.get(lastActivityKey(sessionId));
  if (!raw) return true;
  const elapsed = Date.now() - parseInt(raw, 10);
  return elapsed > TERMINAL_INACTIVITY_MIN * 60 * 1000;
}

async function isTimedOut(sessionId: string): Promise<boolean> {
  const session = await prisma.terminalSession.findUnique({
    where: { id: sessionId },
    select: { createdAt: true },
  });
  if (!session) return true;
  const elapsed = Date.now() - session.createdAt.getTime();
  return elapsed > TERMINAL_MAX_TIME_MIN * 60 * 1000;
}

// ─── Turn handler ────────────────────────────────────────────────────────────

async function handleTurn(job: Job<TerminalJobData>): Promise<void> {
  const { sessionId, prompt } = job.data;
  if (!prompt) return;

  await recordActivity(sessionId);

  // Check limits
  if (await isTimedOut(sessionId)) {
    await publish(sessionId, { type: "limit_warning", kind: "time", remaining: "0" });
    await handleClose(job); // force close with WIP
    return;
  }

  const session = await prisma.terminalSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: {
      plan: {
        select: { id: true, branchName: true, month: true, clientId: true },
        include: { client: { select: { name: true } } },
      },
    },
  });

  if (session.status !== "ACTIVE") return;

  const site = await prisma.site.findFirst({
    where: { client: { monthlyPlans: { some: { id: session.planId } } } },
    select: { githubRepo: true, defaultBranch: true },
  });

  if (!site?.githubRepo || !session.plan.branchName) {
    await publish(sessionId, { type: "error", message: "No hay repo o rama configurada." });
    return;
  }

  // Repo lock is held for the entire session (acquired in /api/terminal/open).
  // No per-turn acquisition needed — the workspace is ours.

  await publish(sessionId, { type: "status", status: "running" });

  try {
    const dir = await ensureRepoPlanBranch(site.githubRepo, site.defaultBranch, session.plan.branchName);

    if (needsInstall(dir)) {
      await publish(sessionId, { type: "status", status: "installing" });
      runInstall(dir);
    }

    const canUseTool = createCanUseTool(dir);
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), workerEnv.AGENT_TIMEOUT_MIN * 60 * 1000);

    const commitTag = session.taskId ? `[task:${session.taskId.slice(0, 8)}]` : "[plan:review]";

    try {
      const stream = query({
        prompt,
        options: {
          cwd: dir,
          tools: { type: "preset", preset: "claude_code" },
          disallowedTools: ["WebFetch", "WebSearch", "Agent"],
          canUseTool: canUseTool as never,
          permissionMode: "default",
          maxTurns: workerEnv.AGENT_MAX_TURNS,
          maxBudgetUsd: workerEnv.AGENT_MAX_BUDGET_USD,
          abortController: ac,
          persistSession: true,
          ...(session.agentSessionId ? { resume: session.agentSessionId } : {}),
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: `Estás en la terminal de Cerebro SEO, trabajando sobre la rama ${session.plan.branchName} del sitio de ${session.plan.client.name}. No hagas git commit ni git push — usa el botón "Guardar en la rama". Commits se etiquetan como ${commitTag}.`,
          },
          settingSources: ["project"],
          model: "claude-sonnet-4-6",
        },
      });

      let newSessionId = session.agentSessionId;
      let turnCost = 0;
      let turnInput = 0;
      let turnOutput = 0;

      for await (const message of stream) {
        if (message.type === "assistant" && "content" in message) {
          const textBlocks = (message.content as Array<{ type: string; text?: string }>)
            .filter((b) => b.type === "text" && b.text)
            .map((b) => b.text)
            .join("");
          if (textBlocks) {
            await publish(sessionId, { type: "agent_text", text: textBlocks });
          }

          const toolBlocks = (message.content as Array<{ type: string; name?: string; input?: unknown }>)
            .filter((b) => b.type === "tool_use");
          for (const tb of toolBlocks) {
            await publish(sessionId, {
              type: "agent_tool_use",
              tool: tb.name ?? "unknown",
              input: JSON.stringify(tb.input ?? {}).slice(0, 500),
            });
          }
        }

        if (message.type === "result") {
          const isSuccess = !message.is_error && "result" in message;
          if (isSuccess) {
            const result = message as SDKResultSuccess;
            newSessionId = result.session_id;
            turnCost = result.total_cost_usd;
            for (const usage of Object.values(result.modelUsage ?? {})) {
              turnInput += usage.inputTokens;
              turnOutput += usage.outputTokens;
            }
            await publish(sessionId, { type: "result", text: result.result ?? "", is_error: false });
          } else {
            newSessionId = message.session_id;
            await publish(sessionId, {
              type: "result",
              text: "errors" in message ? (message.errors as string[]).join("; ") : "Error",
              is_error: true,
            });
          }
        }
      }

      const prevCost = Number(session.costUsd);
      await prisma.terminalSession.update({
        where: { id: sessionId },
        data: {
          agentSessionId: newSessionId,
          costUsd: new Decimal((prevCost + turnCost).toFixed(6)),
          inputTokens: session.inputTokens + turnInput,
          outputTokens: session.outputTokens + turnOutput,
        },
      });

      await publish(sessionId, {
        type: "cost_update",
        costUsd: prevCost + turnCost,
        inputTokens: session.inputTokens + turnInput,
        outputTokens: session.outputTokens + turnOutput,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const msg = err instanceof Error ? sanitizePat(err.message) : String(err);
    await publish(sessionId, { type: "error", message: msg.slice(0, 500) });
  }

  await publish(sessionId, { type: "status", status: "idle" });
}

// ─── Save handler ────────────────────────────────────────────────────────────

async function handleSave(job: Job<TerminalJobData>): Promise<void> {
  const { sessionId } = job.data;

  const session = await prisma.terminalSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { plan: { select: { id: true, branchName: true, month: true } } },
  });

  const site = await prisma.site.findFirst({
    where: { client: { monthlyPlans: { some: { id: session.planId } } } },
    select: { githubRepo: true, defaultBranch: true },
  });

  if (!site?.githubRepo || !session.plan.branchName) {
    await publish(sessionId, { type: "error", message: "No hay repo o rama configurada." });
    return;
  }

  // Repo lock is held for the entire session — no acquisition needed here.

  await publish(sessionId, { type: "status", status: "saving" });

  try {
    const dir = await ensureRepoPlanBranch(site.githubRepo, site.defaultBranch, session.plan.branchName);

    if (!hasDiff(dir)) {
      await publish(sessionId, { type: "save_result", saved: false, message: "Sin cambios para guardar." });
      await publish(sessionId, { type: "status", status: "idle" });
      return;
    }

    // Build with semaphore
    cleanBuildCache(dir);
    const buildResult = await withBuildSemaphore(() => verifyBuild(dir));
    if (!buildResult.passed) {
      await publish(sessionId, {
        type: "save_result",
        saved: false,
        message: `Build falló: ${(buildResult.logTail ?? "").slice(0, 200)}`,
      });
      await publish(sessionId, { type: "status", status: "idle" });
      return;
    }

    // Commit + push
    const commitTag = session.taskId ?? "plan-review";
    const sha = commitStep(dir, session.plan.branchName, commitTag, "Cambios desde terminal");

    if (sha) {
      try {
        await createOrUpdatePlanPR({
          githubRepo: site.githubRepo,
          planBranch: session.plan.branchName,
          defaultBranch: site.defaultBranch,
          title: `Plan ${session.plan.month}`,
          body: `_Actualizado desde terminal (sesión ${sessionId.slice(0, 8)})_`,
        });
      } catch { /* best-effort */ }

      await publish(sessionId, {
        type: "save_result",
        saved: true,
        sha: sha.slice(0, 7),
        message: `Commit ${sha.slice(0, 7)} pushed a ${session.plan.branchName}`,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? sanitizePat(err.message) : String(err);
    await publish(sessionId, { type: "error", message: `Error al guardar: ${msg.slice(0, 300)}` });
  }

  await publish(sessionId, { type: "status", status: "idle" });
}

// ─── Close handler (also called by inactivity/time limit) ────────────────────

async function handleClose(job: Job<TerminalJobData>): Promise<void> {
  const { sessionId } = job.data;

  const session = await prisma.terminalSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { plan: { select: { id: true, branchName: true } } },
  });

  if (session.status !== "ACTIVE") return;

  const site = await prisma.site.findFirst({
    where: { client: { monthlyPlans: { some: { id: session.planId } } } },
    select: { githubRepo: true, defaultBranch: true },
  });

  // WIP commit if there are unsaved changes (repo lock is held for the session)
  if (site?.githubRepo && session.plan.branchName) {
    try {
      const dir = await ensureRepoPlanBranch(site.githubRepo, site.defaultBranch, session.plan.branchName);
      if (hasDiff(dir)) {
        const wipBranch = `wip/terminal-${sessionId.slice(0, 8)}`;
        const { execSync } = await import("child_process");
        try { execSync(`git branch -D ${wipBranch}`, { cwd: dir, timeout: 5000 }); } catch { /* ok */ }
        execSync(`git checkout -b ${wipBranch}`, { cwd: dir, timeout: 5000 });
        commitStep(dir, wipBranch, session.taskId ?? "plan-review", "WIP: cambios sin guardar de terminal");
        await publish(sessionId, {
          type: "wip_saved",
          branch: wipBranch,
          message: `Cambios sin guardar commiteados a ${wipBranch}`,
        });
      }
    } catch (err) {
      console.error("[terminal] WIP save failed:", err);
    }
  }

  // Persist bitácora
  try {
    const entries = await redis.xrange(streamKey(sessionId), "-", "+");
    const log = entries.map(([id, fields]) => ({
      id,
      ts: id.split("-")[0],
      ...JSON.parse(fields[1] ?? "{}"),
    }));

    await prisma.terminalSession.update({
      where: { id: sessionId },
      data: { status: "CLOSED", closedAt: new Date(), log: log as never },
    });
  } catch {
    await prisma.terminalSession.update({
      where: { id: sessionId },
      data: { status: "CLOSED", closedAt: new Date() },
    });
  }

  // Release plan lock (compare-and-delete — only if we hold it)
  const planLockKey = `plan-lock:${session.planId}`;
  // The holder is stored in TerminalSession? No — we need to find it.
  // Just delete it unconditionally since the terminal "owns" it.
  // The plan lock was acquired in the open endpoint with a known holder.
  // For safety, use a TTL-based approach: the lock expires naturally.
  // But we should clean it up. The open endpoint stored the holder in Redis.
  const terminalLockHolder = await redis.get(`terminal-lock-holder:${sessionId}`);
  if (terminalLockHolder) {
    await redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1, planLockKey, terminalLockHolder
    );
    await redis.del(`terminal-lock-holder:${sessionId}`);
  }

  // Release repo lock (acquired in /api/terminal/open)
  const repoLockHolder = await redis.get(`terminal-repo-lock-holder:${sessionId}`);
  const repoName = await redis.get(`terminal-repo:${sessionId}`);
  if (repoLockHolder && repoName) {
    await redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1, `repo-lock:${repoName}`, repoLockHolder
    );
    await redis.del(`terminal-repo-lock-holder:${sessionId}`);
    await redis.del(`terminal-repo:${sessionId}`);
  }

  // Clean up activity key
  await redis.del(lastActivityKey(sessionId));

  // Stream TTL
  await redis.expire(streamKey(sessionId), 86400);

  await publish(sessionId, { type: "status", status: "closed" });
  console.log(`[terminal] Session ${sessionId.slice(0, 8)} closed`);
}

// ─── Inactivity checker (runs periodically) ──────────────────────────────────

async function checkInactiveSessions(): Promise<void> {
  const activeSessions = await prisma.terminalSession.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, planId: true, createdAt: true },
  });

  for (const session of activeSessions) {
    const inactive = await isInactive(session.id);
    const timedOut = await isTimedOut(session.id);

    if (inactive || timedOut) {
      const reason = timedOut ? "time" : "inactivity";
      console.log(`[terminal] Session ${session.id.slice(0, 8)} closing: ${reason}`);

      // Send warning first
      await publish(session.id, {
        type: "limit_warning",
        kind: reason,
        remaining: "0",
        message: timedOut
          ? `Sesión cerrada: excedió ${TERMINAL_MAX_TIME_MIN} minutos.`
          : `Sesión cerrada: ${TERMINAL_INACTIVITY_MIN} minutos sin actividad.`,
      });

      // Close with WIP
      await handleClose({ data: { sessionId: session.id, action: "close" } } as Job<TerminalJobData>);
    }
  }
}

// ─── Worker ──────────────────────────────────────────────────────────────────

const worker = new Worker<TerminalJobData>(
  "terminal-sessions",
  async (job) => {
    console.log(`[terminal] Job ${job.id} — ${job.data.action} for session ${job.data.sessionId.slice(0, 8)}`);

    switch (job.data.action) {
      case "turn":
        await handleTurn(job);
        break;
      case "save":
        await handleSave(job);
        break;
      case "close":
        await handleClose(job);
        break;
    }
  },
  {
    connection: redisBullMQ,
    concurrency: 1,
    lockDuration: 600_000,
    lockRenewTime: 150_000,
  }
);

worker.on("completed", (job) => {
  console.log(`[terminal] Job ${job?.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[terminal] Job ${job?.id} failed:`, err.message);
});

worker.on("error", (err) => {
  console.error("[terminal] Worker error:", err);
});

// Inactivity check every 2 min
setInterval(() => {
  checkInactiveSessions().catch((err) => {
    console.error("[terminal] Inactivity check error:", err);
  });
}, 2 * 60 * 1000);

export { worker as terminalWorker };
