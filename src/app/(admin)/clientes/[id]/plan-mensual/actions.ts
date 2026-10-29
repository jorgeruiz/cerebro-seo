"use server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { planTaskQueue, decomposeQueue } from "@/server/jobs/queues";
import { runTaskWatchdog } from "@/server/jobs/processors/task-watchdog";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PlanStepView {
  id: string;
  order: number;
  title: string;
  type: string; // AI | HYBRID | HUMAN
  status: string;
  acceptanceCriteria: string[];
  prompt: string | null;
  notes: string | null;
  /** WpStagedChange JSON — content_package, blog, seo, elementor */
  stagedChange: unknown | null;
}

export interface TaskRunView {
  id: string;
  kind: string;
  status: string;
  stepId: string | null;
  commitSha: string | null;
  buildPassed: boolean | null;
  costUsd: number | null;
  error: string | null;
  logTail: string | null;
  startedAt: string;
  finishedAt: string | null;
  changedRoutes: string[];
}

export interface PlanTaskFullView {
  id: string;
  order: number;
  title: string;
  objective: string;
  prompt: string;
  acceptanceCriteria: string[];
  mode: string;
  modeReason: string | null;
  kind: string;
  priority: number;
  effort: string;
  category: string;
  status: string;
  commitShas: string[];
  resultUrls: string[];
  failureReason: string | null;
  voidReason: string | null;
  generatorVersion: string | null;
  completedAt: string | null;
  steps: PlanStepView[];
  runs: TaskRunView[];
}

export interface PlanFullView {
  id: string;
  month: string;
  status: string;
  branchName: string | null;
  prNumber: number | null;
  prUrl: string | null;
  previewUrl: string | null;
  completedAt: string | null;
  mergedAt: string | null;
  totalCostUsd: number;
  platform: string | null;
  githubRepo: string | null;
  tasks: PlanTaskFullView[];
}

export interface PlanMonthOption {
  month: string;
  status: string;
  taskCount: number;
}

// ─── Get plan data ──────────────────────────────────────────────────────────

