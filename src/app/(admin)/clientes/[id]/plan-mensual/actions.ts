"use server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface StepExecutionView {
  id: string;
  stepIndex: number;
  kind: string;
  title: string;
  description: string;
  status: string;
  error: string | null;
  prompt: string | null;
  resultUrl: string | null;
  reviewUrl: string | null;
  commitSha: string | null;
  detailedSteps: unknown;
  completedAt: Date | null;
}

export interface PlanExecutionView {
  id: string;
  status: string;
  yearMonth: string;
  triggeredBy: string | null;
  createdAt: Date;
  steps: StepExecutionView[];
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function getPlanExecutions(
  clientId: string,
  yearMonth?: string
): Promise<PlanExecutionView[]> {
  const executions = await prisma.planExecution.findMany({
    where: {
      clientId,
      ...(yearMonth ? { yearMonth } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      steps: { orderBy: { stepIndex: "asc" } },
    },
  });

  return executions.map((e) => ({
    id: e.id,
    status: e.status,
    yearMonth: e.yearMonth,
    triggeredBy: e.triggeredBy,
    createdAt: e.createdAt,
    steps: e.steps.map((s) => ({
      id: s.id,
      stepIndex: s.stepIndex,
      kind: s.kind,
      title: s.title,
      description: s.description,
      status: s.status,
      error: s.error,
      prompt: s.prompt,
      resultUrl: s.resultUrl,
      reviewUrl: s.reviewUrl,
      commitSha: s.commitSha,
      detailedSteps: s.detailedSteps,
      completedAt: s.completedAt,
    })),
  }));
}

export async function getAvailableMonths(clientId: string): Promise<string[]> {
  const result = await prisma.planExecution.findMany({
    where: { clientId },
    select: { yearMonth: true },
    distinct: ["yearMonth"],
    orderBy: { yearMonth: "desc" },
  });
  return result.map((r) => r.yearMonth);
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export async function actionCompleteStep(
  stepId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "No autenticado." };

  const step = await prisma.stepExecution.findUnique({
    where: { id: stepId },
    select: { status: true, executionId: true },
  });

  if (!step) return { ok: false, error: "Step no encontrado." };
  if (step.status !== "HUMAN_TASK") {
    return { ok: false, error: "Solo se pueden completar tareas manuales." };
  }

  await prisma.stepExecution.update({
    where: { id: stepId },
    data: { status: "APPLIED", completedAt: new Date() },
  });

  await recalcExecutionStatus(step.executionId);
  return { ok: true };
}

export async function actionIgnoreStep(
  stepId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "No autenticado." };

  const step = await prisma.stepExecution.findUnique({
    where: { id: stepId },
    select: { status: true, executionId: true },
  });

  if (!step) return { ok: false, error: "Step no encontrado." };
  if (step.status !== "FAILED") {
    return { ok: false, error: "Solo se pueden ignorar tareas fallidas." };
  }

  await prisma.stepExecution.update({
    where: { id: stepId },
    data: { status: "IGNORED", completedAt: new Date() },
  });

  await recalcExecutionStatus(step.executionId);
  return { ok: true };
}

async function recalcExecutionStatus(executionId: string): Promise<void> {
  const remaining = await prisma.stepExecution.count({
    where: {
      executionId,
      status: { in: ["PENDING", "QUEUED", "RUNNING"] },
    },
  });

  if (remaining > 0) return;

  // Todos terminados — ¿hay HT pendientes?
  const pendingHt = await prisma.stepExecution.count({
    where: { executionId, status: "HUMAN_TASK" },
  });

  if (pendingHt > 0) return; // Aún hay HTs sin completar

  const failed = await prisma.stepExecution.count({
    where: { executionId, status: "FAILED" },
  });

  await prisma.planExecution.update({
    where: { id: executionId },
    data: { status: failed > 0 ? "FAILED" : "COMPLETED" },
  });
}
