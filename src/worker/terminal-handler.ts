/**
 * Terminal handler: procesa jobs de la cola "terminal-sessions".
 *
 * Cada job es un turno de la terminal (turn, save, close).
 * El Agent SDK se ejecuta con resume: sessionId para mantener contexto.
 * Los mensajes se publican a un Redis stream para SSE al browser.
 *
 * Flujo por turno:
 * 1. Checkout rama del plan
 * 2. query({ prompt, options: { resume: sessionId, persistSession: true } })
 * 3. Iterar messages → publicar a Redis stream
 * 4. Al completar: guardar session_id, actualizar costo
 */

import { Worker, Job } from "bullmq";
import { query, type SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import { Decimal } from "@prisma/client/runtime/library";
import { redisBullMQ } from "@/lib/redis-connection";
import { redis } from "@/lib/redis";
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
  sanitizePat,
} from "./repo-manager";
import { acquirePlanLock } from "./plan-lock";
import type { TerminalJobData } from "@/server/jobs/queues";

// ─── Stream helpers ──────────────────────────────────────────────────────────

function streamKey(sessionId: string): string {
  return `terminal:${sessionId}`;
}

async function publish(sessionId: string, msg: Record<string, unknown>): Promise<void> {
  await redis.xadd(
    streamKey(sessionId),
    "MAXLEN", "~", "500",
    "*",
    "data", JSON.stringify(msg)
  );
}

// ─── Turn handler ────────────────────────────────────────────────────────────

async function handleTurn(job: Job<TerminalJobData>): Promise<void> {
  const { sessionId, prompt } = job.data;
  if (!prompt) return;

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
        // Publish relevant messages to the stream
        if (message.type === "assistant" && "content" in message) {
          const textBlocks = (message.content as Array<{ type: string; text?: string }>)
            .filter((b) => b.type === "text" && b.text)
            .map((b) => b.text)
            .join("");
          if (textBlocks) {
            await publish(sessionId, { type: "agent_text", text: textBlocks });
          }

          // Tool use blocks
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

            await publish(sessionId, {
              type: "result",
              text: result.result ?? "",
              is_error: false,
            });
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

      // Update session with new cost and session ID
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

  await publish(sessionId, { type: "status", status: "saving" });

  try {
    const dir = await ensureRepoPlanBranch(site.githubRepo, site.defaultBranch, session.plan.branchName);

    if (!hasDiff(dir)) {
      await publish(sessionId, { type: "save_result", saved: false, message: "Sin cambios para guardar." });
      await publish(sessionId, { type: "status", status: "idle" });
      return;
    }

    // Build check
    cleanBuildCache(dir);
    const buildResult = verifyBuild(dir);
    if (!buildResult.passed) {
      await publish(sessionId, {
        type: "save_result",
        saved: false,
        message: `Build falló: ${(buildResult.logTail ?? "").slice(0, 200)}`,
      });
      await publish(sessionId, { type: "status", status: "idle" });
      return;
    }

    // Placeholder guard (warning, not blocking — terminal user decides)
    const { scanPlaceholders: scanLocal, formatPlaceholderHits } = await import("./placeholder-guard");
    const hits = scanLocal(dir);
    if (hits.length > 0) {
      await publish(sessionId, {
        type: "save_warning",
        message: `${hits.length} marcador(es) [COMPLETAR encontrados. Se guardarán de todas formas.`,
        detail: formatPlaceholderHits(hits),
      });
    }

    // Commit + push
    const commitTag = session.taskId ? session.taskId : "plan-review";
    const sha = commitStep(dir, session.plan.branchName, commitTag, "Cambios desde terminal");

    if (sha) {
      // Update PR
      try {
        const { createOrUpdatePlanPR: updatePR } = await import("./repo-manager");
        await updatePR({
          githubRepo: site.githubRepo,
          planBranch: session.plan.branchName,
          defaultBranch: site.defaultBranch,
          title: `Plan ${session.plan.month}`,
          body: `_Actualizado desde terminal (sesión ${sessionId.slice(0, 8)})_`,
        });
      } catch { /* PR update is best-effort */ }

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

// ─── Close handler ───────────────────────────────────────────────────────────

async function handleClose(job: Job<TerminalJobData>): Promise<void> {
  const { sessionId } = job.data;

  const session = await prisma.terminalSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { plan: { select: { id: true, branchName: true } } },
  });

  // If there are unsaved changes, commit to wip branch
  const site = await prisma.site.findFirst({
    where: { client: { monthlyPlans: { some: { id: session.planId } } } },
    select: { githubRepo: true, defaultBranch: true },
  });

  if (site?.githubRepo && session.plan.branchName) {
    try {
      const dir = await ensureRepoPlanBranch(site.githubRepo, site.defaultBranch, session.plan.branchName);
      if (hasDiff(dir)) {
        // WIP commit — never lose work
        const wipBranch = `wip/terminal-${sessionId.slice(0, 8)}`;
        const { execSync } = await import("child_process");
        execSync(`git checkout -b ${wipBranch}`, { cwd: dir, timeout: 10_000 });
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

  // Persist bitácora from Redis stream
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

  // Release plan lock
  const lock = await acquirePlanLock(session.planId);
  if (lock.acquired) await lock.release(); // will fail if we don't hold it — that's OK

  // Clean up stream (TTL 24h)
  await redis.expire(streamKey(sessionId), 86400);

  await publish(sessionId, { type: "status", status: "closed" });

  console.log(`[terminal] Session ${sessionId.slice(0, 8)} closed`);
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

export { worker as terminalWorker };