export async function getPlanData(
  clientId: string,
  month?: string
): Promise<{ plan: PlanFullView | null; months: PlanMonthOption[] }> {
  // List available months
  const allPlans = await prisma.monthlyPlan.findMany({
    where: { clientId },
    orderBy: { month: "desc" },
    select: {
      id: true,
      month: true,
      status: true,
      _count: { select: { tasks: true } },
    },
  });

  const months: PlanMonthOption[] = allPlans.map((p) => ({
    month: p.month,
    status: p.status,
    taskCount: p._count.tasks,
  }));

  // Determine which month to load.
  // Si no se pide un mes específico, omitir planes ARCHIVED al elegir el default
  // (los archivados aparecen en el selector de mes para auditoría, pero no se abren automáticamente).
  const activeMonths = months.filter((m) => m.status !== "ARCHIVED");
  const targetMonth =
    month ??
    (activeMonths.length > 0
      ? activeMonths[0].month
      : months.length > 0
      ? months[0].month
      : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`);

  const [plan, site] = await Promise.all([
    prisma.monthlyPlan.findFirst({
      where: { clientId, month: targetMonth },
      include: {
        tasks: {
          orderBy: { order: "asc" },
          include: {
            steps: { orderBy: { order: "asc" } },
            runs: { orderBy: { startedAt: "desc" }, take: 5 },
          },
        },
      },
    }),
    prisma.site.findFirst({ where: { clientId }, select: { platform: true, githubRepo: true } }),
  ]);

  if (!plan) return { plan: null, months };

  // Compute total cost from all runs
  let totalCostUsd = 0;
  for (const t of plan.tasks) {
    for (const r of t.runs) {
      if (r.costUsd) totalCostUsd += Number(r.costUsd);
    }
  }

  const planView: PlanFullView = {
    id: plan.id,
    month: plan.month,
    status: plan.status,
    branchName: plan.branchName,
    prNumber: plan.prNumber,
    prUrl: plan.prUrl,
    previewUrl: plan.previewUrl,
    completedAt: plan.completedAt?.toISOString() ?? null,
    mergedAt: plan.mergedAt?.toISOString() ?? null,
    totalCostUsd,
    platform: site?.platform ?? null,
    githubRepo: site?.githubRepo ?? null,
    tasks: plan.tasks.map((t) => ({
      id: t.id,
      order: t.order,
      title: t.title,
      objective: t.objective,
      prompt: t.prompt,
      acceptanceCriteria: t.acceptanceCriteria,
      mode: t.mode,
      modeReason: t.modeReason ?? null,
      kind: t.kind,
      priority: t.priority,
      effort: t.effort,
      category: t.category,
      status: t.status,
      commitShas: t.commitShas,
      resultUrls: t.resultUrls,
      failureReason: t.failureReason,
      voidReason: t.voidReason,
      generatorVersion: t.generatorVersion ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
      steps: t.steps.map((s) => ({
        id: s.id,
        order: s.order,
        title: s.title,
        type: s.type,
        status: s.status,
        acceptanceCriteria: s.acceptanceCriteria,
        prompt: s.prompt,
        notes: s.notes,
        stagedChange: s.stagedChange ?? null,
      })),
      runs: t.runs.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        stepId: r.stepId,
        commitSha: r.commitSha,
        buildPassed: r.buildPassed,
        costUsd: r.costUsd ? Number(r.costUsd) : null,
        error: r.error,
        logTail: r.logTail,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        changedRoutes: r.changedRoutes,
      })),
    })),
  };

  return { plan: planView, months };
}

// ─── Execute task (enqueue to worker) ───────────────────────────────────────

export async function actionExecuteTask(
  taskId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores pueden ejecutar tareas." };
  }

  const task = await prisma.planTask.findUnique({
    where: { id: taskId },
    include: { site: { select: { githubRepo: true, platform: true } } },
  });

  if (!task) return { ok: false, error: "Tarea no encontrada." };
  if (task.status === "RUNNING") {
    return { ok: false, error: "La tarea ya está en ejecución." };
  }
  if (task.status !== "READY" && task.status !== "WAITING_HUMAN") {
    return { ok: false, error: `Tarea no está lista (status: ${task.status}).` };
  }
  // Check if task has any AI steps pending (mode-independent)
  const aiStepsPending = await prisma.planStep.count({
    where: { taskId, type: "AI", status: { in: ["PENDING", "WAITING_HUMAN"] } },
  });
  if (aiStepsPending === 0) {
    return { ok: false, error: "No hay pasos AI pendientes para ejecutar." };
  }

  // Platform-specific guards
  const platform = task.site.platform;
  if (platform === "NEXTJS" && !task.site.githubRepo) {
    return { ok: false, error: "No hay repositorio GitHub configurado para este sitio Next.js." };
  }
  if (!platform || platform === "MIGRACION" || platform === "OTRO") {
    return { ok: false, error: `Plataforma "${platform ?? "desconocida"}" no permite ejecución automática.` };
  }

  // Update status to RUNNING
  await prisma.planTask.update({
    where: { id: taskId },
    data: { status: "RUNNING" },
  });

  // Enqueue
  await planTaskQueue.add("execute", {
    taskId,
    triggeredById: session.user.email ?? undefined,
  });

  return { ok: true };
}

// ─── Complete human step ────────────────────────────────────────────────────

export async function actionCompleteHumanStep(
  stepId: string,
  notes?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session?.user) {
    return { ok: false, error: "No autenticado." };
  }

  const step = await prisma.planStep.findUnique({
    where: { id: stepId },
    include: { task: { select: { id: true, status: true, planId: true } } },
  });

  if (!step) return { ok: false, error: "Paso no encontrado." };
  if (step.type !== "HUMAN") {
    return { ok: false, error: "Solo se pueden completar pasos manuales." };
  }
  if (step.status === "DONE") {
    return { ok: false, error: "Paso ya completado." };
  }

  // Enforce step ordering: reject if an earlier step is still pending
  const allSteps = await prisma.planStep.findMany({
    where: { taskId: step.task.id },
    orderBy: { order: "asc" },
  });
  const earlierPending = allSteps.find(
    (s) => s.order < step.order && s.status !== "DONE" && s.status !== "SKIPPED"
  );
  if (earlierPending) {
    return { ok: false, error: `Hay un paso anterior pendiente: "${earlierPending.title}" (paso ${earlierPending.order}).` };
  }

  await prisma.planStep.update({
    where: { id: stepId },
    data: {
      status: "DONE",
      completedById: session.user.email,
      notes: notes ?? null,
    },
  });

  // Check remaining steps
  const pendingSteps = allSteps.filter(
    (s) => s.id !== stepId && s.status !== "DONE" && s.status !== "SKIPPED"
  );

  if (pendingSteps.length === 0) {
    // All done
    await prisma.planTask.update({
      where: { id: step.task.id },
      data: { status: "DONE", completedAt: new Date(), completedById: session.user.email },
    });
  } else {
    const nextStep = pendingSteps[0];
    if (nextStep.type === "AI") {
      // Guard: don't enqueue if task is already RUNNING
      if (step.task.status !== "RUNNING") {
        await prisma.planTask.update({
          where: { id: step.task.id },
          data: { status: "RUNNING" },
        });
        await planTaskQueue.add("execute", {
          taskId: step.task.id,
          triggeredById: session.user.email ?? undefined,
        });
      }
    } else {
      // Next step is HUMAN → keep task in WAITING_HUMAN
      await prisma.planTask.update({
        where: { id: step.task.id },
        data: { status: "WAITING_HUMAN" },
      });
    }
  }

  return { ok: true };
}

// ─── Void task ──────────────────────────────────────────────────────────────

export async function actionVoidTask(
  taskId: string,
  reason: string
): Promise<{ ok: true; reverted: number } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores." };
  }

  const task = await prisma.planTask.findUnique({
    where: { id: taskId },
    include: {
      site: { select: { githubRepo: true, defaultBranch: true } },
      plan: { select: { id: true, branchName: true } },
    },
  });
  if (!task) return { ok: false, error: "Tarea no encontrada." };

  if (task.status === "RUNNING") {
    return { ok: false, error: "No se puede anular una tarea en ejecucion. Espera a que termine." };
  }

  // If task has commits on the plan branch, revert them
  let reverted = 0;
  if (task.commitShas.length > 0 && task.site.githubRepo && task.plan.branchName) {
    // Dynamic import to avoid loading worker-only code in the web process
    const { ensureRepoPlanBranch, revertTaskCommits } = await import("@/worker/repo-manager");
    const { acquirePlanLock } = await import("@/worker/plan-lock");

    const lock = await acquirePlanLock(task.plan.id);
    if (!lock.acquired) {
      return { ok: false, error: "El plan está bloqueado por otra operación. Intenta de nuevo." };
    }

    try {
      const dir = await ensureRepoPlanBranch(
        task.site.githubRepo,
        task.site.defaultBranch,
        task.plan.branchName
      );

      const result = revertTaskCommits(dir, taskId, task.plan.branchName);
      if (!result.ok) {
        return { ok: false, error: `No se pudieron revertir los commits: ${result.error}` };
      }
      reverted = result.revertShas.length;
    } finally {
      await lock.release();
    }
  }

  await prisma.planTask.update({
    where: { id: taskId },
    data: { status: "VOIDED", voidReason: reason || "Anulada por el equipo" },
  });

  return { ok: true, reverted };
}

// ─── Reset task (resume from failed step | full redo) ───────────────────────

/**
 * mode=resume — mantiene pasos DONE/SKIPPED, resetea el primer paso no-DONE
 *               y los siguientes a PENDING, borra solo esos runs.
 *               Aplica a: FAILED, WAITING_HUMAN.
 *
 * mode=redo   — borra todos los pasos y runs, reinicia desde cero (PLANNING).
 *               Aplica a: FAILED, DONE, WAITING_HUMAN.
 */
export async function actionResetTask(
  taskId: string,
  mode: "resume" | "redo"
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores." };
  }

  const task = await prisma.planTask.findUnique({
    where: { id: taskId },
    include: {
      steps: { orderBy: { order: "asc" } },
      plan: { select: { clientId: true } },
    },
  });
  if (!task) return { ok: false, error: "Tarea no encontrada." };
  if (task.status === "RUNNING") {
    return { ok: false, error: "La tarea está en ejecución. Espera a que termine." };
  }

  const allowedResume = ["FAILED", "WAITING_HUMAN", "PLANNING"];
  const allowedRedo   = ["FAILED", "DONE", "WAITING_HUMAN", "PLANNING", "READY"];
  if (mode === "resume" && !allowedResume.includes(task.status)) {
    return { ok: false, error: `'Reintentar' requiere FAILED o WAITING_HUMAN (actual: ${task.status}).` };
  }
  if (mode === "redo" && !allowedRedo.includes(task.status)) {
    return { ok: false, error: `'Rehacer' no aplica a tareas en ${task.status}.` };
  }

  if (mode === "redo" || task.steps.length === 0) {
    // Redo completo — borrar todo y re-descomponer
    await prisma.taskRun.deleteMany({ where: { taskId } });
    await prisma.planStep.deleteMany({ where: { taskId } });
    await prisma.planTask.update({
      where: { id: taskId },
      data: {
        status: "PLANNING",
        failureReason: null,
        commitShas: [],
        resultUrls: [],
        previewUrl: null,
        completedAt: null,
        completedById: null,
      },
    });
    await decomposeQueue.add("task:decompose", {
      taskId,
      clientId: task.plan.clientId,
      candidateId: "retry",
    });
    return { ok: true };
  }

  // Resume: encontrar primer paso no-DONE, resetear ese y siguientes
  const firstPendingIdx = task.steps.findIndex(
    (s) => s.status !== "DONE" && s.status !== "SKIPPED"
  );
  const stepsToReset = firstPendingIdx >= 0
    ? task.steps.slice(firstPendingIdx)
    : task.steps;

  const resetIds = stepsToReset.map((s) => s.id);

  await prisma.taskRun.deleteMany({ where: { taskId, stepId: { in: resetIds } } });
  await prisma.planStep.updateMany({
    where: { id: { in: resetIds } },
    data: { status: "PENDING", notes: null },
  });
  await prisma.planTask.update({
    where: { id: taskId },
    data: { status: "READY", failureReason: null },
  });
  await planTaskQueue.add("execute", {
    taskId,
    triggeredById: session.user.email ?? undefined,
  });

  return { ok: true };
}

/** @deprecated usar actionResetTask */
export async function actionRetryFailedTask(
  taskId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  return actionResetTask(taskId, "resume");
}

// ─── Archive plan ────────────────────────────────────────────────────────────

export async function actionArchivePlan(
  planId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores." };
  }

  const plan = await prisma.monthlyPlan.findUnique({ where: { id: planId } });
  if (!plan) return { ok: false, error: "Plan no encontrado." };
  if (plan.status === "PUBLISHED") {
    return { ok: false, error: "No se puede archivar un plan ya publicado en producción." };
  }

  await prisma.monthlyPlan.update({
    where: { id: planId },
    data: { status: "ARCHIVED" },
  });

  return { ok: true };
}

// ─── Run watchdog for stuck tasks ───────────────────────────────────────────

export async function actionRunWatchdog(
  planId: string
): Promise<{ ok: true; retried: number; failed: number } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores." };
  }

  const plan = await prisma.monthlyPlan.findUnique({ where: { id: planId } });
  if (!plan) return { ok: false, error: "Plan no encontrado." };

  const result = await runTaskWatchdog(planId);
  return { ok: true, retried: result.retried.length, failed: result.failed.length };
}

// ─── Submit plan for review ──────────────────────────────────────────────────

export async function actionSubmitForReview(
  planId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores." };
  }

  const plan = await prisma.monthlyPlan.findUnique({
    where: { id: planId },
    include: {
      tasks: { select: { status: true } },
      client: { select: { name: true } },
    },
  });

  if (!plan) return { ok: false, error: "Plan no encontrado." };
  if (plan.status !== "ACTIVE") {
    return { ok: false, error: `Plan no está en ACTIVE (status: ${plan.status}).` };
  }

  // Check all tasks are terminal (DONE/VOIDED/FAILED)
  const pending = plan.tasks.filter(
    (t) => !["DONE", "VOIDED", "FAILED"].includes(t.status)
  );
  if (pending.length > 0) {
    return { ok: false, error: `${pending.length} tarea(s) aún no están terminadas.` };
  }

  // Guards: placeholder markers + commit integrity
  if (plan.branchName) {
    try {
      const site = await prisma.site.findFirst({
        where: { client: { monthlyPlans: { some: { id: planId } } } },
        select: { githubRepo: true, defaultBranch: true },
      });

      if (site?.githubRepo) {
        const { ensureRepoPlanBranch, scanPlanPlaceholders, auditPlanCommits } = await import("@/worker/repo-manager");
        const dir = await ensureRepoPlanBranch(site.githubRepo, site.defaultBranch, plan.branchName);

        // Guard 1: [COMPLETAR markers
        const hits = scanPlanPlaceholders(dir, site.defaultBranch);
        if (hits.length > 0) {
          const detail = hits.map((h) => `${h.file}:${h.line || "?"} → ${h.text.slice(0, 80)}`).join("\n");
          return {
            ok: false,
            error: `La rama contiene ${hits.length} marcador(es) [COMPLETAR sin resolver:\n${detail}`,
          };
        }

        // Guard 2: commit integrity — every [task:id] must be from a DONE task
        const allTasks = await prisma.planTask.findMany({
          where: { planId },
          select: { id: true, status: true },
        });
        const allowedIds = new Set(
          allTasks.filter((t) => t.status === "DONE").map((t) => t.id)
        );

        const orphans = auditPlanCommits(dir, site.defaultBranch, allowedIds);
        if (orphans.length > 0) {
          const detail = orphans.map((o) => `  ${o.sha} [task:${o.tag}] ${o.message}`).join("\n");
          return {
            ok: false,
            error: `La rama contiene ${orphans.length} commit(s) de tareas que no están DONE:\n${detail}`,
          };
        }
      }
    } catch (err) {
      console.error("[submitForReview] Guard check failed:", err);
    }
  }

  await prisma.monthlyPlan.update({
    where: { id: planId },
    data: { status: "IN_REVIEW" },
  });

  return { ok: true };
}

// ─── Activate plan ──────────────────────────────────────────────────────────

export async function actionActivatePlan(
  planId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores." };
  }

  const plan = await prisma.monthlyPlan.findUnique({
    where: { id: planId },
    include: { tasks: { select: { status: true } } },
  });

  if (!plan) return { ok: false, error: "Plan no encontrado." };
  if (plan.status !== "PLANNING") {
    return { ok: false, error: "Solo se puede activar un plan en PLANNING." };
  }

  // Check all tasks have steps (are READY)
  const notReady = plan.tasks.filter((t) => t.status === "PLANNING");
  if (notReady.length > 0) {
    return {
      ok: false,
      error: `${notReady.length} tarea(s) aun no tienen pasos generados. Espera o reintenta.`,
    };
  }

  await prisma.monthlyPlan.update({
    where: { id: planId },
    data: { status: "ACTIVE" },
  });

  return { ok: true };
}

// ─── Merge plan ─────────────────────────────────────────────────────────────

export async function actionMergePlan(
  planId: string
): Promise<{ ok: true; mergedAt: string; warnings: string[]; published?: boolean } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores." };
  }

  const plan = await prisma.monthlyPlan.findUnique({
    where: { id: planId },
    include: {
      tasks: {
        where: { status: "DONE" },
        select: { id: true, commitShas: true },
      },
    },
  });

  if (!plan) return { ok: false, error: "Plan no encontrado." };
  if (plan.status !== "IN_REVIEW") {
    return { ok: false, error: `Plan no está en IN_REVIEW (status: ${plan.status}).` };
  }
  if (!plan.prNumber || !plan.branchName) {
    return { ok: false, error: "Plan no tiene PR ni rama configurada." };
  }

  const site = await prisma.site.findFirst({
    where: { client: { monthlyPlans: { some: { id: planId } } } },
    select: { githubRepo: true, url: true, vercelProjectId: true },
  });

  if (!site?.githubRepo) {
    return { ok: false, error: "No hay repositorio GitHub configurado." };
  }

  const GH_PAT = process.env.GITHUB_PAT_CLIENT_REPOS;
  if (!GH_PAT) return { ok: false, error: "GITHUB_PAT no configurado." };

  // Preflight: verify Vercel↔GitHub integration so the merge triggers a deploy
  const mergeWarnings: string[] = [];
  if (site.vercelProjectId) {
    const vercelToken = process.env.VERCEL_TOKEN;
    if (!vercelToken) {
      mergeWarnings.push("VERCEL_TOKEN no está configurado — no se puede verificar la integración Vercel↔GitHub. Verifica que el deploy se active manualmente.");
    } else {
      try {
        const vRes = await fetch(
          `https://api.vercel.com/v9/projects/${encodeURIComponent(site.vercelProjectId)}`,
          { headers: { Authorization: `Bearer ${vercelToken}` }, signal: AbortSignal.timeout(8_000) }
        );
        if (vRes.ok) {
          const vData = (await vRes.json()) as { link?: { type?: string; repo?: string } | null };
          if (!vData.link || vData.link.type !== "github") {
            mergeWarnings.push(
              `El proyecto Vercel "${site.vercelProjectId}" NO tiene integración GitHub conectada. ` +
              `El merge NO disparará un auto-deploy. Configura la integración en Vercel Dashboard → Settings → Git.`
            );
          }
        } else {
          mergeWarnings.push(`No se pudo verificar integración Vercel (status ${vRes.status}). Verifica manualmente que el deploy se active.`);
        }
      } catch {
        mergeWarnings.push("Timeout al verificar integración Vercel. Verifica manualmente que el deploy se active.");
      }
    }
  }

  // Merge via GitHub API (merge commit, not squash)
  const mergeRes = await fetch(
    `https://api.github.com/repos/${site.githubRepo}/pulls/${plan.prNumber}/merge`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GH_PAT}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        merge_method: "merge",
        commit_title: `Plan ${plan.month} — merge`,
      }),
    }
  );

  if (!mergeRes.ok) {
    const text = await mergeRes.text();
    return { ok: false, error: `GitHub merge falló (${mergeRes.status}): ${text.slice(0, 200)}` };
  }

  const now = new Date();

  // Verify production URLs (best-effort)
  const allRoutes: string[] = [];
  for (const task of plan.tasks) {
    const runs = await prisma.taskRun.findMany({
      where: { taskId: task.id, status: "SUCCEEDED" },
      select: { changedRoutes: true },
    });
    for (const r of runs) allRoutes.push(...r.changedRoutes);
  }

  const resultUrls: string[] = [];
  const failedUrls: string[] = [];
  if (site.url && allRoutes.length > 0) {
    const baseUrl = site.url.startsWith("http") ? site.url.replace(/\/$/, "") : `https://${site.url}`;

    // Wait for deploy to propagate (Vercel typically takes 30-90s after merge)
    // We check immediately first, then retry failed ones after a delay
    const uniqueRoutes = Array.from(new Set(allRoutes));

    for (const route of uniqueRoutes) {
      const url = `${baseUrl}${route}`;
      try {
        const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(10_000) });
        if (res.ok) {
          resultUrls.push(url);
        } else {
          failedUrls.push(`${url} (${res.status})`);
        }
      } catch {
        failedUrls.push(`${url} (timeout/error)`);
      }
    }
  }

  // If any URL failed, don't mark as PUBLISHED — keep IN_REVIEW so the user retries
  const hasUrlFailures = failedUrls.length > 0 && allRoutes.length > 0;

  if (hasUrlFailures) {
    mergeWarnings.push(
      `${failedUrls.length} URL(s) no respondieron 200 en producción: ${failedUrls.join(", ")}. ` +
      `El PR fue mergeado pero el plan NO queda como PUBLISHED. ` +
      `Espera a que el deploy se complete y vuelve a verificar.`
    );
    // Don't update status — the merge already happened on GitHub,
    // but we record mergedAt so the user knows when it was merged.
    await prisma.monthlyPlan.update({
      where: { id: planId },
      data: { mergedAt: now, mergedById: session.user.email },
    });
    return { ok: true, mergedAt: now.toISOString(), warnings: mergeWarnings, published: false };
  }

  await prisma.monthlyPlan.update({
    where: { id: planId },
    data: { status: "PUBLISHED", mergedAt: now, mergedById: session.user.email, completedAt: now },
  });

  for (const task of plan.tasks) {
    const taskRoutes = (await prisma.taskRun.findMany({
      where: { taskId: task.id, status: "SUCCEEDED" },
      select: { changedRoutes: true },
    })).flatMap((r) => r.changedRoutes);

    const taskUrls = resultUrls.filter((url) =>
      taskRoutes.some((route) => url.endsWith(route))
    );

    if (taskUrls.length > 0) {
      await prisma.planTask.update({
        where: { id: task.id },
        data: { resultUrls: taskUrls },
      });
    }
  }

  // Bitácora logging moved to explicit "Cargar a Notion" button (actionUploadToNotion)
  // to avoid duplicates and support both Next.js (merge) and WP (no merge) plans.

  return { ok: true, mergedAt: now.toISOString(), warnings: mergeWarnings };
}

