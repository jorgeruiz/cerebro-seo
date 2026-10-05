/**
 * Procesador de tareas del plan mensual.
 *
 * Flujo por tarea:
 * 1. Cargar task + site. Validar githubRepo.
 * 2. Clonar/actualizar repo. Crear rama cr/<taskId>.
 * 3. Clasificar memoria del sitio. Si AUTO + incompleta → FAILED.
 * 4. npm ci si cambió lockfile.
 * 5. Ejecutar Agent SDK query() con prompt compuesto.
 * 6. Verificar build (npm run build).
 * 7. Commit, push, crear PR.
 * 8. Actualizar task → PREVIEW, run → SUCCEEDED.
 */

import { query, type SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import { Decimal } from "@prisma/client/runtime/library";
import type { InputJsonValue } from "@prisma/client/runtime/library";
import { createCanUseTool } from "./agent-permissions";
import { prisma } from "@/lib/db";
import { logApiUsage } from "@/server/jobs/workers/base-worker";
import { workerEnv } from "./env";
import { classifyMemory, isMemoryComplete } from "./memory-classifier";
import {
  ensureRepo,
  checkoutBranch,
  branchName,
  needsInstall,
  runInstall,
  verifyBuild,
  hasDiff,
  commitAndPush,
  createPullRequest,
  getPreviewUrl,
  sanitizePat,
} from "./repo-manager";
import type { PlanTaskJobData } from "@/server/jobs/queues";

export async function processTask(jobData: PlanTaskJobData): Promise<void> {
  if (jobData.preflight) {
    return processPreflight(jobData);
  }

  const { taskId, triggeredById } = jobData;

  // ── 1. Cargar task + site ──────────────────────────────────────────────
  const task = await prisma.planTask.findUniqueOrThrow({
    where: { id: taskId },
    include: { site: true, plan: { select: { clientId: true } } },
  });

  const site = task.site;
  if (!site.githubRepo) {
    await failTask(taskId, "Site no tiene githubRepo configurado.");
    return;
  }

  // Status → RUNNING
  await prisma.planTask.update({
    where: { id: taskId },
    data: { status: "RUNNING" },
  });

  // Crear TaskRun
  const run = await prisma.taskRun.create({
    data: {
      taskId,
      kind: "AUTO",
      status: "RUNNING",
      triggeredById: triggeredById ?? null,
    },
  });

  try {
    // ── 2. Clonar/actualizar repo ──────────────────────────────────────
    console.log(`[plan-task] Ensuring repo ${site.githubRepo}...`);
    const dir = await ensureRepo(site.githubRepo, site.defaultBranch);

    const branch = branchName(taskId);
    checkoutBranch(dir, branch);

    await prisma.planTask.update({
      where: { id: taskId },
      data: { branchName: branch },
    });

    // ── 3. Clasificar memoria ──────────────────────────────────────────
    const memoryStatus = await classifyMemory(dir);
    await prisma.taskRun.update({
      where: { id: run.id },
      data: { memoryStatus: memoryStatus as unknown as InputJsonValue },
    });

    if (task.lane === "AUTO" && !isMemoryComplete(memoryStatus)) {
      await failRun(run.id, "MEMORY_INCOMPLETE", JSON.stringify(memoryStatus));
      await failTask(taskId, "MEMORY_INCOMPLETE");
      return;
    }

    // ── 4. npm ci si lockfile cambió ───────────────────────────────────
    if (needsInstall(dir)) {
      console.log(`[plan-task] Running npm ci --include=dev...`);
      try {
        runInstall(dir);
      } catch (installErr) {
        const installMsg = installErr instanceof Error ? installErr.message : String(installErr);
        if (installMsg === "LOCKFILE_OUT_OF_SYNC") {
          await failRun(run.id, "LOCKFILE_OUT_OF_SYNC");
          await failTask(taskId, "LOCKFILE_OUT_OF_SYNC");
          return;
        }
        throw installErr;
      }
    }

    // ── 5. Agent SDK query() ───────────────────────────────────────────
    console.log(`[plan-task] Running agent for task "${task.title}"...`);
    const agentResult = await runAgent(dir, task, site.defaultBranch);

    await prisma.taskRun.update({
      where: { id: run.id },
      data: { agentSessionId: agentResult.sessionId },
    });

    // ── 6. Verificar build ─────────────────────────────────────────────
    console.log(`[plan-task] Verifying build...`);
    const buildResult = verifyBuild(dir);

    await prisma.taskRun.update({
      where: { id: run.id },
      data: { buildPassed: buildResult.passed },
    });

    if (!buildResult.passed) {
      await failRun(run.id, "BUILD_FAILED", buildResult.logTail);
      await failTask(taskId, `Build falló: ${(buildResult.logTail ?? "").slice(0, 200)}`);
      return;
    }

    // ── 6b. Parse structured result from agent ────────────────────────
    const structured = parseAgentResult(agentResult.resultText);
    console.log(`[plan-task] Agent summary: ${structured.summary.slice(0, 200)}`);

    // Sin cambios → check if justified
    if (!hasDiff(dir)) {
      if (structured.noChangeReason) {
        // Agent explained why no changes needed → SUCCEEDED, not FAILED
        console.log(`[plan-task] No changes needed: ${structured.noChangeReason}`);
        await prisma.taskRun.update({
          where: { id: run.id },
          data: {
            status: "SUCCEEDED",
            costUsd: new Decimal(agentResult.costUsd.toFixed(6)),
            inputTokens: agentResult.inputTokens,
            outputTokens: agentResult.outputTokens,
            logTail: JSON.stringify(structured),
            finishedAt: new Date(),
          },
        });
        await prisma.planTask.update({
          where: { id: taskId },
          data: { status: "MERGED", failureReason: `NO_CHANGES_NEEDED: ${structured.noChangeReason}` },
        });
        await logApiUsage({ provider: "anthropic", endpoint: "agent-sdk-plan-task", cost: agentResult.costUsd, clientId: task.plan.clientId });
        return;
      }
      // No changes and no justification → FAILED
      await failRun(run.id, "NO_CHANGES", JSON.stringify(structured));
      await failTask(taskId, "NO_CHANGES");
      return;
    }

    // ── 7. Commit, push, PR ────────────────────────────────────────────
    console.log(`[plan-task] Committing and creating PR...`);
    const sha = commitAndPush(dir, branch, `feat: ${task.title}`);

    const prBody = [
      `## ${task.title}`,
      "",
      `**Objetivo:** ${task.objective}`,
      "",
      "**Resumen del agente:**",
      structured.summary,
      "",
      structured.changedRoutes.length > 0 ? `**Rutas afectadas:** ${structured.changedRoutes.join(", ")}` : "",
      "",
      "**Criterios de aceptación:**",
      ...task.acceptanceCriteria.map((c) => `- ${c}`),
      "",
      `**Costo:** $${agentResult.costUsd.toFixed(4)} USD`,
      `**Run ID:** ${run.id}`,
      "",
      "---",
      "_Generado por Cerebro SEO Agent_",
    ].filter(Boolean).join("\n");

    const pr = await createPullRequest({
      githubRepo: site.githubRepo,
      branch,
      defaultBranch: site.defaultBranch,
      title: task.title,
      body: prBody,
    });

    // Intentar obtener preview URL
    const previewUrl = await getPreviewUrl(site.githubRepo, sha);

    // ── 8. Actualizar task y run ───────────────────────────────────────
    await prisma.planTask.update({
      where: { id: taskId },
      data: {
        status: "PREVIEW",
        prNumber: pr.number,
        prUrl: pr.url,
        previewUrl,
      },
    });

    await prisma.taskRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        commitSha: sha,
        costUsd: new Decimal(agentResult.costUsd.toFixed(6)),
        inputTokens: agentResult.inputTokens,
        outputTokens: agentResult.outputTokens,
        logTail: JSON.stringify(structured),
        finishedAt: new Date(),
      },
    });

    await logApiUsage({
      provider: "anthropic",
      endpoint: "agent-sdk-plan-task",
      cost: agentResult.costUsd,
      clientId: task.plan.clientId,
    });

    console.log(`[plan-task] ✓ Task "${task.title}" → PREVIEW (PR #${pr.number})`);
  } catch (err) {
    const errMsg = err instanceof Error ? sanitizePat(err.message) : String(err);
    console.error(`[plan-task] ✗ Task "${task.title}" failed:`, errMsg);

    await failRun(run.id, errMsg);
    await failTask(taskId, errMsg);
  }
}

