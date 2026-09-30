import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "@/lib/anthropic-config";
import { createWorker } from "./base-worker";
import { prisma } from "@/lib/db";
import { planExecutionQueue, type PlanExecutionStepJobData } from "../queues";
import {
  executeChangeRequest,
  publishBlogPost,
  publishLanding,
  getExecutionRoute,
  mapKindToChangeType,
  mapKindToSection,
  isHumanTask,
  type ConstructorItem,
  type ConstructorResult,
  type DirectPublishResult,
} from "@/server/constructor/constructor-client";

/**
 * Worker de ejecución de planes en Constructor.
 *
 * Procesa 1 step a la vez (concurrency: 1).
 * Rutea automáticamente al endpoint correcto:
 * - meta, blog, landing → endpoints directos ($0, 3-8s)
 * - schema, tecnico, etc. → agente SSE (~$0.05, 30-90s)
 * - setup, otro → HUMAN_TASK (skip)
 */
export const planExecutionWorker = createWorker<PlanExecutionStepJobData>(
  "plan-execution",
  async (job) => {
    const { stepExecutionId, executionId, clientId } = job.data;

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

    // Si es HUMAN_TASK, generar pasos detallados con Claude y marcar
    if (isHumanTask(step.kind)) {
      const detailedSteps = await generateHumanTaskSteps(step.title, step.description);
      const prompt = await generateHumanTaskPrompt(step.title, step.description);
      await prisma.stepExecution.update({
        where: { id: stepExecutionId },
        data: {
          status: "HUMAN_TASK",
          detailedSteps,
          prompt,
          completedAt: null, // HT no se completa hasta que el usuario lo marque
        },
      });
      await enqueueNextStep(executionId, step.stepIndex);
      return { humanTask: true, stepIndex: step.stepIndex };
    }

    // Verificar cerebroClientId
    const cerebroClientId = step.execution.client.cerebroClientId;
    if (!cerebroClientId) {
      await markStepFailed(stepExecutionId, "Cliente no tiene cerebroClientId mapeado.");
      await checkExecutionComplete(executionId);
      return { error: "no cerebroClientId" };
    }

    // Rutear al endpoint correcto
    const route = getExecutionRoute(step.kind);

    try {
      let success = false;
      let commitSha: string | undefined;
      let reviewUrl: string | undefined;
      let constructorId: string | undefined;
      let constructorCode: string | undefined;
      let errorMsg: string | undefined;
      let prompt: string | undefined;

      if (route === "direct-blog") {
        const result = await executeBlogPublish(cerebroClientId, step.description);
        success = result.success;
        commitSha = result.sha;
        errorMsg = result.error;
        if (result.needsBootstrap) {
          errorMsg = "Blog no bootstrapped — requiere configuración manual en Constructor.";
        }
      } else if (route === "direct-landing") {
        const result = await executeLandingPublish(cerebroClientId, step.description);
        success = result.success;
        commitSha = result.sha;
        errorMsg = result.error;
        if (result.needsBootstrap) {
          errorMsg = "Landing pages no bootstrapped — requiere configuración manual en Constructor.";
        }
      } else if (route === "direct-meta") {
        const result = await executeMetaTagsPublish(cerebroClientId, step.description, step.idempotencyKey);
        success = result.success;
        commitSha = result.sha;
        errorMsg = result.error;
      } else {
        // Agente SSE
        const result = await executeAgentChangeRequest(cerebroClientId, step);
        success = result.success;
        commitSha = result.commitSha;
        reviewUrl = result.reviewUrl;
        constructorId = result.id;
        constructorCode = result.requestCode;
        errorMsg = result.error;
        prompt = result.prompt;
      }

      if (success) {
        // Build resultUrl: prefer commitUrl for agent, or construct from slug for direct
        const finalResultUrl = reviewUrl ?? (commitSha ? `https://github.com/commit/${commitSha}` : undefined);

        await prisma.stepExecution.update({
          where: { id: stepExecutionId },
          data: {
            status: "APPLIED",
            constructorId,
            constructorCode,
            commitSha,
            reviewUrl,
            resultUrl: finalResultUrl,
            completedAt: new Date(),
          },
        });
      } else {
        await prisma.stepExecution.update({
          where: { id: stepExecutionId },
          data: {
            status: "FAILED",
            constructorId,
            reviewUrl,
            error: errorMsg ?? "Constructor devolvió success:false",
            prompt: prompt ?? step.description,
            completedAt: new Date(),
          },
        });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await markStepFailed(stepExecutionId, errMsg, step.description);
    }

    await enqueueNextStep(executionId, step.stepIndex);
    return { stepIndex: step.stepIndex, clientId };
  },
  { concurrency: 1 }
);

// ─── Ejecución por ruta ─────────────────────────────────────────────────────

/**
 * Extrae título y cuerpo del campo description del step.
 * El description tiene formato: "Descripción\n\nEvidencia: ...\nURL objetivo: ..."
 * Para publicación directa, usamos la primera línea como título y el resto como cuerpo.
 */
function parseStepContent(description: string): { titulo: string; cuerpo: string; extracto: string } {
  const lines = description.split("\n");
  const titulo = lines[0] ?? "Sin título";
  const cuerpo = lines.slice(1).join("\n").trim();
  const extracto = titulo.slice(0, 160);
  return { titulo, cuerpo: cuerpo || titulo, extracto };
}

async function executeBlogPublish(
  notionClientId: string,
  description: string
): Promise<DirectPublishResult> {
  const { titulo, cuerpo, extracto } = parseStepContent(description);
  return publishBlogPost({
    notionClientId,
    titulo,
    cuerpo,
    extracto,
  });
}

async function executeLandingPublish(
  notionClientId: string,
  description: string
): Promise<DirectPublishResult> {
  const { titulo, cuerpo } = parseStepContent(description);
  return publishLanding({
    notionClientId,
    titulo,
    descripcion: titulo,
    cuerpo,
  });
}

async function executeMetaTagsPublish(
  notionClientId: string,
  description: string,
  idempotencyKey: string
): Promise<DirectPublishResult> {
  // Meta tags requieren page_paths estructurados que no tenemos en el description.
  // Fallback al agente SSE que interpreta las instrucciones del description.
  const agentResult = await executeChangeRequest({
    notion_client_id: notionClientId,
    items: [{
      section: "Meta tags",
      change_type: "text_update",
      description,
      priority: "normal",
    }],
    idempotency_key: idempotencyKey,
  });

  return {
    success: agentResult.success,
    sha: agentResult.commitSha,
    error: agentResult.error,
  };
}

async function executeAgentChangeRequest(
  cerebroClientId: string,
  step: { kind: string; description: string; idempotencyKey: string }
): Promise<ConstructorResult> {
  const changeType = mapKindToChangeType(step.kind);
  const item: ConstructorItem = {
    section: mapKindToSection(step.kind),
    change_type: changeType ?? "code_change",
    description: step.description,
    priority: "normal",
  };

  return executeChangeRequest({
    notion_client_id: cerebroClientId,
    items: [item],
    idempotency_key: step.idempotencyKey,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function markStepFailed(
  stepExecutionId: string,
  error: string,
  prompt?: string
): Promise<void> {
  await prisma.stepExecution.update({
    where: { id: stepExecutionId },
    data: {
      status: "FAILED",
      error,
      prompt: prompt ?? null,
      completedAt: new Date(),
    },
  });
}

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

  await prisma.stepExecution.update({
    where: { id: nextStep.id },
    data: { status: "QUEUED" },
  });

  // Delay: 5s para directos, 10s para agente
  const route = getExecutionRoute(nextStep.kind);
  const delay = route.startsWith("direct") ? 5_000 : 10_000;

  await planExecutionQueue.add(
    "plan-execution:step",
    {
      executionId,
      stepExecutionId: nextStep.id,
      clientId: nextStep.execution.clientId,
    },
    { delay }
  );
}

async function checkExecutionComplete(executionId: string): Promise<void> {
  const remaining = await prisma.stepExecution.count({
    where: {
      executionId,
      status: { in: ["PENDING", "QUEUED", "RUNNING"] },
    },
  });

  if (remaining > 0) return;

  // HT pendientes no bloquean la ejecución automática,
  // pero no marcamos como COMPLETED hasta que todo esté resuelto
  const pendingHt = await prisma.stepExecution.count({
    where: { executionId, status: "HUMAN_TASK" },
  });

  if (pendingHt > 0) return;

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

// ─── Claude: generar pasos detallados para Human Tasks ───────────────────────

const anthropic = new Anthropic();

async function generateHumanTaskSteps(
  title: string,
  description: string
): Promise<string[]> {
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: `Genera una lista de pasos concretos y accionables para implementar esta tarea SEO manualmente.

Tarea: ${title}
Descripción: ${description}

Responde SOLO con un JSON array de strings, cada uno un paso claro y breve. Máximo 8 pasos.
Ejemplo: ["Paso 1...", "Paso 2...", "Paso 3..."]`,
      }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [description];

    const parsed = JSON.parse(match[0]) as string[];
    return Array.isArray(parsed) ? parsed : [description];
  } catch (err) {
    console.error("[plan-execution] Error generating HT steps:", err);
    return [description];
  }
}

async function generateHumanTaskPrompt(
  title: string,
  description: string
): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: `Genera un prompt listo para pegar en Claude Code que implemente esta tarea SEO.
El prompt debe ser específico, incluir qué archivos modificar y qué cambios hacer.

Tarea: ${title}
Descripción: ${description}

Responde SOLO con el prompt, sin explicaciones adicionales. El prompt debe empezar directamente con las instrucciones.`,
      }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    return text || description;
  } catch (err) {
    console.error("[plan-execution] Error generating HT prompt:", err);
    return description;
  }
}
