"use server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { planTaskQueue, aiAnalysisQueue } from "@/server/jobs/queues";
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
}

export interface TaskRunView {
  id: string;
  kind: string;
  status: string;
  commitSha: string | null;
  buildPassed: boolean | null;
  costUsd: number | null;
  error: string | null;
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
  kind: string;
  priority: number;
  effort: string;
  category: string;
  status: string;
  commitShas: string[];
  resultUrls: string[];
  failureReason: string | null;
  voidReason: string | null;
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

  // Determine which month to load
  const targetMonth =
    month ??
    (months.length > 0
      ? months[0].month
      : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`);

  const plan = await prisma.monthlyPlan.findFirst({
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
  });

  if (!plan) return { plan: null, months };

  const planView: PlanFullView = {
    id: plan.id,
    month: plan.month,
    status: plan.status,
    branchName: plan.branchName,
    prNumber: plan.prNumber,
    prUrl: plan.prUrl,
    previewUrl: plan.previewUrl,
    completedAt: plan.completedAt?.toISOString() ?? null,
    tasks: plan.tasks.map((t) => ({
      id: t.id,
      order: t.order,
      title: t.title,
      objective: t.objective,
      prompt: t.prompt,
      acceptanceCriteria: t.acceptanceCriteria,
      mode: t.mode,
      kind: t.kind,
      priority: t.priority,
      effort: t.effort,
      category: t.category,
      status: t.status,
      commitShas: t.commitShas,
      resultUrls: t.resultUrls,
      failureReason: t.failureReason,
      voidReason: t.voidReason,
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
      })),
      runs: t.runs.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        commitSha: r.commitSha,
        buildPassed: r.buildPassed,
        costUsd: r.costUsd ? Number(r.costUsd) : null,
        error: r.error,
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
  if (task.status !== "READY") {
    return { ok: false, error: `Tarea no está lista (status: ${task.status}).` };
  }
  if (task.mode === "HUMAN") {
    return { ok: false, error: "Las tareas manuales no se ejecutan con el worker." };
  }
  if (!task.site.githubRepo) {
    return { ok: false, error: "No hay repositorio GitHub configurado." };
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

  await prisma.planStep.update({
    where: { id: stepId },
    data: {
      status: "DONE",
      completedById: session.user.email,
      notes: notes ?? null,
    },
  });

  // Check if all steps of this task are done
  const allSteps = await prisma.planStep.findMany({
    where: { taskId: step.task.id },
  });
  const allDone = allSteps.every(
    (s) => s.id === stepId ? true : s.status === "DONE" || s.status === "SKIPPED"
  );

  if (allDone) {
    await prisma.planTask.update({
      where: { id: step.task.id },
      data: { status: "DONE", completedAt: new Date(), completedById: session.user.email },
    });
  }

  return { ok: true };
}

// ─── Void task ──────────────────────────────────────────────────────────────

export async function actionVoidTask(
  taskId: string,
  reason: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores." };
  }

  const task = await prisma.planTask.findUnique({ where: { id: taskId } });
  if (!task) return { ok: false, error: "Tarea no encontrada." };

  // Can void from most states except RUNNING
  if (task.status === "RUNNING") {
    return { ok: false, error: "No se puede anular una tarea en ejecucion. Espera a que termine." };
  }

  await prisma.planTask.update({
    where: { id: taskId },
    data: { status: "VOIDED", voidReason: reason || "Anulada por el equipo" },
  });

  return { ok: true };
}

// ─── Retry failed task ──────────────────────────────────────────────────────

export async function actionRetryFailedTask(
  taskId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores." };
  }

  const task = await prisma.planTask.findUnique({
    where: { id: taskId },
    include: {
      steps: { select: { id: true } },
      plan: { select: { clientId: true } },
    },
  });
  if (!task) return { ok: false, error: "Tarea no encontrada." };
  if (task.status !== "FAILED" && task.status !== "PLANNING") {
    return { ok: false, error: "Solo se pueden reintentar tareas en FAILED o PLANNING." };
  }

  if (task.steps.length === 0) {
    // Failed during decomposition — re-enqueue decompose
    await prisma.planTask.update({
      where: { id: taskId },
      data: { status: "PLANNING", failureReason: null },
    });
    await prisma.planStep.deleteMany({ where: { taskId } });
    await aiAnalysisQueue.add("task:decompose", {
      taskId,
      clientId: task.plan.clientId,
      candidateId: "retry",
    });
  } else {
    // Failed during execution — reset to READY (steps exist)
    await prisma.planTask.update({
      where: { id: taskId },
      data: { status: "READY", failureReason: null },
    });
  }

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
