/**
 * Job de descomposición de tareas en PlanSteps.
 *
 * Lee docs del repo vía GitHub API (sin clonar), genera pasos con Claude,
 * y crea PlanSteps en BD. Corre en la cola ai-analysis (proceso web),
 * no en el worker de agentes.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CLAUDE_MODEL } from "@/lib/anthropic-config";
import { prisma } from "@/lib/db";
import { calculateClaudeCost, logApiUsage } from "@/server/jobs/workers/base-worker";

// ─── Types ───────────────────────────────────────────────────────────────────

const stepSchema = z.object({
  title: z.string().min(5).max(120),
  type: z.enum(["AI", "HUMAN"]),
  prompt: z.string().nullable().optional(),
  acceptanceCriteria: z.array(z.string()),
});

interface DecompositionJobData {
  taskId: string;
  clientId: string;
  candidateId: string;
}

// ─── GitHub API helpers ──────────────────────────────────────────────────────

async function fetchRepoFile(
  githubRepo: string,
  path: string,
  pat?: string
): Promise<string | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.raw",
  };
  if (pat) headers.Authorization = `Bearer ${pat}`;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${githubRepo}/contents/${path}`,
      { headers, signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

async function gatherRepoContext(githubRepo: string): Promise<string> {
  const pat = process.env.GITHUB_PAT_CLIENT_REPOS;
  const files = [
    { path: "docs/site-spec.md", label: "Site Spec" },
    { path: "docs/site-map.md", label: "Site Map" },
    { path: "docs/catalog-schemas.md", label: "Catalog Schemas" },
    { path: "DESIGN.md", label: "Design Guide" },
    { path: "CLAUDE.md", label: "CLAUDE.md" },
  ];

  const sections: string[] = [];
  for (const { path, label } of files) {
    const content = await fetchRepoFile(githubRepo, path, pat);
    if (content && content.trim().length > 50) {
      // Truncate to 2000 chars to keep context manageable
      sections.push(`## ${label} (${path})\n${content.slice(0, 2000)}`);
    }
  }

  return sections.length > 0
    ? sections.join("\n\n")
    : "No hay documentación del sitio disponible.";
}

// ─── Decomposition ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres un planificador de tareas SEO para sitios Next.js. Tu trabajo: descomponer una tarea en pasos concretos y accionables.

REGLAS:
1. Cada paso AI debe tener un prompt AUTOSUFICIENTE que incluya qué archivos tocar, qué cambiar exactamente y criterios de aceptación verificables.
2. Cada paso HUMAN debe tener instrucciones claras de qué hacer y cómo saber que está hecho.
3. Tareas mode=AI: solo pasos type=AI.
4. Tareas mode=HYBRID: pasos AI y HUMAN intercalados. Los pasos AI van primero (código), luego los HUMAN (revisión/validación).
5. Tareas mode=HUMAN o kind=SETUP: solo pasos type=HUMAN.
6. Entre 1 y 5 pasos por tarea. Un paso = una acción atómica.
7. Los prompts de pasos AI deben mencionar el CLAUDE.md y DESIGN.md del repo si existen.

RESPONDE ÚNICAMENTE con un JSON array:
[
  {
    "title": "Título corto del paso (max 120 chars)",
    "type": "AI|HUMAN",
    "prompt": "Prompt completo autosuficiente para el agente (solo AI, null para HUMAN)",
    "acceptanceCriteria": ["Criterio 1 verificable", "Criterio 2"]
  }
]

Sin texto fuera del JSON.`;

export async function decomposeTask(data: DecompositionJobData): Promise<void> {
  const { taskId, clientId } = data;

  const task = await prisma.planTask.findUniqueOrThrow({
    where: { id: taskId },
    include: { site: true },
  });

  // Gather repo context
  let repoContext = "No hay repositorio configurado.";
  if (task.site?.githubRepo) {
    repoContext = await gatherRepoContext(task.site.githubRepo);
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userPrompt = `Descompón esta tarea en pasos:

TAREA: ${task.title}
OBJETIVO: ${task.objective}
KIND: ${task.kind}
MODE: ${task.mode}
PRIORIDAD: ${task.priority}
ESFUERZO: ${task.effort}

CONTEXTO DEL SITIO:
${repoContext}

Genera los pasos como JSON array.`;

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const rawText = response.content[0]?.type === "text" ? response.content[0].text : "[]";
    const jsonStr = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    let parsedSteps: unknown[];
    try {
      parsedSteps = JSON.parse(jsonStr) as unknown[];
    } catch {
      throw new Error(`JSON parse failed: ${jsonStr.slice(0, 200)}`);
    }

    if (!Array.isArray(parsedSteps) || parsedSteps.length === 0) {
      throw new Error("Claude devolvió 0 pasos");
    }

    // Validate each step with Zod, skip invalid ones
    const validSteps: z.infer<typeof stepSchema>[] = [];
    for (const raw of parsedSteps) {
      const result = stepSchema.safeParse(raw);
      if (result.success) {
        validSteps.push(result.data);
      } else {
        console.warn("[task-decomposer] Step inválido descartado:", JSON.stringify(raw).slice(0, 200));
      }
    }

    if (validSteps.length === 0) {
      throw new Error("Todos los pasos fueron inválidos");
    }

    // Create PlanSteps
    for (let i = 0; i < validSteps.length; i++) {
      const step = validSteps[i];
      await prisma.planStep.create({
        data: {
          taskId,
          order: i + 1,
          title: step.title,
          type: step.type as "AI" | "HYBRID" | "HUMAN",
          prompt: step.type === "AI" ? step.prompt : null,
          acceptanceCriteria: step.acceptanceCriteria,
          status: "PENDING",
        },
      });
    }

    // Update task prompt with a summary and set to READY
    await prisma.planTask.update({
      where: { id: taskId },
      data: {
        status: "READY",
        prompt: validSteps.map((s, i) => `${i + 1}. [${s.type}] ${s.title}`).join("\n"),
      },
    });

    // Cost tracking
    const usage = response.usage;
    const cachedTokens = (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
    const cost = calculateClaudeCost("sonnet-4-6", usage.input_tokens, usage.output_tokens, cachedTokens);

    await logApiUsage({
      provider: "anthropic",
      endpoint: "task-decompose",
      cost,
      clientId,
    });

    console.log(`[task-decomposer] ✓ Task "${task.title}" → ${validSteps.length} steps, $${cost.toFixed(4)}`);

    // Check if all tasks in plan are out of PLANNING → plan ACTIVE
    const plan = await prisma.monthlyPlan.findUniqueOrThrow({
      where: { id: task.planId },
      include: { tasks: { select: { status: true } } },
    });

    const allReady = plan.tasks.every((t) => t.status !== "PLANNING");
    if (allReady && plan.status === "PLANNING") {
      await prisma.monthlyPlan.update({
        where: { id: plan.id },
        data: { status: "ACTIVE" },
      });
      console.log(`[task-decomposer] Plan ${plan.id} → ACTIVE`);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[task-decomposer] ✗ Task "${task.title}" failed:`, errMsg);

    await prisma.planTask.update({
      where: { id: taskId },
      data: { status: "FAILED", failureReason: errMsg },
    });
  }
}
