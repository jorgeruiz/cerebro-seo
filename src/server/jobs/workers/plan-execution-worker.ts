import { createWorker } from "./base-worker";
import { prisma } from "@/lib/db";
import { planExecutionQueue, type PlanExecutionStepJobData } from "../queues";
import {
  executeChangeRequest,
  mapKindToChangeType,
  mapKindToSection,
  isHumanTask,
  type ConstructorItem,
} from "@/server/constructor/constructor-client";

/**
 * Worker de ejecución de planes en Constructor.
 *
 * Procesa 1 step a la vez (concurrency: 1).
 * Al completar un step, encola el siguiente con un delay escalonado.
 */
export const planExecutionWorker = createWorker<PlanExecutionStepJobData>(
  "plan-execution",
  async (job) => {
    const { stepExecutionId, executionId, clientId } = job.data;

    // Cargar step + execution
    const step = await prisma.stepExecution.findUniqueOrThrow({
      where: { id: stepExecutionId },
      include: {
        execution: {
          include: { plan: true, client: true },
        },
      },
    });

    // Guard: no re-procesar steps ya terminados
    if (step.status === "APPLIED" || step.status === "HUMAN_TASK") {
      return { skipped: true, stepIndex: step.stepIndex };
    }

    // Marcar como RUNNING
    await prisma.stepExecution.update({
      where: { id: stepExecutionId },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    await prisma.planExecution.update({
      where: { id: executionId },
      data: { status: "IN_PROGRESS" },
    });

    // Si es HUMAN_TASK, marcar y pasar al siguiente
    if (isHumanTask(step.kind)) {
      await prisma.stepExecution.update({
        where: { id: stepExecutionId },
        data: { status: "HUMAN_TASK", completedAt: new Date() },
      });
      await enqueueNextStep(executionId, step.stepIndex);
      return { humanTask: true, stepIndex: step.stepIndex };
    }

    // Construir request a Constructor
    const cerebroClientId = step.execution.client.cerebroClientId;
    if (!cerebroClientId) {
      await prisma.stepExecution.update({
        where: { id: stepExecutionId },
        data: {
          status: "FAILED",
          error: "Cliente no tiene cerebroClientId mapeado.",
          completedAt: new Date(),
        },
      });
      await checkExecutionComplete(executionId);
      return { error: "no cerebroClientId" };
    }

    const changeType = mapKindToChangeType(step.kind);
    if (!changeType) {
      // Shouldn't happen — isHumanTask should have caught this
      await prisma.stepExecution.update({
        where: { id: stepExecutionId },
        data: { status: "HUMAN_TASK", completedAt: new Date() },
      });
      await enqueueNextStep(executionId, step.stepIndex);
      return { humanTask: true, stepIndex: step.stepIndex };
    }

    const item: ConstructorItem = {
      section: mapKindToSection(step.kind),
      change_type: changeType,
      description: step.description,
      priority: "normal",
    };

    try {
      const result = await executeChangeRequest({
        notion_client_id: cerebroClientId,
        items: [item],
        idempotency_key: step.idempotencyKey,
      });

      if (result.success) {
        await prisma.stepExecution.update({
          where: { id: stepExecutionId },
          data: {
            status: "APPLIED",
            constructorId: result.id,
            constructorCode: result.requestCode,
            commitSha: result.commitSha,
            reviewUrl: result.reviewUrl,
            completedAt: new Date(),
          },
        });
      } else {
        // Constructor falló — guardar el prompt/descripción para ejecución manual
        await prisma.stepExecution.update({
          where: { id: stepExecutionId },
          data: {
            status: "FAILED",
            constructorId: result.id,
            reviewUrl: result.reviewUrl,
            error: result.error ?? "Constructor devolvió success:false",
            prompt: step.description,
            completedAt: new Date(),
          },
        });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await prisma.stepExecution.update({
        where: { id: stepExecutionId },
        data: {
          status: "FAILED",
          error: errMsg,
          prompt: step.description,
          completedAt: new Date(),
        },
      });
    }

    // Encolar siguiente step
    await enqueueNextStep(executionId, step.stepIndex);

    return { stepIndex: step.stepIndex, clientId };
  },
  { concurrency: 1 }
);

/**
 * Encola el siguiente step pendiente de la ejecución, con delay escalonado.
 * Si no hay más steps, marca la ejecución como completada.
 */
async function enqueueNextStep(
  executionId: string,
  currentIndex: number
): Promise<void> {
  const nextStep = await prisma.stepExecution.findFirst({
    where: {
      executionId,
      stepIndex: { gt: currentIndex },
      status: "PENDING",
    },
    orderBy: { stepIndex: "asc" },
    include: { execution: true },
  });

  if (!nextStep) {
    await checkExecutionComplete(executionId);
    return;
  }

  // Marcar como QUEUED
  await prisma.stepExecution.update({
    where: { id: nextStep.id },
    data: { status: "QUEUED" },
  });

  // Delay escalonado: 10s entre steps
  await planExecutionQueue.add(
    "plan-execution:step",
    {
      executionId,
      stepExecutionId: nextStep.id,
      clientId: nextStep.execution.clientId,
    },
    { delay: 10_000 }
  );
}

/**
 * Verifica si todos los steps están terminados y actualiza el status de la ejecución.
 */
async function checkExecutionComplete(executionId: string): Promise<void> {
  const remaining = await prisma.stepExecution.count({
    where: {
      executionId,
      status: { in: ["PENDING", "QUEUED", "RUNNING"] },
    },
  });

  if (remaining === 0) {
    const failed = await prisma.stepExecution.count({
      where: { executionId, status: "FAILED" },
    });

    await prisma.planExecution.update({
      where: { id: executionId },
      data: {
        status: failed > 0 ? "FAILED" : "COMPLETED",
      },
    });
  }
}