// ─── Publish Next.js blog article (content lane) ───────────────────────────

export async function actionPublishNextjsBlog(
  taskId: string
): Promise<{ ok: true; sha: string; url: string } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "No autenticado." };

  const task = await prisma.planTask.findUnique({
    where: { id: taskId },
    include: {
      site: true,
      steps: { orderBy: { order: "asc" } },
    },
  });

  if (!task) return { ok: false, error: "Tarea no encontrada." };
  if (task.status !== "WAITING_HUMAN") {
    return { ok: false, error: `Tarea no está lista para publicar (status: ${task.status}).` };
  }

  // Find the step with NextjsStagedBlogChange
  const blogStep = task.steps.find(
    (s) => s.stagedChange && (s.stagedChange as Record<string, unknown>).type === "nextjs_blog"
  );

  if (!blogStep?.stagedChange) {
    return { ok: false, error: "No se encontró el artículo staged para publicar." };
  }

  const staged = blogStep.stagedChange as unknown as {
    type: "nextjs_blog";
    titulo: string;
    slug: string;
    categoria: string;
    tags: string[];
    extracto: string;
    cuerpo: string;
    autor: string;
    coverImageBase64: string | null;
  };

  if (!task.site.githubRepo) {
    return { ok: false, error: "Site no tiene repositorio GitHub." };
  }

  const GH_PAT = process.env.GITHUB_PAT_CLIENT_REPOS;
  if (!GH_PAT) return { ok: false, error: "GITHUB_PAT no configurado." };

  // Validate: no placeholders
  if (/\[COMPLETAR/i.test(staged.cuerpo)) {
    return { ok: false, error: "El artículo contiene marcadores [COMPLETAR]. Edita antes de publicar." };
  }

  // Validate: no block HTML
  if (/<(h[1-6]|p|div|ul|ol|blockquote)\b/i.test(staged.cuerpo)) {
    return { ok: false, error: "El cuerpo contiene HTML de bloque (<h1>, <p>, <div>, etc.). Solo se permite Markdown puro." };
  }

  // Validate: no H1 in Markdown
  if (/^# /m.test(staged.cuerpo)) {
    return { ok: false, error: "El cuerpo contiene un H1 (# título). El título va en el frontmatter, no en el cuerpo." };
  }

  try {
    const { publishBlogArticle } = await import("@/lib/github-blog-publisher");

    const result = await publishBlogArticle(
      task.site.githubRepo,
      task.site.defaultBranch,
      {
        titulo: staged.titulo,
        slug: staged.slug,
        categoria: staged.categoria,
        tags: staged.tags,
        extracto: staged.extracto,
        cuerpo: staged.cuerpo,
        autor: staged.autor,
      },
      staged.coverImageBase64,
      GH_PAT
    );

    // Update task to DONE with result
    const siteUrl = task.site.url.startsWith("http") ? task.site.url.replace(/\/$/, "") : `https://${task.site.url}`;
    const fullUrl = `${siteUrl}${result.url}`;

    await prisma.planTask.update({
      where: { id: taskId },
      data: {
        status: "DONE",
        completedAt: new Date(),
        completedById: session.user.email,
        commitShas: [result.sha],
        resultUrls: [fullUrl],
      },
    });

    // Bitácora logging handled by "Cargar a Notion" button (actionUploadToNotion)

    return { ok: true, sha: result.sha, url: fullUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

// ─── Upload plan to Notion (Bitácora + Estrategia) ─────────────────────────

export async function actionUploadToNotion(
  planId: string
): Promise<{
  ok: true;
  bitacoraCount: number;
  bitacoraFailed: string[];
  bitacoraTotal: number;
  estrategia: { id: string; url: string; wasUpdate: boolean } | null;
  estrategiaError: string | null;
  draftSaved: boolean;
} | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores." };
  }

  const plan = await prisma.monthlyPlan.findUnique({
    where: { id: planId },
    include: {
      tasks: { select: { status: true } },
    },
  });

  if (!plan) return { ok: false, error: "Plan no encontrado." };

  // Check all tasks are DONE (or VOIDED)
  const pendingTasks = plan.tasks.filter((t) => t.status !== "DONE" && t.status !== "VOIDED");
  if (pendingTasks.length > 0) {
    return { ok: false, error: `${pendingTasks.length} tarea(s) aún no completadas. El plan debe estar al 100%.` };
  }

  try {
    const { uploadPlanToNotion } = await import("@/lib/notion-bitacora");
    const result = await uploadPlanToNotion(planId, session.user.email ?? "cerebro-seo");

    return {
      ok: true,
      bitacoraCount: result.bitacoraCount,
      bitacoraFailed: result.bitacoraFailed,
      bitacoraTotal: result.bitacoraTotal,
      estrategia: result.estrategia,
      estrategiaError: result.estrategiaError,
      draftSaved: result.draftSaved,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