// ─── Agent SDK ───────────────────────────────────────────────────────────────

interface AgentResult {
  sessionId: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  resultText: string; // raw text from the agent's final result
}

export interface AgentStructuredResult {
  summary: string;
  changedRoutes: string[];
  noChangeReason: string | null;
}

function parseAgentResult(text: string): AgentStructuredResult {
  // Try to extract JSON block from agent output
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/\{[\s\S]*"summary"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
      return {
        summary: String(parsed.summary ?? ""),
        changedRoutes: Array.isArray(parsed.changedRoutes) ? parsed.changedRoutes : [],
        noChangeReason: parsed.noChangeReason ?? null,
      };
    } catch { /* fall through */ }
  }
  // Fallback: use full text as summary
  return { summary: text.slice(0, 2000), changedRoutes: [], noChangeReason: null };
}

function composePrompt(task: {
  title: string;
  objective: string;
  prompt: string;
  acceptanceCriteria: string[];
}): string {
  const sections = [
    `# Tarea: ${task.title}`,
    "",
    `## Objetivo`,
    task.objective,
    "",
    `## Instrucciones detalladas`,
    task.prompt,
    "",
    `## Criterios de aceptación`,
    ...task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`),
    "",
    `## Reglas`,
    "- Respeta CLAUDE.md y DESIGN.md del repo si existen.",
    "- Alcance mínimo: solo los cambios necesarios para cumplir los criterios.",
    "- Deja el build pasando (npm run build).",
    "- No toques archivos .env*.",
    "- No instales dependencias nuevas sin justificación clara.",
    "- No hagas git commit ni git push — el worker lo hace después.",
    "- No salgas del directorio del repo.",
    "",
    `## Resultado`,
    "Al terminar, responde con un bloque JSON:",
    "```json",
    `{"summary": "resumen de lo que hiciste", "changedRoutes": ["/ruta1", "/ruta2"], "noChangeReason": null}`,
    "```",
    "Si no hiciste cambios, explica por qué en noChangeReason y deja changedRoutes vacío.",
  ];
  return sections.join("\n");
}

