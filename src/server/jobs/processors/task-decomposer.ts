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
  complexity: z.enum(["low", "medium", "high"]).optional().default("medium"),
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

const SYSTEM_PROMPT = `Eres un planificador de tareas SEO. Tu trabajo: descomponer una tarea en pasos concretos y accionables para el equipo de Click Society.

REGLAS GENERALES:
1. Cada paso AI debe tener un prompt AUTOSUFICIENTE que incluya qué archivos tocar, qué cambiar exactamente y criterios de aceptación verificables.
2. Cada paso HUMAN debe tener un "prompt" con instrucciones claras y completas: texto numerado, paso a paso, listo para que el equipo lo ejecute sin tener que adivinar nada.
3. Tareas mode=AI: solo pasos type=AI.
4. Tareas mode=HYBRID: pasos AI y HUMAN intercalados. Los pasos AI van primero (código), luego los HUMAN (revisión/validación).
5. Tareas mode=HUMAN o kind=SETUP: solo pasos type=HUMAN.
6. Entre 1 y 5 pasos por tarea. Un paso = una acción atómica.
7. Los prompts de pasos AI deben mencionar el CLAUDE.md y DESIGN.md del repo si existen.

HERRAMIENTAS DISPONIBLES EN CEREBRO SEO (solo estas — no inventes otras):
- PageSpeed Insights: https://pagespeed.web.dev/ — auditoría de velocidad y Core Web Vitals (web, gratuito)
- Google Search Console: datos de clicks, impresiones, posiciones, páginas top, queries top
- Google Analytics 4: sesiones, usuarios, tasa de rebote, conversiones
- DataForSEO: rankings SERP, backlinks, auditoría técnica de sitio, keywords
- Elementor: editor visual para sitios WordPress
- Yoast SEO / Rank Math: meta tags, schema, sitemap en WordPress
PROHIBIDO sugerir: Lighthouse CLI, Screaming Frog, Ahrefs, Semrush, WebPageTest, moz.com. Estas herramientas NO están disponibles en la agencia.

─── PARA SITIOS PLATFORM=NEXTJS ────────────────────────────────────────────────

TERMINAL DE CEREBRO SEO (solo plataforma Next.js):
La terminal puede: leer/editar/crear archivos, npm run build, npm run lint, git status/diff/log, npx sharp (convertir imágenes), npx svgo (optimizar SVGs), cat, ls, find, head, tail.
La terminal NO puede: instalar paquetes globales, correr Docker, acceder a URLs externas, abrir un navegador.
Para pasos HUMAN en Next.js que implican editar un archivo: incluye en el campo "prompt" el comando copy-paste listo para usar. Ejemplo: "Abre la terminal de Cerebro SEO y ejecuta: cat src/app/page.tsx | head -30" o "Edita docs/audits/log.md — reemplaza [SCORE] con el valor real".

─── PARA SITIOS PLATFORM=WORDPRESS ─────────────────────────────────────────────

IMPORTANTE: Los sitios WordPress NO tienen terminal en Cerebro SEO. NUNCA uses "usa la terminal" ni comandos de shell en pasos de sitios WordPress.

El equipo puede hacer cambios en WordPress vía:
- WordPress Admin (Dashboard): editar páginas, posts, menús, configuraciones
- Elementor: editar layouts, textos, imágenes, botones de cualquier página
- Yoast SEO / Rank Math: editar meta title, meta description, schema, robots
- WP Admin > Personalizar > CSS Adicional: agregar estilos personalizados
- Hosting file manager o FTP: modificar archivos PHP/CSS (para cambios de código)

Cerebro WP Plugin instalado en el sitio (endpoints en https://{dominio}/wp-json/cerebro/v1/):
- GET /capabilities — qué páginas y templates están disponibles
- GET /pages — árbol de páginas del sitio
- GET /elementor/{id} — árbol simplificado (textos, imágenes, links, headings) de una página Elementor
- GET /templates — global widgets y template insertions

Para pasos HUMAN en WordPress:
- Especifica la ruta exacta en WP Admin (ej: "Ve a Dashboard > Páginas > [nombre página] > Editar con Elementor")
- Para meta tags: "Ve a Dashboard > [post/página] > Yoast SEO (panel inferior) > Editar meta title y meta description"
- Para optimización de imágenes: "Descarga la imagen → comprime en https://squoosh.app o https://tinypng.com → sube en WordPress > Media"
- Para auditoría de velocidad: "Ve a https://pagespeed.web.dev/ y analiza la URL del cliente en modo Móvil"
- Los pasos HUMAN deben ser tan específicos que el equipo pueda ejecutarlos sin preguntar qué hacer

ANTI-CANIBALIZACIÓN:
- Revisa el site-map del contexto antes de crear una página nueva. Si ya existe una ruta que cubra el mismo tema o keyword, el paso debe OPTIMIZAR la página existente en vez de crear una nueva.
- Si se necesita una página nueva, su ruta debe seguir la estructura del sitio (ej: /blog/..., /servicios/...) y el prompt debe indicar explícitamente que revisó las rutas existentes.

SERVICIOS VERIFICADOS:
- Si la tarea pide crear una landing o página de servicio, verifica en site-spec y catalog-schemas que el servicio/producto exista. Si no aparece, el paso debe ser HUMAN con la instrucción "Confirmar con el cliente si ofrece [servicio] antes de crear la página."
- Artículos de blog técnicos del sector no requieren esta verificación (no afirman que el cliente ofrezca el servicio).

REGLA ANTI-INVENCIÓN (CRÍTICA):
- PROHIBIDO inventar datos del cliente: casos de éxito, nombres de clientes, certificaciones, precios, capacidades técnicas, procesos internos, testimonios, estadísticas, modelos de equipos o cualquier dato factual específico de la empresa.
- Si un paso AI necesita datos reales del cliente (fotos, precios, especificaciones, certificaciones, casos), el paso debe ser HUMAN, no AI.
- Los pasos AI solo pueden generar estructura, contenido genérico del sector, y elementos técnicos (schema, meta tags, componentes).
- Usa LITERALMENTE el título y objetivo de la tarea y la documentación del sitio (site-spec, catalog-schemas). No reinterpretes siglas ni términos técnicos del cliente — pueden tener significados específicos de su industria.

COMPLEJIDAD DE CADA PASO:
- Asigna "complexity" a cada paso AI: "low" (editar 1-2 archivos existentes, ej: meta tags), "medium" (crear 1 archivo o modificar 3-5, ej: artículo blog), "high" (crear múltiples archivos + componentes, ej: landing con page.tsx + componente + MDX).
- Si un paso sería "high" y tiene más de un entregable independiente (ej: crear MDX + crear componente React), DIVÍDELO en dos pasos "medium" separados.
- Nunca dejes un solo paso que cree más de 2 archivos nuevos — eso excede los turnos del agente.

RESPONDE ÚNICAMENTE con un JSON array:
[
  {
    "title": "Título corto del paso (max 120 chars)",
    "type": "AI|HUMAN",
    "complexity": "low|medium|high",
    "prompt": "Para AI: prompt autosuficiente. Para HUMAN: instrucciones detalladas paso a paso (NO null — siempre completo).",
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

  // Include sourceRef snapshot as additional context for module-sourced tasks
  const sourceRef = task.sourceRef as { module?: string; snapshot?: Record<string, unknown> } | null;
  const sourceContext = sourceRef?.snapshot
    ? `\nDATOS DE ORIGEN (módulo ${sourceRef.module}):\n${JSON.stringify(sourceRef.snapshot, null, 2).slice(0, 1500)}\n\nGenera una JUSTIFICACIÓN (qué dato respalda esta tarea) y un IMPACTO ESPERADO (qué mejora se espera) basados en estos datos. Inclúyelos en el título o en los criterios de aceptación del primer paso.`
    : "";

  const platform = task.site?.platform ?? "OTRO";
  const siteUrl = task.site?.url ?? "";

  const userPrompt = `Descompón esta tarea en pasos:

TAREA: ${task.title}
OBJETIVO: ${task.objective}
KIND: ${task.kind}
MODE: ${task.mode}
PRIORIDAD: ${task.priority}
ESFUERZO: ${task.effort}
PLATFORM: ${platform}
SITE_URL: ${siteUrl}
${sourceContext}
CONTEXTO DEL SITIO:
${repoContext}

Genera los pasos como JSON array. Recuerda aplicar las reglas de la sección correcta según PLATFORM=${platform}.`;

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8000, // prompts AI para tareas CONTENT pueden ser largos
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

    // Create PlanSteps (complexity stored in notes as metadata for the worker)
    for (let i = 0; i < validSteps.length; i++) {
      const step = validSteps[i];
      await prisma.planStep.create({
        data: {
          taskId,
          order: i + 1,
          title: step.title,
          type: step.type as "AI" | "HYBRID" | "HUMAN",
          prompt: step.prompt ?? null, // both AI and HUMAN steps have prompts now
          acceptanceCriteria: step.acceptanceCriteria,
          status: "PENDING",
          notes: step.type === "AI" ? `complexity:${step.complexity ?? "medium"}` : null,
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
