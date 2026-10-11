/**
 * Procesador de tareas del plan mensual — S2e: rama por plan + ejecución por pasos.
 *
 * Flujo por tarea:
 * 1. Cargar task + plan + site + steps.
 * 2. Adquirir candado del plan en Redis.
 * 3. Checkout rama del plan (plan/{slug}-{YYYY-MM}). Reutilizar si existe.
 * 4. Merge default branch. Si conflicto → WAITING_HUMAN.
 * 5. Clasificar memoria. npm ci si lockfile cambió.
 * 6. Recorrer steps en orden:
 *    - AI: agente → build → guard → commit [task:<id>] → push
 *    - HUMAN: WAITING_HUMAN, se detiene. Server action reenqueue.
 * 7. Todos los pasos hechos → task DONE. Crear/actualizar PR del plan.
 * 8. Liberar candado.
 */

import { query, type SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import { Decimal } from "@prisma/client/runtime/library";
import type { InputJsonValue } from "@prisma/client/runtime/library";
import { createCanUseTool } from "./agent-permissions";
import { prisma } from "@/lib/db";
import { logApiUsage } from "@/server/jobs/workers/base-worker";
import { workerEnv } from "./env";
import { classifyMemory, isMemoryComplete } from "./memory-classifier";
import { acquirePlanLock } from "./plan-lock";
import { scanPlaceholders, formatPlaceholderHits } from "./placeholder-guard";
import {
  ensureRepo,
  ensureRepoPlanBranch,
  mergeDefaultIntoPlan,
  needsInstall,
  runInstall,
  verifyBuild,
  hasDiff,
  commitStep,
  createOrUpdatePlanPR,
  getPreviewUrl,
  sanitizePat,
} from "./repo-manager";
import type { PlanTaskJobData } from "@/server/jobs/queues";

// ─── Main entry ──────────────────────────────────────────────────────────────

export async function processTask(jobData: PlanTaskJobData): Promise<void> {
  if (jobData.preflight) {
    return processPreflight(jobData);
  }

  const { taskId, triggeredById } = jobData;

  // ── 1. Cargar task + plan + site + steps ─────────────────────────────
  const task = await prisma.planTask.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      site: true,
      plan: { select: { id: true, clientId: true, branchName: true, month: true } },
      steps: { orderBy: { order: "asc" } },
    },
  });

  const site = task.site;
  const plan = task.plan;

  if (!site.githubRepo) {
    await failTask(taskId, "Site no tiene githubRepo configurado.");
    return;
  }
  if (!plan.branchName) {
    await failTask(taskId, "Plan no tiene branchName configurado.");
    return;
  }

  // ── 2. Adquirir candado del plan ─────────────────────────────────────
  const lock = await acquirePlanLock(plan.id);
  if (!lock.acquired) {
    console.log(`[plan-task] Plan ${plan.id} locked by ${lock.holder ?? "unknown"} — re-queuing`);
    // La tarea se reintentará automáticamente por BullMQ
    throw new Error("PLAN_LOCKED");
  }

  // Task → RUNNING
  await prisma.planTask.update({
    where: { id: taskId },
    data: { status: "RUNNING" },
  });

  try {
    // ── 3. Checkout rama del plan ───────────────────────────────────────
    console.log(`[plan-task] Ensuring plan branch ${plan.branchName} for ${site.githubRepo}...`);
    const dir = await ensureRepoPlanBranch(site.githubRepo, site.defaultBranch, plan.branchName);

    // ── 4. Merge default → plan branch ─────────────────────────────────
    console.log(`[plan-task] Merging ${site.defaultBranch} into ${plan.branchName}...`);
    const mergeResult = mergeDefaultIntoPlan(dir, site.defaultBranch);

    if (!mergeResult.ok) {
      const files = mergeResult.conflictingFiles?.join(", ") ?? "(desconocidos)";
      console.log(`[plan-task] Merge conflict: ${files}`);
      await prisma.planTask.update({
        where: { id: taskId },
        data: {
          status: "WAITING_HUMAN",
          failureReason: `MERGE_CONFLICT: conflicto al traer ${site.defaultBranch} a la rama del plan. Archivos: ${files}`,
        },
      });
      return;
    }

    // ── 5. Memoria + npm ci ────────────────────────────────────────────
    const memoryStatus = await classifyMemory(dir);

    if (task.mode === "AI" && !isMemoryComplete(memoryStatus)) {
      await prisma.planTask.update({
        where: { id: taskId },
        data: { status: "WAITING_HUMAN", failureReason: "MEMORY_INCOMPLETE" },
      });
      return;
    }

    if (needsInstall(dir)) {
      console.log("[plan-task] Running npm ci --include=dev...");
      try {
        runInstall(dir);
      } catch (installErr) {
        const msg = installErr instanceof Error ? installErr.message : String(installErr);
        if (msg === "LOCKFILE_OUT_OF_SYNC") {
          await failTask(taskId, "LOCKFILE_OUT_OF_SYNC");
          return;
        }
        throw installErr;
      }
    }

    // ── 6. Recorrer steps ──────────────────────────────────────────────
    const allShas: string[] = [...task.commitShas]; // preserve any prior commits

    for (const step of task.steps) {
      // Skip already completed/skipped steps
      if (step.status === "DONE" || step.status === "SKIPPED") continue;

      if (step.type === "HUMAN") {
        // ── HUMAN step: pause ──────────────────────────────────────
        console.log(`[plan-task] Step ${step.order} "${step.title}" is HUMAN — pausing`);
        await prisma.planStep.update({
          where: { id: step.id },
          data: { status: "WAITING_HUMAN" },
        });
        await prisma.planTask.update({
          where: { id: taskId },
          data: { status: "WAITING_HUMAN", commitShas: allShas },
        });
        return; // stop processing — server action will re-enqueue
      }

      // ── AI step ──────────────────────────────────────────────────
      console.log(`[plan-task] Step ${step.order}/${task.steps.length}: "${step.title}" [AI]`);

      await prisma.planStep.update({
        where: { id: step.id },
        data: { status: "RUNNING" },
      });

      const run = await prisma.taskRun.create({
        data: {
          taskId,
          stepId: step.id,
          kind: "AUTO",
          status: "RUNNING",
          triggeredById: triggeredById ?? null,
        },
      });

      try {
        const agentResult = await runAgent(dir, task, step);

        await prisma.taskRun.update({
          where: { id: run.id },
          data: { agentSessionId: agentResult.sessionId },
        });

        // Build check
        const buildResult = verifyBuild(dir);
        await prisma.taskRun.update({
          where: { id: run.id },
          data: { buildPassed: buildResult.passed },
        });

        if (!buildResult.passed) {
          throw new Error(`BUILD_FAILED: ${(buildResult.logTail ?? "").slice(0, 200)}`);
        }

        // Placeholder guard
        const placeholderHits = scanPlaceholders(dir);
        if (placeholderHits.length > 0) {
          const detail = formatPlaceholderHits(placeholderHits);
          throw new Error(`PLACEHOLDER_MARKERS: ${detail}`);
        }

        // Parse structured result
        const structured = parseAgentResult(agentResult.resultText);

        // Commit if there are changes
        let sha: string | null = null;
        if (hasDiff(dir)) {
          sha = commitStep(dir, plan.branchName, taskId, step.title);
          if (sha) allShas.push(sha);
        } else if (!structured.noChangeReason) {
          throw new Error("NO_CHANGES: el agente no hizo cambios sin justificación");
        }

        // Step → DONE
        await prisma.planStep.update({
          where: { id: step.id },
          data: { status: "DONE" },
        });

        await prisma.taskRun.update({
          where: { id: run.id },
          data: {
            status: "SUCCEEDED",
            commitSha: sha,
            costUsd: new Decimal(agentResult.costUsd.toFixed(6)),
            inputTokens: agentResult.inputTokens,
            outputTokens: agentResult.outputTokens,
            logTail: structured.summary.slice(0, 2000),
            changedRoutes: structured.changedRoutes,
            finishedAt: new Date(),
          },
        });

        await logApiUsage({
          provider: "anthropic",
          endpoint: "agent-sdk-plan-step",
          cost: agentResult.costUsd,
          clientId: plan.clientId,
        });

        console.log(
          `[plan-task] Step ${step.order} ✓ ` +
            `${sha ? `sha=${sha.slice(0, 7)}` : "no changes"} ` +
            `$${agentResult.costUsd.toFixed(4)}`
        );
      } catch (stepErr) {
        const errMsg = stepErr instanceof Error ? sanitizePat(stepErr.message) : String(stepErr);
        console.error(`[plan-task] Step ${step.order} ✗: ${errMsg}`);

        await prisma.planStep.update({
          where: { id: step.id },
          data: { status: "FAILED" },
        });
        await failRun(run.id, errMsg);
        await failTask(taskId, `Paso ${step.order} falló: ${errMsg}`);
        // Update commitShas with whatever we collected so far
        await prisma.planTask.update({
          where: { id: taskId },
          data: { commitShas: allShas },
        });
        return; // stop this task, rest of plan continues
      }
    }

    // ── 7. All steps done → task DONE ──────────────────────────────────
    await prisma.planTask.update({
      where: { id: taskId },
      data: {
        status: "DONE",
        commitShas: allShas,
        completedAt: new Date(),
      },
    });

    // ── 8. Create or update plan-level PR ──────────────────────────────
    if (allShas.length > 0) {
      console.log("[plan-task] Creating/updating plan PR...");
      try {
        const prBody = await buildPlanPRBody(plan.id);
        const pr = await createOrUpdatePlanPR({
          githubRepo: site.githubRepo,
          planBranch: plan.branchName,
          defaultBranch: site.defaultBranch,
          title: `Plan ${plan.month}`,
          body: prBody,
        });

        // Try to get preview URL
        const lastSha = allShas[allShas.length - 1];
        const previewUrl = await getPreviewUrl(site.githubRepo, lastSha);

        await prisma.monthlyPlan.update({
          where: { id: plan.id },
          data: {
            prNumber: pr.number,
            prUrl: pr.url,
            previewUrl: previewUrl ?? undefined,
          },
        });

        console.log(`[plan-task] ✓ Task "${task.title}" → DONE (PR #${pr.number})`);
      } catch (prErr) {
        // PR creation failure doesn't fail the task — commits are already pushed
        console.error("[plan-task] PR creation failed:", prErr instanceof Error ? prErr.message : prErr);
      }
    } else {
      console.log(`[plan-task] ✓ Task "${task.title}" → DONE (no commits)`);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? sanitizePat(err.message) : String(err);
    if (errMsg === "PLAN_LOCKED") throw err; // let BullMQ retry

    console.error(`[plan-task] ✗ Task "${task.title}" failed:`, errMsg);
    await failTask(taskId, errMsg);
  } finally {
    await lock.release();
  }
}

