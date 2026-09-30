"use server";

import { getSession } from "@/lib/auth";
import { runAdvisorProcessor } from "@/lib/seo-advisor/advisor-processor";
import { prisma } from "@/lib/db";
import { planExecutionQueue, type PlanExecutionStepJobData } from "@/server/jobs/queues";
import {
  mapKindToChangeType,
  isHumanTask,
} from "@/server/constructor/constructor-client";
import type { NextStep } from "@/lib/seo-advisor/types";

export interface NextStepPlanRecord {
  id: string;
  steps: NextStep[];
  model: string;
  cost: number;
  triggeredBy: string | null;
  generatedAt: Date;
}

export async function actionRegenerateNextSteps(
  clientId: string
): Promise<{ ok: true; record: NextStepPlanRecord } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores pueden regenerar el plan." };
  }

  try {
    const result = await runAdvisorProcessor({
      clientId,
      triggeredBy: session.user.email ?? undefined,
      scheduled: false, // omitir idempotencia diaria — regeneración manual
    });

    const record = await prisma.nextStepPlan.findUniqueOrThrow({
      where: { id: result.planId },
    });

    return {
      ok: true,
      record: {
        id: record.id,
        steps: record.steps as unknown as NextStep[],
        model: record.model,
        cost: Number(record.cost),
        triggeredBy: record.triggeredBy,
        generatedAt: record.generatedAt,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[seo-advisor] Error regenerando plan:", err);
    return { ok: false, error: msg };
  }
}

export async function getLatestNextStepPlan(
  clientId: string
): Promise<NextStepPlanRecord | null> {
  const record = await prisma.nextStepPlan.findFirst({
    where: { clientId },
    orderBy: { generatedAt: "desc" },
  });
  if (!record) return null;

  return {
    id: record.id,
    steps: record.steps as unknown as NextStep[],
    model: record.model,
    cost: Number(record.cost),
    triggeredBy: record.triggeredBy,
    generatedAt: record.generatedAt,
  };
}

// ─── Ejecución de plan en Constructor ──────────────────────────────────────

export interface PlanExecutionSummary {
  executionId: string;
  totalSteps: number;
  autoSteps: number;
  humanSteps: number;
}

export async function actionApprovePlan(
  clientId: string
): Promise<{ ok: true; summary: PlanExecutionSummary } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores pueden ejecutar planes." };
  }

  // Obtener plan más reciente válido
  const plan = await prisma.nextStepPlan.findFirst({
    where: { clientId, status: "valid" },
    orderBy: { generatedAt: "desc" },
  });

  if (!plan) {
    return { ok: false, error: "No hay plan válido para este cliente." };
  }

  const steps = plan.steps as unknown as NextStep[];
  if (steps.length === 0) {
    return { ok: false, error: "El plan no tiene pasos." };
  }

  // Verificar que no exista una ejecución activa para este plan
  const existingExecution = await prisma.planExecution.findFirst({
    where: {
      planId: plan.id,
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
  });

  if (existingExecution) {
    return { ok: false, error: "Ya existe una ejecución activa para este plan." };
  }

  // Crear PlanExecution + StepExecutions
  const execution = await prisma.planExecution.create({
    data: {
      planId: plan.id,
      clientId,
      triggeredBy: session.user.email ?? null,
      steps: {
        create: steps.map((step, index) => {
          const kind = step.kind ?? "otro";
          const changeType = mapKindToChangeType(kind);
          return {
            stepIndex: index,
            kind,
            changeType,
            title: step.titulo,
            description: `${step.descripcion}\n\nEvidencia: ${step.evidencia}${step.targetUrl ? `\nURL objetivo: ${step.targetUrl}` : ""}${step.keywords?.length ? `\nKeywords: ${step.keywords.join(", ")}` : ""}`,
            status: isHumanTask(kind) ? "HUMAN_TASK" : "PENDING",
            idempotencyKey: `seo-${plan.id}-${index}`,
          };
        }),
      },
    },
    include: { steps: true },
  });

  // Encolar el primer step que no sea HUMAN_TASK
  const firstAutoStep = execution.steps.find((s) => s.status === "PENDING");
  if (firstAutoStep) {
    await prisma.stepExecution.update({
      where: { id: firstAutoStep.id },
      data: { status: "QUEUED" },
    });

    const jobData: PlanExecutionStepJobData = {
      executionId: execution.id,
      stepExecutionId: firstAutoStep.id,
      clientId,
    };

    await planExecutionQueue.add("plan-execution:step", jobData);
  } else {
    // Todos son HUMAN_TASK — marcar ejecución como completada
    await prisma.planExecution.update({
      where: { id: execution.id },
      data: { status: "COMPLETED" },
    });
  }

  const autoSteps = execution.steps.filter((s) => s.status !== "HUMAN_TASK").length;
  const humanSteps = execution.steps.filter((s) => s.status === "HUMAN_TASK").length;

  return {
    ok: true,
    summary: {
      executionId: execution.id,
      totalSteps: steps.length,
      autoSteps,
      humanSteps,
    },
  };
}

export interface PlanExecutionStatus {
  id: string;
  status: string;
  steps: Array<{
    stepIndex: number;
    title: string;
    kind: string;
    status: string;
    error: string | null;
    reviewUrl: string | null;
  }>;
  createdAt: Date;
}

export async function getLatestPlanExecution(
  clientId: string
): Promise<PlanExecutionStatus | null> {
  const execution = await prisma.planExecution.findFirst({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    include: {
      steps: { orderBy: { stepIndex: "asc" } },
    },
  });

  if (!execution) return null;

  return {
    id: execution.id,
    status: execution.status,
    steps: execution.steps.map((s) => ({
      stepIndex: s.stepIndex,
      title: s.title,
      kind: s.kind,
      status: s.status,
      error: s.error,
      reviewUrl: s.reviewUrl,
    })),
    createdAt: execution.createdAt,
  };
}
