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
import { getWpSiteProfile } from "@/lib/wp-site-profile";

// ─── Types ───────────────────────────────────────────────────────────────────

const stepSchema = z.object({
  title: z.string().min(2).max(200).transform((s) => s.slice(0, 120)),
  type: z.enum(["AI", "HUMAN", "HYBRID"]).transform((t) => t === "HYBRID" ? "HUMAN" : t),
  prompt: z.preprocess(
    (v) => (v !== null && v !== undefined && typeof v === "object" ? JSON.stringify(v) : v),
    z.string().nullable().optional()
  ),
  acceptanceCriteria: z.array(z.string()).default([]),
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

// ─── Anti-cannibalization helper ──────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .trim();
}

/**
 * Detecta si ya existe una página con el mismo tema o keyword.
 * Usa normalización de texto para comparar slugs y títulos.
 * Retorna la página candidata si hay match, o null si es contenido nuevo.
 */
function detectCannibalization(
  pages: Array<{ title: string; slug: string }>,
  taskTitle: string,
  keyword?: string | null,
): { page: { title: string; slug: string }; reason: string } | null {
  const stopWords = new Set([
    "para", "como", "que", "una", "los", "las", "del", "con", "por",
    "crear", "nueva", "pagina", "landing", "blog", "articulo",
  ]);
  const titleNorm = normalize(taskTitle);
  const titleWords = titleNorm.split(/\s+/).filter((w) => w.length > 3 && !stopWords.has(w));

  const keyNorm = keyword ? normalize(keyword) : null;
  const keyWords = keyNorm
    ? keyNorm.split(/\s+/).filter((w) => w.length > 3 && !stopWords.has(w))
    : [];

  for (const page of pages) {
    if (!page.slug) continue; // skip root
    const slugNorm = normalize(page.slug);
    const pageTitleNorm = normalize(page.title);

    // Keyword match in slug
    if (keyWords.length >= 2) {
      const kwMatches = keyWords.filter((w) => slugNorm.includes(w) || pageTitleNorm.includes(w));
      if (kwMatches.length >= 2) {
        return { page, reason: `keyword "${keyword}" coincide con /${page.slug} ("${page.title}")` };
      }
    }

    // Title word overlap ≥ 2 significative words
    const titleMatches = titleWords.filter(
      (w) => slugNorm.includes(w) || pageTitleNorm.includes(w),
    );
    if (titleMatches.length >= 2) {
      return {
        page,
        reason: `"${taskTitle}" comparte ${titleMatches.length} palabras con /${page.slug} ("${page.title}")`,
      };
    }
  }
  return null;
}

// ─── Decomposition ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres un planificador de tareas SEO. Tu trabajo: descomponer una tarea en pasos concretos y accionables para el equipo de Click Society.

REGLAS GENERALES:
1. Cada paso AI debe tener un prompt AUTOSUFICIENTE (JSON) con qué ejecutar exactamente.
2. Cada paso HUMAN debe tener un "prompt" con instrucciones claras y completas: texto numerado, paso a paso, listo para ejecutar sin adivinar.
3. Tareas mode=AI: solo pasos type=AI.
4. Tareas mode=HYBRID: pasos AI primero, luego HUMAN (revisión/validación). En WordPress, blogs y landings son siempre HYBRID: AI crea el borrador/paquete, HUMAN revisa y publica.
5. Tareas mode=HUMAN o kind=SETUP: solo pasos type=HUMAN.
6. Entre 1 y 5 pasos por tarea. Máximo 5. Un paso = una acción atómica.
7. Los prompts de pasos AI deben mencionar CLAUDE.md y DESIGN.md si existen en el repo.

HERRAMIENTAS DISPONIBLES EN CEREBRO SEO (solo estas):
- PageSpeed Insights: https://pagespeed.web.dev/ — velocidad y Core Web Vitals (web, gratis)
- Google Search Console: clicks, impresiones, posiciones, páginas top, queries top
- Google Analytics 4: sesiones, usuarios, rebote, conversiones
- DataForSEO: rankings, backlinks, auditoría técnica, keywords
- Elementor: editor visual para WordPress
- Yoast SEO / Rank Math: meta tags, schema, sitemap
PROHIBIDO sugerir: Lighthouse CLI, Screaming Frog, Ahrefs, Semrush, WebPageTest.

REGLA ANTI-INVENCIÓN (CRÍTICA):
- PROHIBIDO inventar: casos de éxito, certificaciones, precios, capacidades, testimonios, estadísticas del cliente.
- Si un paso AI necesita datos reales del cliente → paso HUMAN en su lugar.
- Usa LITERALMENTE el título y objetivo de la tarea. No reinterpretes términos técnicos.

─── PARA SITIOS PLATFORM=NEXTJS ────────────────────────────────────────────────

TERMINAL (solo Next.js): puede leer/editar/crear archivos, npm run build/lint, git, npx sharp/svgo.
No puede: instalar paquetes globales, correr Docker, URLs externas, abrir un navegador.

IMÁGENES AI (Next.js y WordPress-blog):
- subject_type: "conceptual" o "illustration". Personas reales / instalaciones / productos del cliente → HUMAN.
- aspect_ratio: 16:9 portadas, 4:3 inline, 1:1 thumbnails.

COMPLEJIDAD (Next.js):
- "low" (1-2 archivos existentes), "medium" (crear 1 archivo), "high" (múltiples archivos nuevos).
- "high" con > 2 entregables → dividir en pasos "medium".

─── PARA SITIOS PLATFORM=WORDPRESS ─────────────────────────────────────────────

REGLAS ABSOLUTAS WORDPRESS (incumplirlas invalida el paso):
A. NUNCA generes pasos que pidan al equipo usar API keys, credentials, comandos de terminal,
   scripts PHP, FTP, o acceso a la base de datos. El equipo solo puede usar:
   WordPress Admin, Elementor (editor visual), Yoast SEO (panel inferior del editor).
B. La canibalización ya fue verificada automáticamente. Si el contexto incluye
   "PÁGINA EXISTENTE:", la tarea DEBE optimizar esa página — NUNCA crear una nueva.
C. Si un paso AI requiere un endpoint que NO aparece en WP CAPABILITIES → conviértelo
   en HUMAN con instrucciones manuales equivalentes. Nunca lo dejes inválido.

PASO OBLIGATORIO "content_package":
Toda tarea CONTENT en WordPress DEBE comenzar con este paso AI como paso 1:
{
  "action": "content_package",
  "kind": "blog" | "landing" | "optimization",
  "keyword": "<keyword principal de la tarea>",
  "page_title": "<título SEO de la página o artículo>",
  "target_page_id": 0
}
Este paso genera el paquete completo (H1, H2/H3, textos, tablas, FAQ, CTA, metas, schema, enlaces internos, brief de imagen).
NO requiere plugin WP. Siempre es type=AI, complexity=high.

PLANTILLAS OBLIGATORIAS POR TIPO:

BLOG (kind=CONTENT con artículo/post/redactar):
1. [AI] Paquete de contenido → action: content_package, kind: "blog"
2. [AI] Crear borrador en WordPress → action: "publish"
3. [AI] Imagen de portada → action: "image" (SOLO si tema es conceptual/ilustración — si necesita fotos reales del cliente, omitir y agregar instrucción en paso 4)
4. [HUMAN] Revisar y publicar borrador
   prompt: "Ve a WordPress Admin > Entradas > Borradores. El artículo '[título]' fue creado como borrador (URL de vista previa disponible en el paso anterior).
   Checklist antes de publicar:
   1. Verifica que no haya [COMPLETAR] sin reemplazar
   2. Revisa el formato, imágenes y que los H2/H3 sean correctos
   3. En Yoast SEO (panel inferior), confirma el meta title y meta description
   4. Si hay imagen de portada, verifica que esté asignada en 'Imagen destacada'
   5. Haz clic en 'Publicar' cuando todo esté revisado"

LANDING (kind=CONTENT con nueva página de servicio/producto/categoría):
1. [AI] Paquete de contenido → action: content_package, kind: "landing"
2. [HUMAN] Crear landing en Elementor con el paquete
   prompt: "El Paso 1 generó el paquete completo de contenido (disponible en el detalle del paso).
   Ve a WordPress Admin > Páginas > Añadir nueva > Editar con Elementor.
   Usa el paquete del Paso 1 como estructura:
   1. Sección Hero: usa el H1 del paquete como encabezado principal
   2. Crea secciones siguiendo los H2/H3 del paquete
   3. Agrega tablas y listas del paquete en las secciones correspondientes
   4. Sección FAQ: agrega las preguntas y respuestas del paquete
   5. Sección CTA: [usa el texto CTA del paquete]
   6. En Yoast SEO (panel inferior): pega el meta title y meta description del paquete
   7. Solicita al cliente foto real para la sección hero (brief: [brief de imagen del paquete])
   8. Guarda como borrador"
3. [HUMAN] Revisar, agregar fotos reales y publicar
   prompt: "Revisión final antes de publicar:
   1. Confirma que todas las secciones del paquete estén implementadas
   2. Reemplaza cualquier [COMPLETAR] con información real del cliente
   3. Verifica que las imágenes sean de calidad y tengan alt text descriptivo
   4. En Yoast SEO: verifica el meta title y meta description
   5. Verifica que la URL/slug sea correcta (ej: /[keyword-principal])
   6. Haz clic en 'Publicar'"

OPTIMIZACIÓN (PÁGINA EXISTENTE detectada, o título dice 'optimizar'/'mejorar'):
1. [AI] Paquete de cambios antes→después → action: content_package, kind: "optimization"
2. [HUMAN] Aplicar cambios en Elementor
   prompt: "El Paso 1 generó los cambios específicos antes→después (disponible en el detalle del paso).
   Ve a Dashboard > Páginas > [nombre página] > Editar con Elementor.
   Para cada cambio del paquete:
   1. Localiza el widget exacto por sección y tipo
   2. Reemplaza el texto anterior con el texto nuevo indicado
   3. Verifica que el cambio se vea bien visualmente
   4. Guarda los cambios
   Nota: los meta tags se aplicarán automáticamente al publicar el plan."

OTROS PASOS AI VÁLIDOS (solo si endpoint aparece en WP CAPABILITIES):
{
  "action": "publish",
  "endpoint": "POST /publish",
  "payload": { "title": "...", "slug": "...", "focus_keyword": "...", "categories": [...] },
  "content_brief": "Brief de 200+ palabras con estructura, keyword, tono, CTAs, qué no inventar."
}
{
  "action": "seo",
  "endpoint": "POST /seo/{page_id}",
  "payload": { "page_id": 0, "meta_title": "50-60 chars", "meta_description": "140-160 chars", "focus_keyword": "..." }
}
{
  "action": "image",
  "endpoint": "",
  "payload": { "usage": "featured_image", "attach_to_post_id": null, "aspect_ratio": "16:9", "subject_type": "conceptual" },
  "content_brief": "Descripción visual: tema, composición, paleta, qué NO incluir (logos, texto, personas)."
}

DEGRADAR en lugar de fallar:
Si el endpoint requerido no está en WP CAPABILITIES → convierte el paso AI en HUMAN equivalente.
Nunca generes un paso con acción inválida. Prefiere HUMAN claro a AI roto.

RESPONDE ÚNICAMENTE con un JSON array:
[
  {
    "title": "Título corto del paso (max 120 chars)",
    "type": "AI|HUMAN",
    "complexity": "low|medium|high",
    "prompt": "Para AI: JSON estructurado exacto. Para HUMAN: instrucciones completas paso a paso.",
    "acceptanceCriteria": ["Criterio verificable 1", "Criterio 2"]
  }
]

Sin texto fuera del JSON. El primer elemento del array siempre es el primer paso (orden ascendente).`;

export async function decomposeTask(data: DecompositionJobData): Promise<void> {
  const { taskId, clientId } = data;

  const task = await prisma.planTask.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      site: { include: { client: { select: { cerebroClientId: true, name: true } } } },
    },
  });

  // Gather repo context (Next.js only)
  let repoContext = "No hay repositorio configurado.";
  if (task.site?.githubRepo) {
    repoContext = await gatherRepoContext(task.site.githubRepo);
  }

  const platform = task.site?.platform ?? "OTRO";
  const cerebroClientId = task.site?.client?.cerebroClientId ?? null;

  // ── WP: capabilities + site profile + anti-cannibalization ──────────────────
  let wpCapabilitiesContext = "";
  let wpCannibalContext = "";
  let wpPagesContext = "";

  if ((platform === "WORDPRESS" || platform === "MIGRACION") && cerebroClientId) {
    // Capabilities
    const capsResult = await getWpCapabilities(cerebroClientId, taskId);
    if (capsResult.ok && (capsResult.data.endpoints ?? []).length > 0) {
      const src = capsResult.fromCache ? "caché 24h" : "en vivo";
      wpCapabilitiesContext =
        `\nWP CAPABILITIES (${src}):\nEndpoints activos: ${capsResult.data.endpoints.join(", ")}\n` +
        `Recuerda: solo generar pasos type=AI para endpoints que aparezcan en esta lista.\n`;
    } else {
      const reason = capsResult.ok ? "ningún endpoint registrado" : capsResult.error;
      wpCapabilitiesContext = `\nWP CAPABILITIES: no disponibles (${reason}). Todos los pasos AI deben degradarse a HUMAN.\n`;
    }

    // Site profile (pages + content summary)
    const siteProfile = await getWpSiteProfile(
      cerebroClientId,
      task.site?.client?.name ?? "Cliente",
      task.site?.url ?? "",
      taskId,
    ).catch(() => null);

    if (siteProfile && siteProfile.pages.length > 0) {
      wpPagesContext = `\nPÁGINAS EXISTENTES EN EL SITIO (${siteProfile.pages.length} páginas):\n${siteProfile.pages
        .map((p) => `- /${p.slug || ""} — "${p.title}"`)
        .join("\n")}\n`;

      // Anti-cannibalization check
      const sourceRef = task.sourceRef as { keyword?: string } | null;
      const keyword = sourceRef?.keyword ?? null;
      const cannibal = detectCannibalization(siteProfile.pages, task.title, keyword);
      if (cannibal) {
        wpCannibalContext =
          `\n⚠ CANIBALIZACIÓN DETECTADA: Ya existe una página similar.\n` +
          `PÁGINA EXISTENTE: "${cannibal.page.title}" (/${cannibal.page.slug})\n` +
          `Razón: ${cannibal.reason}\n` +
          `INSTRUCCIÓN: Esta tarea DEBE optimizar la página existente, NO crear una nueva.\n` +
          `Usa kind="optimization" en el paso content_package.\n`;
      }
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
${wpCapabilitiesContext}${wpCannibalContext}${wpPagesContext}${sourceContext}
CONTEXTO DEL SITIO:
${repoContext}

Genera los pasos como JSON array. Aplica las reglas de la sección PLATFORM=${platform}.`;

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
      // Degrade instead of fail: create a single fallback HUMAN step
      console.warn(`[task-decomposer] Todos los pasos inválidos para "${task.title}" — creando paso HUMAN fallback`);
      validSteps.push({
        title: `Ejecutar manualmente: ${task.title.slice(0, 90)}`,
        type: "HUMAN" as const,
        prompt:
          `Ningún paso pudo generarse automáticamente para esta tarea.\n` +
          `Objetivo: ${task.objective}\n\n` +
          `Ejecuta esta tarea manualmente según el objetivo indicado.\n` +
          `Cuando esté completada, marca este paso como hecho.`,
        acceptanceCriteria: ["Tarea completada según el objetivo"],
        complexity: "medium" as const,
      });
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