// ─── PR Body Builder ─────────────────────────────────────────────────────────

async function buildPlanPRBody(planId: string): Promise<string> {
  const plan = await prisma.monthlyPlan.findUniqueOrThrow({
    where: { id: planId },
    include: {
      client: { select: { name: true } },
      tasks: {
        orderBy: { order: "asc" },
        include: {
          runs: {
            where: { status: "SUCCEEDED" },
            orderBy: { finishedAt: "desc" },
            take: 1,
            select: { costUsd: true, changedRoutes: true },
          },
        },
      },
    },
  });

  const sections: string[] = [
    `# Plan ${plan.month} — ${plan.client.name}`,
    "",
  ];

  let totalCost = 0;

  for (const task of plan.tasks) {
    const icon = task.status === "DONE" ? "✅" : task.status === "VOIDED" ? "🚫" : task.status === "FAILED" ? "❌" : "⏳";
    sections.push(`## ${icon} ${task.title}`);
    sections.push(`**Mode:** ${task.mode} | **Status:** ${task.status}`);

    if (task.voidReason) sections.push(`**Anulada:** ${task.voidReason}`);
    if (task.failureReason) sections.push(`**Error:** ${task.failureReason}`);

    if (task.runs.length > 0) {
      const run = task.runs[0];
      const cost = run.costUsd ? Number(run.costUsd) : 0;
      totalCost += cost;
      if (run.changedRoutes.length > 0) {
        sections.push(`**Rutas:** ${run.changedRoutes.join(", ")}`);
      }
    }

    if (task.commitShas.length > 0) {
      sections.push(`**Commits:** ${task.commitShas.map((s) => s.slice(0, 7)).join(", ")}`);
    }

    sections.push("");
  }

  sections.push("---");
  sections.push(`**Costo total:** $${totalCost.toFixed(4)} USD`);
  sections.push("_Generado por Cerebro SEO_");

  return sections.join("\n");
}

