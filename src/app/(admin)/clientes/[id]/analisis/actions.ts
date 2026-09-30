"use server";

import { getSession } from "@/lib/auth";
import { generateClientAnalysis, type AnalysisResult } from "@/lib/claude-analysis";
import { generatePlanMensual, type PlanMensualResult, type PlanTask } from "@/lib/claude-plan-mensual";
import { prisma } from "@/lib/db";
import { planExecutionQueue, type PlanExecutionStepJobData } from "@/server/jobs/queues";
import { mapKindToChangeType, isHumanTask } from "@/server/constructor/constructor-client";

export interface AnalysisRecord {
  id: string;
  analysis: AnalysisResult;
  model: string;
  cost: number;
  triggeredBy: string | null;
  createdAt: Date;
}

export async function actionGenerateAnalysis(
  clientId: string
): Promise<{ ok: true; record: AnalysisRecord } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session?.user) {
    return { ok: false, error: "No autenticado" };
  }

  try {
    const { analysis, analysisId } = await generateClientAnalysis(
      clientId,
      session.user.email ?? undefined
    );

    const record = await prisma.clientAnalysis.findUniqueOrThrow({
      where: { id: analysisId },
    });

    return {
      ok: true,
      record: {
        id: record.id,
        analysis,
        model: record.model,
        cost: Number(record.cost),
        triggeredBy: record.triggeredBy,
        createdAt: record.createdAt,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[analysis] Error generando análisis:", err);
    return { ok: false, error: msg };
  }
}

export async function getAnalysisHistory(clientId: string): Promise<AnalysisRecord[]> {
  const records = await prisma.clientAnalysis.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return records.map((r) => {
    const content = JSON.parse(r.content);
    return {
      id: r.id,
      analysis: (content.type === "plan-mensual" ? content : content) as AnalysisResult,
      model: r.model,
      cost: Number(r.cost),
      triggeredBy: r.triggeredBy,
      createdAt: r.createdAt,
    };
  });
}

// ─── Plan Mensual ────────────────────────────────────────────────────────────

export interface PlanMensualRecord {
  id: string;
  result: PlanMensualResult;
  model: string;
  cost: number;
  triggeredBy: string | null;
  createdAt: Date;
}

export async function actionGeneratePlanMensual(
  clientId: string
): Promise<{ ok: true; record: PlanMensualRecord } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores pueden generar planes." };
  }

  try {
    const { result, analysisId } = await generatePlanMensual(
      clientId,
      session.user.email ?? undefined
    );

    const record = await prisma.clientAnalysis.findUniqueOrThrow({
      where: { id: analysisId },
    });

    return {
      ok: true,
      record: {
        id: record.id,
        result,
        model: record.model,
        cost: Number(record.cost),
        triggeredBy: record.triggeredBy,
        createdAt: record.createdAt,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[plan-mensual] Error generando plan:", err);
    return { ok: false, error: msg };
  }
}

export async function actionSendTasksToPlan(
  clientId: string,
  tasks: PlanTask[]
): Promise<{ ok: true; executionId: string } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores." };
  }

  // Verificar framework nextjs
  const nextjsSite = await prisma.site.findFirst({
    where: { clientId, framework: "nextjs" },
    select: { id: true },
  });
  if (!nextjsSite) {
    return { ok: false, error: "Este cliente no tiene sitio Next.js. Constructor solo funciona con Next.js." };
  }

  if (tasks.length === 0) {
    return { ok: false, error: "No hay tareas seleccionadas." };
  }

  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Crear un NextStepPlan temporal para vincular la ejecución
  const plan = await prisma.nextStepPlan.create({
    data: {
      clientId,
      steps: tasks.map((t) => ({
        titulo: t.titulo,
        descripcion: t.descripcion,
        categoria: t.urgencia === "alta" ? "urgente" : "mejora",
        prioridad: t.urgencia === "alta" ? 1 : t.urgencia === "media" ? 3 : 5,
        evidencia: t.evidencia,
        kind: t.kind,
        targetUrl: t.targetUrl,
        keywords: t.keywords,
      })),
      model: "plan-mensual",
      status: "valid",
      triggeredBy: session.user.email ?? null,
    },
  });

  const execution = await prisma.planExecution.create({
    data: {
      planId: plan.id,
      clientId,
      yearMonth,
      triggeredBy: session.user.email ?? null,
      steps: {
        create: tasks.map((task, index) => {
          const kind = task.kind;
          const changeType = mapKindToChangeType(kind);
          return {
            stepIndex: index,
            kind,
            changeType,
            title: task.titulo,
            description: `${task.descripcion}\n\nEvidencia: ${task.evidencia}${task.targetUrl ? `\nURL objetivo: ${task.targetUrl}` : ""}${task.keywords?.length ? `\nKeywords: ${task.keywords.join(", ")}` : ""}`,
            status: isHumanTask(kind) ? "HUMAN_TASK" : "PENDING",
            idempotencyKey: `seo-${plan.id}-${index}`,
          };
        }),
      },
    },
    include: { steps: true },
  });

  // Encolar el primer step automático
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
  }

  return { ok: true, executionId: execution.id };
}
