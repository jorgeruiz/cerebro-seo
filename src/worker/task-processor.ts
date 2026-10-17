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

import Anthropic from "@anthropic-ai/sdk";
import { query, type SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import { Decimal } from "@prisma/client/runtime/library";
import type { InputJsonValue } from "@prisma/client/runtime/library";
import { createCanUseTool } from "./agent-permissions";
import { prisma } from "@/lib/db";
import { logApiUsage } from "@/server/jobs/workers/base-worker";
import { workerEnv } from "./env";
import { CLAUDE_MODEL } from "@/lib/anthropic-config";
import { publishWpPost, updateWpSeo } from "@/lib/wp-proxy-client";
import {
  classifyMemory,
  detectCatalogSections,
  contentCategoryForTask,
  isMemoryReadyForCode,
  isMemoryReadyForContent,
} from "./memory-classifier";
import { acquirePlanLock, acquireRepoLock, withBuildSemaphore } from "./plan-lock";
import { scanPlaceholders, formatPlaceholderHits } from "./placeholder-guard";
import {
  ensureRepo,
  ensureRepoPlanBranch,
  mergeDefaultIntoPlan,
  needsInstall,
  runInstall,
  verifyBuild,
  cleanBuildCache,
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
      site: { include: { client: { select: { cerebroClientId: true } } } },
      plan: { select: { id: true, clientId: true, branchName: true, month: true } },
      steps: { orderBy: { order: "asc" } },
    },
  });

  const site = task.site;
  const plan = task.plan;

  // ── WordPress path — no repo needed, executes via WP plugin proxy ──────
  if (site.platform === "WORDPRESS" || site.platform === "MIGRACION") {
    await processWpTask(taskId, task, plan);
    return;
  }

  if (!site.githubRepo) {
    await failTask(taskId, "Site no tiene githubRepo configurado.");
    return;
  }
  let branchName = plan.branchName;
  if (!branchName) {
    // Auto-heal: plan creado antes de que branchName existiera en el schema
    const client = await prisma.client.findUnique({
      where: { id: plan.clientId },
      select: { name: true },
    });
    const slug = (client?.name ?? "cliente")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30);
    branchName = `plan/${slug}-${plan.month}`;
    await prisma.monthlyPlan.update({ where: { id: plan.id }, data: { branchName } });
    console.log(`[plan-task] branchName auto-healed → ${branchName}`);
  }

  // ── 2. Adquirir candados (plan + repo) ─────────────────────────────
  const lock = await acquirePlanLock(plan.id);
  if (!lock.acquired) {
    console.log(`[plan-task] Plan ${plan.id} locked by ${lock.holder ?? "unknown"} — re-queuing`);
    throw new Error("PLAN_LOCKED");
  }

  const repoLock = await acquireRepoLock(site.githubRepo);
  if (!repoLock.acquired) {
    await lock.release();
    console.log(`[plan-task] Repo ${site.githubRepo} locked — re-queuing`);
    throw new Error("REPO_LOCKED");
  }

  // Task → RUNNING
  await prisma.planTask.update({
    where: { id: taskId },
    data: { status: "RUNNING" },
  });

  try {
    // ── 3. Checkout rama del plan ───────────────────────────────────────
    console.log(`[plan-task] Ensuring plan branch ${branchName} for ${site.githubRepo}...`);
    const dir = await ensureRepoPlanBranch(site.githubRepo, site.defaultBranch, branchName);

    // ── 4. Merge default → plan branch ─────────────────────────────────
    console.log(`[plan-task] Merging ${site.defaultBranch} into ${branchName}...`);
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

    // Spec §4 regla 5: AI and HYBRID tasks require site memory
    if (task.mode === "AI" || task.mode === "HYBRID") {
      const contentCategory = contentCategoryForTask(task.category);
      let gate;

      if (contentCategory) {
        // CONTENT task — requires catalog-schemas with the right section
        const catalogSections = await detectCatalogSections(dir);
        gate = isMemoryReadyForContent(memoryStatus, catalogSections, contentCategory);
      } else {
        // CODE/SETUP task — requires site-spec, site-map, site-state
        gate = isMemoryReadyForCode(memoryStatus);
      }

      if (!gate.ready) {
        await prisma.planTask.update({
          where: { id: taskId },
          data: {
            status: "WAITING_HUMAN",
            failureReason: `MEMORY_INCOMPLETE: ${gate.missing.join(", ")}`,
          },
        });
        return;
      }
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
        const buildResult = await withBuildSemaphore(() => verifyBuild(dir));
        await prisma.taskRun.update({
          where: { id: run.id },
          data: { buildPassed: buildResult.passed },
        });

        if (!buildResult.passed) {
          throw new Error(`BUILD_FAILED: ${(buildResult.logTail ?? "").slice(0, 200)}`);
        }

        // Placeholder guard — only for pure AI tasks.
        // HYBRID tasks intentionally produce [COMPLETAR markers in AI steps
        // that get resolved in the HUMAN steps. The plan-level guard
        // (actionSubmitForReview) catches any remaining markers before merge.
        if (task.mode === "AI") {
          const placeholderHits = scanPlaceholders(dir);
          if (placeholderHits.length > 0) {
            const detail = formatPlaceholderHits(placeholderHits);
            throw new Error(`PLACEHOLDER_MARKERS: ${detail}`);
          }
        }

        // Parse structured result
        const structured = parseAgentResult(agentResult.resultText);

        // Commit if there are changes
        let sha: string | null = null;
        if (hasDiff(dir)) {
          sha = commitStep(dir, branchName, taskId, step.title);
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
          planBranch: branchName,
          defaultBranch: site.defaultBranch,
          title: `Plan ${plan.month}`,
          body: prBody,
        });

        // Try to get preview URL (polls with retries, up to ~5 min)
        const lastSha = allShas[allShas.length - 1];
        const preview = await getPreviewUrl(site.githubRepo, lastSha, 6, 20_000);

        await prisma.monthlyPlan.update({
          where: { id: plan.id },
          data: {
            prNumber: pr.number,
            prUrl: pr.url,
            previewUrl: preview.url ?? preview.dashboardUrl ?? undefined,
          },
        });

        if (preview.state && preview.state !== "success") {
          console.log(`[plan-task] Preview deploy ${preview.state}: ${preview.description ?? ""}`);
        }

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
    // Retriable errors — let BullMQ re-queue, don't mark task FAILED
    if (errMsg === "PLAN_LOCKED" || errMsg === "REPO_LOCKED" || errMsg === "BUILD_BUSY") {
      throw err;
    }

    console.error(`[plan-task] ✗ Task "${task.title}" failed:`, errMsg);
    await failTask(taskId, errMsg);
  } finally {
    await repoLock.release();
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

/**
 * Complexity → maxTurns mapping.
 * The decomposer stores "complexity:low|medium|high" in step.notes.
 * The cap (AGENT_MAX_TURNS_CAP) prevents runaway agents.
 */
function turnsForStep(step: { notes: string | null }): number {
  const match = step.notes?.match(/complexity:(\w+)/);
  const complexity = match?.[1] ?? "medium";

  const base: Record<string, number> = { low: 20, medium: 40, high: 60 };
  const turns = base[complexity] ?? 40;

  return Math.min(turns, workerEnv.AGENT_MAX_TURNS_CAP);
}

async function runAgent(
  dir: string,
  task: { title: string; objective: string },
  step: { title: string; prompt: string | null; acceptanceCriteria: string[]; notes: string | null }
): Promise<AgentResult> {
  const maxTurns = turnsForStep(step);
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

    console.log(`[plan-task] Agent maxTurns=${maxTurns} (${step.notes?.match(/complexity:\w+/)?.[0] ?? "medium"})`);

    const stream = query({
      prompt,
      options: {
        cwd: dir,
        tools: { type: "preset", preset: "claude_code" },
        disallowedTools: ["WebFetch", "WebSearch", "Agent"],
        canUseTool: canUseTool as never,
        permissionMode: "default",
        maxTurns,
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

    // Preflight ALWAYS installs and builds clean — no caching
    phaseStart = Date.now();
    console.log(`[preflight] ${task.title} — npm ci --include=dev (forced)...`);
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

    // Clean .next cache to force a real build
    cleanBuildCache(dir);

    phaseStart = Date.now();
    console.log(`[preflight] ${task.title} — building...`);
    const buildResult = await withBuildSemaphore(() => verifyBuild(dir));
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

// ─── WordPress execution engine ──────────────────────────────────────────────

interface WpStepAction {
  action: "publish" | "seo" | "update" | "media";
  endpoint: string;
  payload: Record<string, unknown>;
  content_brief?: string;
}

/**
 * Procesador de tareas para sitios WordPress.
 * No clona repositorios — ejecuta vía plugin Cerebro WP a través del proxy de Cerebro web.
 */
async function processWpTask(
  taskId: string,
  task: {
    title: string;
    kind: string;
    category: string;
    mode: string;
    resultUrls: string[];
    steps: Array<{
      id: string;
      order: number;
      title: string;
      type: string;
      status: string;
      prompt: string | null;
      acceptanceCriteria: string[];
      notes: string | null;
    }>;
    site: {
      platform: string | null;
      client: { cerebroClientId: string | null } | null;
    };
    objective: string;
  },
  plan: { id: string; clientId: string },
): Promise<void> {
  const cerebroClientId = task.site.client?.cerebroClientId ?? null;

  const lock = await acquirePlanLock(plan.id);
  if (!lock.acquired) {
    console.log(`[wp-task] Plan ${plan.id} locked — re-queuing`);
    throw new Error("PLAN_LOCKED");
  }

  await prisma.planTask.update({ where: { id: taskId }, data: { status: "RUNNING" } });

  const resultUrls = [...task.resultUrls];

  try {
    for (const step of task.steps) {
      if (step.status === "DONE" || step.status === "SKIPPED") continue;

      if (step.type === "HUMAN") {
        await prisma.planStep.update({
          where: { id: step.id },
          data: { status: "WAITING_HUMAN" },
        });
        await prisma.planTask.update({
          where: { id: taskId },
          data: { status: "WAITING_HUMAN", resultUrls },
        });
        return;
      }

      // type=AI — execute via WP proxy
      await prisma.planStep.update({ where: { id: step.id }, data: { status: "RUNNING" } });

      const run = await prisma.taskRun.create({
        data: { taskId, stepId: step.id, kind: "AUTO", status: "RUNNING" },
      });

      try {
        if (!cerebroClientId) {
          throw new Error("Site no tiene cerebroClientId — necesario para llamar al plugin WP via proxy");
        }

        const stepResult = await executeWpAiStep(cerebroClientId, task, step, taskId);

        await prisma.planStep.update({
          where: { id: step.id },
          data: {
            status: "DONE",
            notes: step.notes ? `${step.notes}\n---\n${stepResult.notes}` : stepResult.notes,
          },
        });

        if (stepResult.previewUrl) {
          resultUrls.push(stepResult.previewUrl);
        }

        await prisma.taskRun.update({
          where: { id: run.id },
          data: {
            status: "SUCCEEDED",
            logTail: stepResult.notes.slice(0, 2000),
            finishedAt: new Date(),
          },
        });

        console.log(`[wp-task] Step ${step.order} ✓ ${stepResult.notes.slice(0, 80)}`);
      } catch (stepErr) {
        const errMsg = stepErr instanceof Error ? stepErr.message : String(stepErr);
        console.error(`[wp-task] Step ${step.order} ✗: ${errMsg}`);

        await prisma.planStep.update({ where: { id: step.id }, data: { status: "FAILED" } });
        await failRun(run.id, errMsg);
        await failTask(taskId, `Paso WP ${step.order} falló: ${errMsg}`);
        await prisma.planTask.update({ where: { id: taskId }, data: { resultUrls } });
        return;
      }
    }

    // All steps done
    await prisma.planTask.update({
      where: { id: taskId },
      data: { status: "DONE", completedAt: new Date(), resultUrls },
    });
    console.log(`[wp-task] ✓ Task "${task.title}" → DONE (${resultUrls.length} URLs)`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg === "PLAN_LOCKED") throw err;
    console.error(`[wp-task] ✗ Task "${task.title}" failed:`, errMsg);
    await failTask(taskId, errMsg);
  } finally {
    await lock.release();
  }
}

/**
 * Ejecuta un step AI de WordPress: parsea la acción estructurada del prompt
 * y llama al endpoint correcto del plugin WP via proxy.
 */
async function executeWpAiStep(
  cerebroClientId: string,
  task: { title: string; objective: string; kind: string; category: string },
  step: { title: string; prompt: string | null; acceptanceCriteria: string[]; notes: string | null },
  taskId: string,
): Promise<{ notes: string; previewUrl?: string }> {
  // Parse structured action from step.prompt (decomposer sets JSON for WP AI steps)
  let action: WpStepAction | null = null;
  if (step.prompt) {
    try {
      const cleaned = step.prompt.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
      action = JSON.parse(cleaned) as WpStepAction;
    } catch {
      // Not structured JSON — fall through to heuristic
    }
  }

  // Fallback: infer action from task kind/category
  if (!action?.action) {
    const isContent = task.kind === "CONTENT" || task.category === "blog";
    const isMeta = task.category === "meta" || task.category === "seo";
    if (isContent) {
      action = {
        action: "publish",
        endpoint: "POST /publish",
        payload: {},
        content_brief: step.prompt ?? task.objective,
      };
    } else if (isMeta) {
      action = {
        action: "seo",
        endpoint: "POST /seo/0",
        payload: { page_id: 0 },
        content_brief: step.prompt ?? task.objective,
      };
    } else {
      // Stage as proposal — don't fail the step
      return {
        notes: `wp:staged — acción no reconocida para categoria "${task.category}". Prompt: ${(step.prompt ?? "").slice(0, 400)}`,
      };
    }
  }

  if (action.action === "publish") {
    return executeWpPublish(cerebroClientId, task, action, taskId);
  }
  if (action.action === "seo") {
    return executeWpSeo(cerebroClientId, task, action, taskId);
  }

  // update / media — stage as proposal for motor mínimo
  return {
    notes: `wp:staged — acción "${action.action}" (${action.endpoint}) pendiente de implementar. Payload: ${JSON.stringify(action.payload).slice(0, 400)}`,
  };
}

/** Genera artículo de blog con Claude y lo publica como borrador en WP. */
async function executeWpPublish(
  cerebroClientId: string,
  task: { title: string; objective: string },
  action: WpStepAction,
  taskId: string,
): Promise<{ notes: string; previewUrl?: string }> {
  const title = String(action.payload?.title ?? task.title);
  const brief = action.content_brief ?? task.objective;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const contentResponse = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    messages: [{
      role: "user",
      content: [
        "Escribe el artículo completo de blog según este brief.",
        "Formato: HTML semántico sin <html>/<body>/<head>.",
        "Usa <h2>, <h3>, <p>, <ul>, <li>, <strong>, <em>.",
        "Entre 1500 y 2500 palabras.",
        "PROHIBIDO inventar datos del cliente: precios, casos de éxito, certificaciones, números específicos.",
        "Solo contenido informativo del sector que no requiera verificación con el cliente.",
        "",
        `TÍTULO: ${title}`,
        "",
        "BRIEF:",
        brief,
      ].join("\n"),
    }],
  });

  const content = contentResponse.content[0]?.type === "text" ? contentResponse.content[0].text : "";
  if (!content) {
    throw new Error("Claude no generó contenido para el artículo");
  }

  const result = await publishWpPost(cerebroClientId, {
    title,
    content,
    status: "draft",
    slug: action.payload?.slug as string | undefined,
    focus_keyword: action.payload?.focus_keyword as string | undefined,
    categories: action.payload?.categories as string[] | undefined,
  }, taskId);

  if (!result.ok) {
    throw new Error(`WP /publish falló: ${result.error}`);
  }

  const { post_id, draft_url, edit_url } = result.data;
  const previewUrl = draft_url ?? edit_url;
  const notes = `wp:publish OK — post_id=${post_id}${previewUrl ? ` draft_url=${previewUrl}` : ""}`;

  const costUsd = Number(contentResponse.usage.input_tokens) * 0.000003 + Number(contentResponse.usage.output_tokens) * 0.000015;
  await logApiUsage({ provider: "anthropic", endpoint: "wp-publish-content", cost: costUsd, clientId: "" });

  return { notes, previewUrl };
}

/** Genera meta title/description con Claude y los aplica via Yoast SEO. */
async function executeWpSeo(
  cerebroClientId: string,
  task: { title: string; objective: string },
  action: WpStepAction,
  taskId: string,
): Promise<{ notes: string }> {
  const pageId = Number(action.payload?.page_id ?? 0);
  let metaTitle = action.payload?.meta_title as string | undefined;
  let metaDescription = action.payload?.meta_description as string | undefined;
  const focusKeyword = action.payload?.focus_keyword as string | undefined;

  // Generate with Claude if not already in the payload
  if (!metaTitle || !metaDescription) {
    const brief = action.content_brief ?? `${task.title}: ${task.objective}`;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const metaResponse = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      messages: [{
        role: "user",
        content: [
          "Genera meta title y meta description para SEO según este contexto.",
          "meta_title: 50-60 caracteres exactos, incluye keyword principal, evita mayúsculas innecesarias.",
          "meta_description: 140-160 caracteres exactos, incluye beneficio claro y CTA suave.",
          "PROHIBIDO inventar datos del cliente.",
          "Responde SOLO con JSON: {\"meta_title\": \"...\", \"meta_description\": \"...\"}",
          "",
          "CONTEXTO:",
          brief,
        ].join("\n"),
      }],
    });

    const rawMeta = metaResponse.content[0]?.type === "text" ? metaResponse.content[0].text : "{}";
    try {
      const cleaned = rawMeta.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
      const parsed = JSON.parse(cleaned) as { meta_title?: string; meta_description?: string };
      metaTitle = metaTitle ?? parsed.meta_title;
      metaDescription = metaDescription ?? parsed.meta_description;
    } catch {
      // Use whatever we have
    }
  }

  if (!metaTitle || !metaDescription) {
    return {
      notes: `wp:seo STAGED — no se pudo generar meta. Objetivo: ${task.objective.slice(0, 200)}`,
    };
  }

  // If page_id is unknown (0): stage the proposal for manual application
  if (pageId === 0) {
    const proposal = JSON.stringify({ meta_title: metaTitle, meta_description: metaDescription, focus_keyword: focusKeyword });
    return {
      notes: `wp:seo STAGED — page_id desconocido. Propuesta lista para aplicar:\n${proposal}`,
    };
  }

  const result = await updateWpSeo(cerebroClientId, pageId, {
    meta_title: metaTitle,
    meta_description: metaDescription,
    focus_keyword: focusKeyword,
  }, taskId);

  if (!result.ok) {
    throw new Error(`WP /seo/${pageId} falló: ${result.error}`);
  }

  return {
    notes: `wp:seo OK — page_id=${pageId} meta_title="${metaTitle}" (${metaTitle.length} chars) meta_description="${metaDescription.slice(0, 60)}..." (${metaDescription.length} chars)`,
  };
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
