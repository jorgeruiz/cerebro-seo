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
import { executeWpAiStep } from "./wp-executor";
import { getWpSiteProfile } from "@/lib/wp-site-profile";
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
  scanExistingRoutes,
  getChangedRoutesFromDiff,
  verifyRoutesInBuild,
  stripDraftFrontmatter,
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
      site: { include: { client: { select: { cerebroClientId: true, name: true } } } },
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

      // ── Image step shortcut (Next.js) ─────────────────────────
      const imageAction = parseImageAction(step.prompt);
      if (imageAction) {
        try {
          const { executeImage } = await import("./image-executor");
          // Read brand colors from DESIGN.md if available
          const brandColors = await readBrandColors(dir);
          const articleSlug = task.title
            .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 40);

          const imgResult = await executeImage(imageAction, {
            cerebroClientId: site.client?.cerebroClientId ?? "",
            taskId,
            clientId: plan.clientId,
            brandColors,
            repoDir: dir,
            articleSlug,
            imageCount: 0, // tracked per-task for Next.js too
            taskKind: task.kind,
            taskCategory: task.category,
          });

          // If image needs human intervention → WAITING_HUMAN
          const needsHuman = imgResult.notes.startsWith("image:human-required")
            || imgResult.notes.startsWith("image:limit")
            || imgResult.notes.startsWith("image:qa-failed")
            || imgResult.notes.startsWith("image:failed")
            || imgResult.notes.startsWith("image:upload-failed");

          if (needsHuman) {
            await prisma.planStep.update({
              where: { id: step.id },
              data: { status: "WAITING_HUMAN", notes: imgResult.notes },
            });
            await prisma.planTask.update({
              where: { id: taskId },
              data: { status: "WAITING_HUMAN", commitShas: allShas },
            });
            await prisma.taskRun.update({
              where: { id: run.id },
              data: { status: "SUCCEEDED", logTail: imgResult.notes.slice(0, 2000), finishedAt: new Date() },
            });
            console.log(`[plan-task] Image step ${step.order} → WAITING_HUMAN: ${imgResult.notes.slice(0, 80)}`);
            return;
          }

          // If image was written to repo, update frontmatter and commit
          if (imgResult.imageUrl && imageAction.payload.usage === "featured_image") {
            await updateMdxFrontmatter(dir, articleSlug, imgResult.imageUrl);
          }

          if (hasDiff(dir)) {
            const sha = commitStep(dir, branchName, taskId, `image: ${step.title}`);
            if (sha) allShas.push(sha);
          }

          await prisma.planStep.update({
            where: { id: step.id },
            data: { status: "DONE", notes: imgResult.notes },
          });
          await prisma.taskRun.update({
            where: { id: run.id },
            data: { status: "SUCCEEDED", logTail: imgResult.notes.slice(0, 2000), finishedAt: new Date() },
          });
          console.log(`[plan-task] Image step ${step.order} done: ${imgResult.notes.slice(0, 80)}`);
          continue;
        } catch (imgErr) {
          const errMsg = imgErr instanceof Error ? imgErr.message : String(imgErr);
          console.error(`[plan-task] Image step ${step.order} failed: ${errMsg}`);
          await prisma.planStep.update({ where: { id: step.id }, data: { status: "FAILED" } });
          await prisma.taskRun.update({
            where: { id: run.id },
            data: { status: "FAILED", logTail: errMsg.slice(0, 2000), finishedAt: new Date() },
          });
          await failTask(taskId, `Imagen step ${step.order} falló: ${errMsg}`);
          return;
        }
      }

      try {
        const agentResult = await runAgent(dir, task, step);

        await prisma.taskRun.update({
          where: { id: run.id },
          data: { agentSessionId: agentResult.sessionId },
        });

        // Strip draft frontmatter (borrador/draft/published:false) from any MDX files
        const cleanedFiles = stripDraftFrontmatter(dir);
        if (cleanedFiles.length > 0) {
          console.log(`[plan-task] Stripped draft frontmatter from: ${cleanedFiles.join(", ")}`);
        }

        // Derive changedRoutes from actual git diff BEFORE build
        const diffRoutes = getChangedRoutesFromDiff(dir);

        // Build check
        const buildResult = await withBuildSemaphore(() => verifyBuild(dir));
        await prisma.taskRun.update({
          where: { id: run.id },
          data: { buildPassed: buildResult.passed },
        });

        if (!buildResult.passed) {
          throw new Error(`BUILD_FAILED: ${(buildResult.logTail ?? "").slice(0, 200)}`);
        }

        // Verify that changed routes actually appear in the build output
        if (diffRoutes.length > 0) {
          const missingRoutes = verifyRoutesInBuild(dir, diffRoutes);
          if (missingRoutes.length > 0) {
            throw new Error(
              `ROUTES_MISSING_IN_BUILD: Las siguientes rutas no aparecen en el build: ${missingRoutes.join(", ")}. ` +
              `Verifica que el frontmatter sea correcto y que generateStaticParams incluya estos slugs.`
            );
          }
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

        // Parse structured result (for summary + noChangeReason only; routes come from git diff)
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
            changedRoutes: diffRoutes,
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
  step: { title: string; prompt: string | null; acceptanceCriteria: string[] },
  existingRoutes?: Map<string, string>
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
  ];

  if (existingRoutes && existingRoutes.size > 0) {
    sections.push(
      `## Rutas existentes en el repositorio`,
      "IMPORTANTE: Las siguientes rutas YA EXISTEN en el repo. Si tu tarea toca alguna de estas rutas, OPTIMIZA el archivo existente — NO crees uno nuevo.",
      ...Array.from(existingRoutes.entries()).map(([route, fp]) => `- ${route}  →  ${fp}`),
      ""
    );
  }

  sections.push(
    `## Reglas`,
    "- Respeta CLAUDE.md y DESIGN.md del repo si existen.",
    "- Alcance mínimo: solo los cambios de ESTE paso.",
    "- Deja el build pasando (npm run build).",
    "- No toques archivos .env*.",
    "- No instales dependencias nuevas sin justificación clara.",
    "- No hagas git commit ni git push — el worker lo hace después.",
    "- No salgas del directorio del repo.",
    "- PROHIBIDO inventar datos del cliente (precios, clientes, certificaciones, casos).",
    "- Si la ruta objetivo ya existe (ver sección 'Rutas existentes'), edita ese archivo, no crees uno duplicado.",
    "",
    `## Resultado`,
    "Al terminar, responde con un bloque JSON:",
    "```json",
    `{"summary": "resumen de lo que hiciste", "changedRoutes": ["/ruta1", "/ruta2"], "noChangeReason": null}`,
    "```",
    "Si no hiciste cambios, explica por qué en noChangeReason.",
  );
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
    const existingRoutes = scanExistingRoutes(dir);
    const prompt = composeStepPrompt(task, step, existingRoutes);
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
// Primitivas en src/worker/wp-executor.ts; orchestración aquí.

/**
 * Procesador de tareas para sitios WordPress.
 * No clona repositorios — ejecuta vía plugin Cerebro WP a través del proxy de Cerebro web.
 *
 * Flujo:
 * 1. Construir perfil del sitio (getWpSiteProfile) — caché 7 días.
 * 2. Para cada step:
 *    - HUMAN → WAITING_HUMAN, detener.
 *    - AI → executeWpAiStep (wp-executor.ts).
 * 3. Si un step publish devuelve previewUrl → guardar en PlanTask.previewUrl.
 *    resultUrls se llena al publicar el plan.
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
      url: string;
      platform: string | null;
      client: { cerebroClientId: string | null; name: string } | null;
    };
    objective: string;
  },
  plan: { id: string; clientId: string },
): Promise<void> {
  const cerebroClientId = task.site.client?.cerebroClientId ?? null;
  const clientName = task.site.client?.name ?? "Cliente";
  const siteUrl = task.site.url;

  const lock = await acquirePlanLock(plan.id);
  if (!lock.acquired) {
    console.log(`[wp-task] Plan ${plan.id} locked — re-queuing`);
    throw new Error("PLAN_LOCKED");
  }

  await prisma.planTask.update({ where: { id: taskId }, data: { status: "RUNNING" } });

  // Construir perfil del sitio — para guiar la generación de contenido
  const siteProfile = cerebroClientId
    ? await getWpSiteProfile(cerebroClientId, clientName, siteUrl, taskId).catch((err) => {
        console.warn(`[wp-task] siteProfile failed — continuando sin perfil: ${(err as Error).message}`);
        return null;
      })
    : null;

  const resultUrls = [...task.resultUrls];
  let imageCount = 0; // track AI-generated images across steps (max 2 per task)

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

        const stepResult = await executeWpAiStep(cerebroClientId, siteProfile, task, step, taskId, imageCount);

        // Track image count for per-task limit
        if (stepResult.imageUrl) imageCount++;

        // Image steps that need human intervention → WAITING_HUMAN
        const isImageHuman = stepResult.notes.startsWith("image:human-required")
          || stepResult.notes.startsWith("image:limit")
          || stepResult.notes.startsWith("image:qa-failed")
          || stepResult.notes.startsWith("image:failed")
          || stepResult.notes.startsWith("image:upload-failed");

        if (isImageHuman) {
          await prisma.planStep.update({
            where: { id: step.id },
            data: { status: "WAITING_HUMAN", notes: stepResult.notes },
          });
          await prisma.planTask.update({
            where: { id: taskId },
            data: { status: "WAITING_HUMAN", resultUrls },
          });
          await prisma.taskRun.update({
            where: { id: run.id },
            data: { status: "SUCCEEDED", logTail: stepResult.notes.slice(0, 2000), finishedAt: new Date() },
          });
          console.log(`[wp-task] Image step ${step.order} → WAITING_HUMAN: ${stepResult.notes.slice(0, 80)}`);
          return;
        }

        await prisma.planStep.update({
          where: { id: step.id },
          data: {
            status: "DONE",
            notes: step.notes ? `${step.notes}\n---\n${stepResult.notes}` : stepResult.notes,
            // stagedChange almacena datos estructurados del borrador (blog o seo)
            // publishWpPlanAction los lee para aplicar al publicar el plan
            ...(stepResult.stagedChange !== undefined
              ? { stagedChange: stepResult.stagedChange as unknown as Parameters<typeof prisma.planStep.update>[0]["data"]["stagedChange"] }
              : {}),
          },
        });

        // Borrador WP → previewUrl de la tarea (resultUrls se llena al publicar el plan)
        if (stepResult.previewUrl) {
          await prisma.planTask.update({
            where: { id: taskId },
            data: { previewUrl: stepResult.previewUrl },
          });
        }

        // Imagen generada → resultUrls (la URL de la imagen, no previewUrl de la tarea)
        if (stepResult.imageUrl) {
          resultUrls.push(stepResult.imageUrl);
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

    // Todos los pasos completados
    await prisma.planTask.update({
      where: { id: taskId },
      data: { status: "DONE", completedAt: new Date(), resultUrls },
    });
    console.log(`[wp-task] ✓ Task "${task.title}" → DONE`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg === "PLAN_LOCKED") throw err;
    console.error(`[wp-task] ✗ Task "${task.title}" failed:`, errMsg);
    await failTask(taskId, errMsg);
  } finally {
    await lock.release();
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

// ─── Image step helpers ──────────────────────────────────────────────────────

import type { ImageStepAction } from "./image-executor";

/**
 * Intenta parsear el prompt de un step como una acción de imagen.
 * Retorna null si no es un step de imagen.
 */
function parseImageAction(prompt: string | null): ImageStepAction | null {
  if (!prompt) return null;
  try {
    const cleaned = prompt.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (parsed.action === "image") return parsed as unknown as ImageStepAction;
  } catch {
    // Not JSON or not an image action
  }
  return null;
}

/**
 * Lee colores de marca desde DESIGN.md del repo del cliente.
 * Busca un patron "colors:" o "palette:" y extrae la primera línea.
 */
async function readBrandColors(repoDir: string): Promise<string | null> {
  const { readFile } = await import("fs/promises");
  const { join } = await import("path");

  try {
    const design = await readFile(join(repoDir, "DESIGN.md"), "utf-8");
    // Look for color definitions: "Primary: #hex" or "colors: ..."
    const colorMatch = design.match(/(?:colou?rs?|palette|primary|brand)[:\s]*([#\w\s,()-]+)/i);
    return colorMatch?.[1]?.trim().slice(0, 200) ?? null;
  } catch {
    return null;
  }
}

/**
 * Actualiza el frontmatter de un artículo MDX para incluir la imagen de portada.
 * Busca content/blog/{slug}.mdx y agrega/actualiza el campo "image".
 */
async function updateMdxFrontmatter(repoDir: string, slug: string, imagePath: string): Promise<void> {
  const { readFile, writeFile } = await import("fs/promises");
  const { join } = await import("path");
  const { globSync } = await import("glob");

  // Find the MDX file matching this slug
  const candidates = globSync(`content/blog/**/${slug}*.mdx`, { cwd: repoDir });
  if (candidates.length === 0) {
    console.log(`[image] No MDX found for slug "${slug}" — skipping frontmatter update`);
    return;
  }

  const mdxPath = join(repoDir, candidates[0]);
  const content = await readFile(mdxPath, "utf-8");

  // Check if frontmatter has image field
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return;

  const frontmatter = fmMatch[1];
  let updatedFm: string;

  if (/^image\s*:/m.test(frontmatter)) {
    // Replace existing image field
    updatedFm = frontmatter.replace(/^image\s*:.*$/m, `image: "${imagePath}"`);
  } else {
    // Add image field after title
    updatedFm = frontmatter.replace(
      /^(title\s*:.*$)/m,
      `$1\nimage: "${imagePath}"`,
    );
  }

  const updatedContent = content.replace(
    /^---\n[\s\S]*?\n---/,
    `---\n${updatedFm}\n---`,
  );
  await writeFile(mdxPath, updatedContent, "utf-8");
  console.log(`[image] Updated frontmatter in ${candidates[0]}: image="${imagePath}"`);
}