async function runAgent(
  dir: string,
  task: { title: string; objective: string; prompt: string; acceptanceCriteria: string[] },
  _defaultBranch: string
): Promise<AgentResult> {
  const ac = new AbortController();
  const timeout = setTimeout(
    () => ac.abort(),
    workerEnv.AGENT_TIMEOUT_MIN * 60 * 1000
  );

  let sessionId = "";
  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let resultText = "";

  try {
    const prompt = composePrompt(task);

    const canUseTool = createCanUseTool(dir);

    const stream = query({
      prompt,
      options: {
        cwd: dir,
        tools: { type: "preset", preset: "claude_code" },
        disallowedTools: [
          "WebFetch", "WebSearch", "Agent",
        ],
        canUseTool: canUseTool as never, // SDK expects its own CanUseTool type
        permissionMode: "default",
        maxTurns: workerEnv.AGENT_MAX_TURNS,
        maxBudgetUsd: workerEnv.AGENT_MAX_BUDGET_USD,
        abortController: ac,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: "Estás ejecutando una tarea SEO automatizada para Click Society. No hagas preguntas — ejecuta directamente. No hagas git commit ni git push. Solo puedes usar Bash para: npm run build, npm run lint, git status, git diff.",
        },
        settingSources: ["project"],
        persistSession: false,
        model: "claude-sonnet-4-6",
      },
    });

    for await (const message of stream) {
      if (message.type === "result" && !message.is_error) {
        const result = message as SDKResultSuccess;
        sessionId = result.session_id;
        costUsd = result.total_cost_usd;
        resultText = result.result ?? "";

        for (const usage of Object.values(result.modelUsage ?? {})) {
          inputTokens += usage.inputTokens;
          outputTokens += usage.outputTokens;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  return { sessionId, costUsd, inputTokens, outputTokens, resultText };
}

// ─── Preflight ───────────────────────────────────────────────────────────────

/**
 * Preflight: clone → memoria → npm ci --include=dev → build.
 * Sin agente, sin commit, sin PR. Solo verifica que el sitio puede compilar.
 */
async function processPreflight(jobData: PlanTaskJobData): Promise<void> {
  const { taskId } = jobData;

  const task = await prisma.planTask.findUniqueOrThrow({
    where: { id: taskId },
    include: { site: true, plan: { select: { clientId: true } } },
  });

  const site = task.site;
  if (!site.githubRepo) {
    await failTask(taskId, "NO_GITHUB_REPO");
    return;
  }

  await prisma.planTask.update({ where: { id: taskId }, data: { status: "RUNNING" } });

  const run = await prisma.taskRun.create({
    data: { taskId, kind: "AUTO", status: "RUNNING" },
  });

  const phases: string[] = [];
  const startTotal = Date.now();

  try {
    // Clone/fetch
    let phaseStart = Date.now();
    console.log(`[preflight] ${task.title} — cloning ${site.githubRepo}...`);
    const dir = await ensureRepo(site.githubRepo, site.defaultBranch);
    phases.push(`clone: ${Date.now() - phaseStart}ms`);

    // Memory
    phaseStart = Date.now();
    const memoryStatus = await classifyMemory(dir);
    phases.push(`memory: ${Date.now() - phaseStart}ms`);
    await prisma.taskRun.update({
      where: { id: run.id },
      data: { memoryStatus: memoryStatus as unknown as InputJsonValue },
    });
    console.log(`[preflight] ${task.title} — memory: ${JSON.stringify(memoryStatus)}`);

    // npm ci
    phaseStart = Date.now();
    if (needsInstall(dir)) {
      console.log(`[preflight] ${task.title} — npm ci --include=dev...`);
      try {
        runInstall(dir);
      } catch (installErr) {
        const msg = installErr instanceof Error ? installErr.message : String(installErr);
        if (msg === "LOCKFILE_OUT_OF_SYNC") {
          phases.push(`install: LOCKFILE_OUT_OF_SYNC (${Date.now() - phaseStart}ms)`);
          await failRun(run.id, "LOCKFILE_OUT_OF_SYNC", phases.join(" | "));
          await failTask(taskId, "LOCKFILE_OUT_OF_SYNC");
          console.log(`[preflight] ${task.title} — ❌ LOCKFILE_OUT_OF_SYNC`);
          return;
        }
        throw installErr;
      }
      phases.push(`install: ${Date.now() - phaseStart}ms`);
    } else {
      phases.push("install: skipped (lockfile unchanged)");
    }

    // Build
    phaseStart = Date.now();
    console.log(`[preflight] ${task.title} — building...`);
    const buildResult = verifyBuild(dir);
    phases.push(`build: ${Date.now() - phaseStart}ms`);

    const totalMs = Date.now() - startTotal;

    if (buildResult.passed) {
      await prisma.taskRun.update({
        where: { id: run.id },
        data: {
          status: "SUCCEEDED",
          buildPassed: true,
          logTail: phases.join(" | "),
          finishedAt: new Date(),
        },
      });
      await prisma.planTask.update({
        where: { id: taskId },
        data: { status: "MERGED", failureReason: null }, // MERGED = preflight passed
      });
      console.log(`[preflight] ${task.title} — ✅ OK (${totalMs}ms) | ${phases.join(" | ")}`);
    } else {
      await failRun(run.id, "BUILD_FAILED", buildResult.logTail);
      await failTask(taskId, `BUILD_FAILED`);
      console.log(`[preflight] ${task.title} — ❌ BUILD_FAILED (${totalMs}ms)`);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? sanitizePat(err.message) : String(err);
    console.error(`[preflight] ${task.title} — ❌ ${errMsg}`);
    await failRun(run.id, errMsg);
    await failTask(taskId, errMsg);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function failTask(taskId: string, reason: string): Promise<void> {
  await prisma.planTask.update({
    where: { id: taskId },
    data: { status: "FAILED", failureReason: reason },
  });
}

async function failRun(
  runId: string,
  error: string,
  logTail?: string
): Promise<void> {
  await prisma.taskRun.update({
    where: { id: runId },
    data: {
      status: "FAILED",
      error,
      logTail: logTail ?? null,
      finishedAt: new Date(),
    },
  });
}