// ─── Agent SDK ───────────────────────────────────────────────────────────────

interface AgentResult {
  sessionId: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  resultText: string;
}

export interface AgentStructuredResult {
  summary: string;
  changedRoutes: string[];
  noChangeReason: string | null;
}

function parseAgentResult(text: string): AgentStructuredResult {
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
  return { summary: text.slice(0, 2000), changedRoutes: [], noChangeReason: null };
}

function composeStepPrompt(
  task: { title: string; objective: string },
  step: { title: string; prompt: string | null; acceptanceCriteria: string[] }
): string {
  const sections = [
    `# Paso: ${step.title}`,
    "",
    `## Contexto de la tarea`,
    `Tarea: ${task.title}`,
    `Objetivo: ${task.objective}`,
    "",
    `## Instrucciones de este paso`,
    step.prompt ?? "(sin instrucciones específicas)",
    "",
    `## Criterios de aceptación`,
    ...step.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`),
    "",
    `## Reglas`,
    "- Respeta CLAUDE.md y DESIGN.md del repo si existen.",
    "- Alcance mínimo: solo los cambios de ESTE paso.",
    "- Deja el build pasando (npm run build).",
    "- No toques archivos .env*.",
    "- No instales dependencias nuevas sin justificación clara.",
    "- No hagas git commit ni git push — el worker lo hace después.",
    "- No salgas del directorio del repo.",
    "- PROHIBIDO inventar datos del cliente (precios, clientes, certificaciones, casos).",
    "",
    `## Resultado`,
    "Al terminar, responde con un bloque JSON:",
    "```json",
    `{"summary": "resumen de lo que hiciste", "changedRoutes": ["/ruta1", "/ruta2"], "noChangeReason": null}`,
    "```",
    "Si no hiciste cambios, explica por qué en noChangeReason.",
  ];
  return sections.join("\n");
}

