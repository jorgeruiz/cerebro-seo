/**
 * Script S2d: crea tareas + corre decomposición directamente (sin BullMQ).
 * Imprime los pasos generados completos al final.
 *
 * Uso:
 *   DATABASE_URL="..." ANTHROPIC_API_KEY="..." GITHUB_PAT_CLIENT_REPOS="..." \
 *     npx tsx scripts/s2d-execute.ts
 */

import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

// Inline decomposer to avoid importing worker-only modules
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const stepSchema = z.object({
  title: z.string().min(5).max(120),
  type: z.enum(["AI", "HUMAN"]),
  prompt: z.string().nullable().optional(),
  acceptanceCriteria: z.array(z.string()),
});

async function fetchRepoFile(githubRepo: string, path: string): Promise<string | null> {
  const pat = process.env.GITHUB_PAT_CLIENT_REPOS;
  const headers: Record<string, string> = { Accept: "application/vnd.github.raw" };
  if (pat) headers.Authorization = `Bearer ${pat}`;
  try {
    const res = await fetch(`https://api.github.com/repos/${githubRepo}/contents/${path}`, {
      headers, signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return res.text();
  } catch { return null; }
}

async function gatherRepoContext(githubRepo: string): Promise<string> {
  const files = [
    { path: "docs/site-spec.md", label: "Site Spec" },
    { path: "docs/site-map.md", label: "Site Map" },
    { path: "docs/catalog-schemas.md", label: "Catalog Schemas" },
    { path: "DESIGN.md", label: "Design Guide" },
    { path: "CLAUDE.md", label: "CLAUDE.md" },
  ];
  const sections: string[] = [];
  for (const { path, label } of files) {
    const content = await fetchRepoFile(githubRepo, path);
    if (content && content.trim().length > 50) {
      sections.push(`## ${label} (${path})\n${content.slice(0, 2000)}`);
    }
  }
  return sections.length > 0 ? sections.join("\n\n") : "No hay documentación del sitio disponible.";
}

const SYSTEM_PROMPT = `Eres un planificador de tareas SEO para sitios Next.js. Tu trabajo: descomponer una tarea en pasos concretos y accionables.

REGLAS:
1. Cada paso AI debe tener un prompt AUTOSUFICIENTE que incluya qué archivos tocar, qué cambiar exactamente y criterios de aceptación verificables.
2. Cada paso HUMAN debe tener instrucciones claras de qué hacer y cómo saber que está hecho.
3. Tareas mode=AI: solo pasos type=AI.
4. Tareas mode=HYBRID: pasos AI y HUMAN intercalados. Los pasos AI van primero (código), luego los HUMAN (revisión/validación).
5. Tareas mode=HUMAN o kind=SETUP: solo pasos type=HUMAN.
6. Entre 1 y 5 pasos por tarea. Un paso = una acción atómica.
7. Los prompts de pasos AI deben mencionar el CLAUDE.md y DESIGN.md del repo si existen.

REGLA ANTI-INVENCIÓN (CRÍTICA):
- PROHIBIDO inventar datos del cliente: casos de éxito, nombres de clientes, certificaciones, precios, capacidades técnicas, procesos internos, testimonios, estadísticas, modelos de equipos o cualquier dato factual específico de la empresa.
- Si un paso AI necesita datos reales del cliente (fotos, precios, especificaciones, certificaciones, casos), el paso debe ser HUMAN, no AI.
- Los pasos AI solo pueden generar estructura, contenido genérico del sector, y elementos técnicos (schema, meta tags, componentes).
- Usa LITERALMENTE el título y objetivo de la tarea y la documentación del sitio (site-spec, catalog-schemas). No reinterpretes siglas ni términos técnicos del cliente — pueden tener significados específicos de su industria.

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

async function decomposeAndSave(taskId: string, clientId: string): Promise<void> {
  const task = await prisma.planTask.findUniqueOrThrow({
    where: { id: taskId },
    include: { site: true },
  });

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

  console.log(`  Llamando a Claude para "${task.title}"...`);
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const rawText = response.content[0]?.type === "text" ? response.content[0].text : "[]";
  const jsonStr = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  const parsedSteps = JSON.parse(jsonStr) as unknown[];
  const validSteps: z.infer<typeof stepSchema>[] = [];
  for (const raw of parsedSteps) {
    const result = stepSchema.safeParse(raw);
    if (result.success) validSteps.push(result.data);
    else console.warn("  Step inválido:", JSON.stringify(raw).slice(0, 200));
  }

  if (validSteps.length === 0) throw new Error("0 pasos válidos");

  // Delete existing steps (retry case)
  await prisma.planStep.deleteMany({ where: { taskId } });

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

  await prisma.planTask.update({
    where: { id: taskId },
    data: {
      status: "READY",
      prompt: validSteps.map((s, i) => `${i + 1}. [${s.type}] ${s.title}`).join("\n"),
    },
  });

  const usage = response.usage;
  const cost = ((usage.input_tokens * 3 + usage.output_tokens * 15) / 1_000_000).toFixed(4);
  console.log(`  ✅ ${validSteps.length} pasos | ${usage.input_tokens}in/${usage.output_tokens}out | $${cost}\n`);
}

async function main() {
  // ── 1. Find Quicsa ────────────────────────────────────────────────────
  const client = await prisma.client.findFirst({
    where: { name: { contains: "Quicsa", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!client) { console.error("❌ Quicsa not found"); process.exit(1); }
  console.log(`Cliente: ${client.name}\n`);

  const plan = await prisma.monthlyPlan.findFirst({
    where: { clientId: client.id },
    orderBy: { month: "desc" },
    include: { tasks: { orderBy: { order: "asc" } } },
  });
  if (!plan) { console.error("❌ No plan"); process.exit(1); }

  const site = await prisma.site.findFirst({
    where: { client: { id: client.id } },
    select: { id: true, githubRepo: true },
  });
  if (!site) { console.error("❌ No site"); process.exit(1); }

  const taskIds: string[] = [];

  // ── 2. Retry AEO if stuck ────────────────────────────────────────────
  const aeoTask = plan.tasks.find(
    (t) => t.status === "PLANNING" && t.title.toLowerCase().includes("aeo")
  );
  if (aeoTask) {
    console.log(`🔄 AEO encontrada en PLANNING: "${aeoTask.title}" → descomponiendo...\n`);
    taskIds.push(aeoTask.id);
  } else {
    // Check if exists in another status
    const aeo = plan.tasks.find((t) => t.title.toLowerCase().includes("aeo"));
    if (aeo) console.log(`ℹ AEO en status ${aeo.status}: "${aeo.title}"\n`);
    else console.log("ℹ No AEO task found\n");
  }

  // ── 3. Create AI candidate (PAC) ─────────────────────────────────────
  const maxOrder = Math.max(...plan.tasks.map((t) => t.order), 0);

  const aiTitle = "Artículo pilar: Policloruro de aluminio (PAC) para tratamiento de agua";
  if (!plan.tasks.find((t) => t.title === aiTitle)) {
    const task = await prisma.planTask.create({
      data: {
        planId: plan.id,
        siteId: site.id,
        order: maxOrder + 1,
        title: aiTitle,
        objective: "Crear un artículo pilar de 2,000-3,000 palabras sobre policloruro de aluminio (PAC) y su uso en tratamiento de agua industrial. El artículo debe posicionar para 'policloruro de aluminio', 'PAC tratamiento de agua', 'coagulante PAC agua industrial' y variantes long-tail. Estructura: qué es el PAC (composición química, presentaciones), para qué se usa (clarificación, potabilización, tratamiento de efluentes), ventajas vs sulfato de aluminio, dosificación general, sectores que lo utilizan. NO inventar datos específicos de Quicsa (clientes, precios, capacidades, certificaciones) — esos se agregan en un paso HUMAN posterior. El contenido técnico debe basarse en información pública del sector químico. Tono técnico pero accesible para responsables de plantas de tratamiento.",
        prompt: "",
        acceptanceCriteria: [
          "Artículo publicado en /blog/policloruro-de-aluminio-pac con meta title < 60 chars y meta description < 155 chars",
          "Contiene al menos 2,000 palabras de contenido técnicamente correcto sobre PAC",
          "Incluye schema Article con autor, fecha, y breadcrumbs",
          "Tiene al menos 3 enlaces internos a páginas de productos/servicios de Quicsa",
          "Incluye CTA de contacto/cotización al final",
          "NO contiene datos inventados sobre Quicsa (precios, clientes, capacidades, certificaciones)",
          "Build pasa sin errores",
        ],
        mode: "AI",
        kind: "CONTENT",
        priority: 3,
        effort: "HIGH",
        category: "blog",
        sourceCandidateId: `s2d-ai-pac-${randomUUID().slice(0, 8)}`,
        status: "PLANNING",
      },
    });
    console.log(`➕ AI task created: ${task.id}`);
    taskIds.push(task.id);
  } else {
    console.log(`⏭ AI task already exists`);
    const existing = plan.tasks.find((t) => t.title === aiTitle)!;
    if (existing.status === "PLANNING") taskIds.push(existing.id);
  }

  // ── 4. Create HYBRID candidate (Chillers) ────────────────────────────
  const hybridTitle = "Landing page: Mantenimiento preventivo y correctivo de chillers industriales";
  if (!plan.tasks.find((t) => t.title === hybridTitle)) {
    const task = await prisma.planTask.create({
      data: {
        planId: plan.id,
        siteId: site.id,
        order: maxOrder + 2,
        title: hybridTitle,
        objective: "Crear una landing page de servicio para mantenimiento de chillers industriales. Target keywords: 'mantenimiento chillers industriales', 'servicio chillers monterrey', 'reparación chillers'. La página debe comunicar expertise técnico de Quicsa en sistemas de enfriamiento industrial, incluir tipos de chillers que atienden, proceso de diagnóstico, beneficios del mantenimiento preventivo, y formulario de contacto/cotización. HYBRID porque: la IA genera la estructura y contenido base, pero el equipo debe revisar datos técnicos específicos de Quicsa (modelos, capacidades, certificaciones) y agregar fotos reales.",
        prompt: "",
        acceptanceCriteria: [
          "Landing publicada en /servicios/mantenimiento-chillers con H1 que incluya keyword principal",
          "Meta title < 60 chars, meta description < 155 chars con CTA",
          "Incluye al menos 4 secciones: intro, tipos de chillers, proceso de servicio, beneficios/CTA",
          "Schema Service con areaServed y provider (sin priceRange — no hay dato en site-spec)",
          "Formulario de contacto funcional conectado al existente",
          "NO contiene datos inventados de Quicsa (precios, modelos específicos, certificaciones, casos)",
          "Build pasa sin errores",
          "[HUMAN] Verificar datos técnicos: modelos de chillers, capacidades en TR/BTU, certificaciones",
          "[HUMAN] Agregar fotos reales de trabajos de Quicsa en chillers",
        ],
        mode: "HYBRID",
        kind: "CONTENT",
        priority: 4,
        effort: "HIGH",
        category: "landing",
        sourceCandidateId: `s2d-hybrid-chillers-${randomUUID().slice(0, 8)}`,
        status: "PLANNING",
      },
    });
    console.log(`➕ HYBRID task created: ${task.id}`);
    taskIds.push(task.id);
  } else {
    console.log(`⏭ HYBRID task already exists`);
    const existing = plan.tasks.find((t) => t.title === hybridTitle)!;
    if (existing.status === "PLANNING") taskIds.push(existing.id);
  }

  // ── 5. Run decomposition for all tasks ────────────────────────────────
  console.log(`\n══ Descomponiendo ${taskIds.length} tarea(s) ══\n`);

  for (const taskId of taskIds) {
    try {
      await decomposeAndSave(taskId, client.id);
    } catch (err) {
      console.error(`  ❌ Error:`, err instanceof Error ? err.message : err);
    }
  }

  // ── 6. Print full results ────────────────────────────────────────────
  console.log("\n════════════════════════════════════════════════════════════");
  console.log("  PASOS GENERADOS — COMPLETOS Y SIN RESUMIR");
  console.log("════════════════════════════════════════════════════════════\n");

  for (const taskId of taskIds) {
    const task = await prisma.planTask.findUnique({
      where: { id: taskId },
      include: { steps: { orderBy: { order: "asc" } } },
    });
    if (!task) continue;

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`TAREA: ${task.title}`);
    console.log(`Mode: ${task.mode} | Kind: ${task.kind} | Status: ${task.status}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    for (const step of task.steps) {
      console.log(`── Paso ${step.order}: ${step.title}`);
      console.log(`   Tipo: ${step.type}`);
      if (step.prompt) {
        console.log(`   Prompt:`);
        console.log(step.prompt.split("\n").map((l) => `     ${l}`).join("\n"));
      }
      console.log(`   Criterios de aceptación:`);
      for (const c of step.acceptanceCriteria) {
        console.log(`     - ${c}`);
      }
      console.log("");
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
