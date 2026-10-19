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
import { getWpCapabilities } from "@/lib/wp-proxy-client";

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
3. Tareas mode=AI: solo pasos type=AI, EXCEPTO blogs WordPress (ver regla 3b).
3b. BLOGS WORDPRESS: todo blog creado con action=publish DEBE terminar con un paso HUMAN final "Revisar y publicar borrador en WordPress". El prompt de ese paso HUMAN debe incluir: (a) link de vista previa del borrador, (b) link de edición en WP Admin, (c) checklist: verificar que no hay placeholders [COMPLETAR, revisar formato/imágenes, hacer clic en "Publicar" en WP. Los blogs NUNCA se publican automáticamente.
4. Tareas mode=HYBRID: pasos AI y HUMAN intercalados. Los pasos AI van primero (código), luego los HUMAN (revisión/validación).
5. Tareas mode=HUMAN o kind=SETUP: solo pasos type=HUMAN.
6. Entre 1 y 6 pasos por tarea. Un paso = una acción atómica. (6 para blogs con imagen + review).
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

Cerebro WP Plugin instalado en el sitio (base: https://{dominio}/wp-json/clicksociety/v1/, auth: X-Cerebro-Key):

  LECTURA:
  - GET /capabilities — endpoints activos en este sitio
  - GET /pages — árbol de páginas
  - GET /elementor/{id} — árbol simplificado de una página Elementor (textos, imágenes, links, headings con sección/widget/texto actual)
  - GET /templates — global widgets y template insertions

  ESCRITURA (v1.5.0 — disponibles para pasos AI):
  - POST /publish — crear artículo de blog (siempre borrador para revisión)
  - PUT /update/{id} — editar texto/contenido de un post existente (NO páginas Elementor)
  - POST /media — subir imagen con alt text descriptivo
  - POST /seo/{id} — actualizar meta title, meta description, focus keyword via Yoast SEO

Pasos type=AI en WordPress: el campo "prompt" DEBE ser un JSON (no texto libre) con este schema exacto:
{
  "action": "publish" | "seo" | "update" | "media" | "image",
  "endpoint": "POST /publish" | "POST /seo/{page_id}" | "PUT /update/{post_id}" | "POST /media",
  "payload": {
    // Para publish: "title" (string), "slug" (string, opcional), "focus_keyword" (string, opcional), "categories" (string[], opcional)
    // Para seo: "page_id" (number, usa 0 si no conoces el ID), "meta_title" (string, 50-60 chars), "meta_description" (string, 140-160 chars), "focus_keyword" (string)
    // Para update: "post_id" (number), "title" (string, opcional)
    // Para image: "usage" ("featured_image" | "inline"), "attach_to_post_id" (number | null), "aspect_ratio" ("16:9" | "1:1" | "4:3"), "style" ("professional-photo" | "illustration" | "conceptual" | "infographic"), "subject_type" ("conceptual" | "illustration")
  },
  "content_brief": "Para action=publish: brief DETALLADO de 200-400 palabras con: estructura del artículo, secciones principales, keyword objetivo, tono del cliente, CTAs, qué NO inventar. El motor generará el HTML completo a partir de este brief. Para action=image: descripción de la imagen a generar (tema, composición, paleta, qué NO incluir)."
}
El campo "acceptanceCriteria" del paso sigue siendo un array de strings normal.
IMPORTANTE: el campo "prompt" del paso AI debe ser SOLO el JSON — nada de texto antes ni después.

Para pasos HUMAN en WordPress (cuando la tarea no puede ejecutarse via plugin):
- Especifica la ruta exacta en WP Admin (ej: "Ve a Dashboard > Páginas > [nombre página] > Editar con Elementor")
- Para Elementor: lee primero GET /elementor/{id} para localizar el widget exacto (sección > columna > widget), luego incluye el texto actual y el texto final listo para pegar
- Para meta tags HUMAN: "Ve a Dashboard > [post/página] > Yoast SEO (panel inferior) > editar meta title y meta description"
- Para imágenes: "Descarga la imagen → comprime en https://squoosh.app o https://tinypng.com → sube en WordPress > Media"
- Para velocidad: "Ve a https://pagespeed.web.dev/ y analiza la URL en modo Móvil"
- Los pasos HUMAN deben ser tan específicos que el equipo pueda ejecutarlos sin preguntar qué hacer

ANTI-CANIBALIZACIÓN:
- Revisa el site-map del contexto antes de crear una página nueva. Si ya existe una ruta que cubra el mismo tema o keyword, el paso debe OPTIMIZAR la página existente en vez de crear una nueva.
- Si se necesita una página nueva, su ruta debe seguir la estructura del sitio (ej: /blog/..., /servicios/...) y el prompt debe indicar explícitamente que revisó las rutas existentes.

SERVICIOS VERIFICADOS:
- Si la tarea pide crear una landing o página de servicio, verifica en site-spec y catalog-schemas que el servicio/producto exista. Si no aparece, el paso debe ser HUMAN con la instrucción "Confirmar con el cliente si ofrece [servicio] antes de crear la página."
- Artículos de blog técnicos del sector no requieren esta verificación (no afirman que el cliente ofrezca el servicio).

IMÁGENES GENERADAS POR IA:
- Cerebro SEO puede generar imágenes con IA (Higgsfield) para artículos de blog: portada (featured_image) e imágenes inline.
- SOLO para artículos de blog. En landings, páginas de servicio, o cualquier otra página → el paso de imagen SIEMPRE es HUMAN con instrucción "Solicitar/tomar foto real para [descripción]."
- subject_type SOLO puede ser "conceptual" o "illustration". Si la imagen necesita mostrar personas reales, instalaciones, productos o trabajos del cliente → paso HUMAN, nunca AI.
- Máximo 2 pasos de imagen por tarea (1 portada + 1 inline máximo).
- El content_brief de action=image debe describir: tema visual, composición deseada, paleta de colores (si hay colores de marca conocidos, incluirlos), y qué NO debe aparecer (logos, texto, personas).
- aspect_ratio: 16:9 para portadas, 4:3 para inline, 1:1 para thumbnails.
- Si el artículo de blog tiene un paso publish, el paso image va DESPUÉS del publish (para que attach_to_post_id pueda referenciar el post creado).
- Para Next.js: el paso image escribe el archivo en public/images/blog/ y actualiza el frontmatter del MDX automáticamente.

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
    include: { site: { include: { client: { select: { cerebroClientId: true } } } } },
  });

  // Gather repo context (Next.js only)
  let repoContext = "No hay repositorio configurado.";
  if (task.site?.githubRepo) {
    repoContext = await gatherRepoContext(task.site.githubRepo);
  }

  // Gather WP capabilities via Cerebro web proxy (WordPress only)
  let wpCapabilitiesContext = "";
  const platform = task.site?.platform ?? "OTRO";
  if ((platform === "WORDPRESS" || platform === "MIGRACION") && task.site?.client?.cerebroClientId) {
    const capsResult = await getWpCapabilities(task.site.client.cerebroClientId, taskId);
    if (capsResult.ok && (capsResult.data.endpoints ?? []).length > 0) {
      const src = capsResult.fromCache ? "caché 24h" : "en vivo";
      wpCapabilitiesContext = `\nWP CAPABILITIES (${src} via GET /capabilities):\nEndpoints activos: ${capsResult.data.endpoints.join(", ")}\nNota: solo generar pasos type=AI para endpoints que aparezcan en esta lista.\n`;
    } else {
      const reason = capsResult.ok ? "lista vacía" : capsResult.error;
      wpCapabilitiesContext = `\nWP CAPABILITIES: catálogo estático v1.5.0 (proxy no disponible: ${reason}).\n`;
    }
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Include sourceRef snapshot as additional context for module-sourced tasks
  const sourceRef = task.sourceRef as { module?: string; snapshot?: Record<string, unknown> } | null;
  const sourceContext = sourceRef?.snapshot
    ? `\nDATOS DE ORIGEN (módulo ${sourceRef.module}):\n${JSON.stringify(sourceRef.snapshot, null, 2).slice(0, 1500)}\n\nGenera una JUSTIFICACIÓN (qué dato respalda esta tarea) y un IMPACTO ESPERADO (qué mejora se espera) basados en estos datos. Inclúyelos en el título o en los criterios de aceptación del primer paso.`
    : "";

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
${wpCapabilitiesContext}${sourceContext}
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