async function runAgent(
  dir: string,
  task: { title: string; objective: string },
  step: { title: string; prompt: string | null; acceptanceCriteria: string[] }
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
    const prompt = composeStepPrompt(task, step);
    const canUseTool = createCanUseTool(dir);

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
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: "Estás ejecutando un paso SEO automatizado para Click Society. No hagas preguntas — ejecuta directamente. No hagas git commit ni git push. Solo puedes usar Bash para: npm run build, npm run lint, git status, git diff. PROHIBIDO inventar datos del cliente.",
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
    let phaseStart = Date.now();
    console.log(`[preflight] ${task.title} — cloning ${site.githubRepo}...`);
    const dir = await ensureRepo(site.githubRepo, site.defaultBranch);
    phases.push(`clone: ${Date.now() - phaseStart}ms`);

    phaseStart = Date.now();
    const memoryStatus = await classifyMemory(dir);
    phases.push(`memory: ${Date.now() - phaseStart}ms`);
    await prisma.taskRun.update({
      where: { id: run.id },
      data: { memoryStatus: memoryStatus as unknown as InputJsonValue },
    });

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
          return;
        }
        throw installErr;
      }
      phases.push(`install: ${Date.now() - phaseStart}ms`);
    } else {
      phases.push("install: skipped (lockfile unchanged)");
    }

    phaseStart = Date.now();
    console.log(`[preflight] ${task.title} — building...`);
    const buildResult = verifyBuild(dir);
    phases.push(`build: ${Date.now() - phaseStart}ms`);

    const totalMs = Date.now() - startTotal;

    if (buildResult.passed) {
      await prisma.taskRun.update({
        where: { id: run.id },
        data: { status: "SUCCEEDED", buildPassed: true, logTail: phases.join(" | "), finishedAt: new Date() },
      });
      await prisma.planTask.update({
        where: { id: taskId },
        data: { status: "DONE", failureReason: null },
      });
      console.log(`[preflight] ${task.title} — ✅ OK (${totalMs}ms) | ${phases.join(" | ")}`);
    } else {
      await failRun(run.id, "BUILD_FAILED", buildResult.logTail);
      await failTask(taskId, "BUILD_FAILED");
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

async function failRun(runId: string, error: string, logTail?: string): Promise<void> {
  await prisma.taskRun.update({
    where: { id: runId },
    data: { status: "FAILED", error, logTail: logTail ?? null, finishedAt: new Date() },
  });
}
