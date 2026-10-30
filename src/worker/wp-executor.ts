/**
 * Ejecutor WP — primitivas de ejecucion para tareas WordPress.
 *
 * executeWpAiStep: parsea la accion estructurada del step y delega al ejecutor correcto.
 * executeWpPublish: genera articulo con Claude y crea borrador en WP.
 * executeWpSeo: genera meta tags con Claude y los stagea SIEMPRE en stagedChange.
 *
 * --- stagedChange (PlanStep.stagedChange) ------------------------------------
 * Reemplaza el prefijo WP_SEO_STAGED: en notes. Campo Json estructurado.
 * Ver src/lib/wp-staged-change.ts para tipos.
 *
 * blog: { type:"blog", post_id, draft_url, has_placeholders, placeholder_samples, ... }
 * seo:  { type:"seo", page_id, meta_title, meta_description, objective, ... }
 *
 * La accion "Publicar Plan" (publishWpPlanAction) lee stagedChange y aplica:
 *   blog → PUT /update/{post_id} status=publish → link en resultUrls
 *   seo  → POST /seo/{page_id} → meta aplicados
 *
 * NUNCA llama a updateWpSeo ni a updateWpPost con status=publish directamente.
 */

import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "@/lib/anthropic-config";
import {
  publishWpPost,
  getWpPages,
  getWpElementorPage,
  duplicateWpElementorPage,
  updateWpElementorWidgets,
} from "@/lib/wp-proxy-client";
import type { WpWidgetUpdate } from "@/lib/wp-proxy-client";
import { logApiUsage } from "@/server/jobs/workers/base-worker";
import type { WpSiteProfile } from "@/lib/wp-site-profile";
import type {
  WpStagedChange,
  WpStagedBlogChange,
  WpStagedSeoChange,
  WpStagedElementorChange,
  WpStagedContentPackageChange,
} from "@/lib/wp-staged-change";
import { executeImage, type ImageStepAction } from "./image-executor";

// --- Tipos -------------------------------------------------------------------

export interface WpStepAction {
  action: "publish" | "seo" | "update" | "media" | "elementor" | "landing" | string;
  endpoint: string;
  payload: Record<string, unknown>;
  content_brief?: string;
}

export interface WpStepResult {
  notes: string;
  /** URL del borrador WP (accion publish) — se guarda en PlanTask.previewUrl */
  previewUrl?: string;
  /** Cambio estructurado para PlanStep.stagedChange */
  stagedChange?: WpStagedChange;
  /** URL de imagen generada (accion image) — se guarda en step resultUrls */
  imageUrl?: string;
}

// --- Entry point -------------------------------------------------------------

/**
 * Ejecuta un step AI de WordPress: parsea la accion estructurada del prompt
 * y llama al ejecutor correcto.
 */
export async function executeWpAiStep(
  cerebroClientId: string,
  siteProfile: WpSiteProfile | null,
  task: { title: string; objective: string; kind: string; category: string; targetKeyword?: string | null },
  step: { title: string; prompt: string | null; acceptanceCriteria: string[]; notes: string | null },
  taskId: string,
  imageCount = 0,
): Promise<WpStepResult> {
  let action: WpStepAction | null = null;
  if (step.prompt) {
    try {
      const cleaned = step.prompt.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
      action = JSON.parse(cleaned) as WpStepAction;
    } catch {
      // No es JSON estructurado — caer en heuristica
    }
  }

  if (!action?.action) {
    const isContent = task.kind === "CONTENT" || task.category === "blog";
    const isMeta = task.category === "meta" || task.category === "seo";
    if (isContent) {
      action = {
        action: "publish",
        endpoint: "POST /publish",
        payload: {},
        content_brief: step.prompt ?? task.objective,
      };
    } else if (isMeta) {
      action = {
        action: "seo",
        endpoint: "POST /seo/0",
        payload: { page_id: 0 },
        content_brief: step.prompt ?? task.objective,
      };
    } else {
      return {
        notes: `wp:staged — accion no reconocida para categoria "${task.category}". Prompt: ${(step.prompt ?? "").slice(0, 400)}`,
      };
    }
  }

  if (action.action === "content_package") return executeContentPackage(cerebroClientId, siteProfile, task, action, taskId);
  if (action.action === "publish") return executeWpPublish(cerebroClientId, siteProfile, task, action, taskId);
  if (action.action === "seo") return executeWpSeo(cerebroClientId, task, action, taskId);
  if (action.action === "elementor" || action.action === "landing") return executeWpElementor(cerebroClientId, task, action, taskId);

  if (action.action === "image") {
    // Fetch brand colors from Elementor Kit for image prompts
    let brandColors: string | null = null;
    try {
      const { getWpKit } = await import("@/lib/wp-proxy-client");
      const kitResult = await getWpKit(cerebroClientId, taskId);
      if (kitResult.ok && kitResult.data.system_colors.length > 0) {
        brandColors = kitResult.data.system_colors
          .map((c) => `${c.title}: ${c.color}`)
          .join(", ");
      }
    } catch { /* kit not available — continue without colors */ }

    const imgResult = await executeImage(action as unknown as ImageStepAction, {
      cerebroClientId,
      taskId,
      brandColors,
      imageCount,
      taskKind: task.kind,
      taskCategory: task.category,
    });
    return {
      notes: imgResult.notes,
      imageUrl: imgResult.imageUrl,
    };
  }

  return {
    notes: `wp:staged — accion "${action.action}" (${action.endpoint}) pendiente de implementar. Payload: ${JSON.stringify(action.payload).slice(0, 400)}`,
  };
}

// --- Content Package ---------------------------------------------------------

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Haiku model ID for cheap second-pass operations. */
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

function normStr(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Extrae hechos verificados del contentSummary del perfil.
 * El summary tiene formato "=== Título ===" + líneas.
 * Devuelve mapa: título de página → líneas de contenido.
 */
function parseVerifiedFacts(
  contentSummary: string,
  pages: Array<{ title: string; slug: string }>,
): Array<{ slug: string; title: string; lines: string[] }> {
  const result: Array<{ slug: string; title: string; lines: string[] }> = [];
  const sections = contentSummary.split(/^=== .+ ===/m).filter(Boolean);
  const headers = Array.from(contentSummary.matchAll(/^=== (.+) ===$/gm)).map((m) => m[1]);

  for (let i = 0; i < headers.length; i++) {
    const title = headers[i];
    const body = sections[i + 1] ?? "";
    const lines = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 15);

    const page = pages.find((p) => normStr(p.title).includes(normStr(title).slice(0, 8)));
    result.push({ slug: page?.slug ?? "", title, lines: lines.slice(0, 12) });
  }
  return result;
}

/**
 * Construye un schema JSON-LD válido según Google Search Central.
 * - blog/article → Article (no Brand, no offers)
 * - landing → Service (provider = LocalBusiness). No Product sin precio.
 * - optimization → Service igual
 * Nunca agrega Brand (solo fabricantes), ni availability sin dato.
 */
function buildSafeSchema(
  kind: string,
  pageTitle: string,
  metaDescription: string,
  siteProfile: WpSiteProfile | null,
  keyword: string,
): Record<string, unknown> {
  const clientName = siteProfile?.clientName ?? "";
  const siteUrl = siteProfile?.siteUrl ?? "";

  // Detect city from keyword (e.g. "bridas industriales Monterrey")
  const cityMatch = keyword.match(
    /\b(monterrey|guadalajara|cdmx|ciudad\s+de\s+m[eé]xico|puebla|juárez|ju[aá]rez|tijuana|le[oó]n|m[eé]rida|torreon|torreón)\b/i,
  );
  const city = cityMatch?.[1] ?? null;

  if (kind === "blog") {
    const schema: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": pageTitle,
      "description": metaDescription,
    };
    if (clientName) {
      schema["publisher"] = {
        "@type": "Organization",
        "name": clientName,
        ...(siteUrl ? { "url": siteUrl } : {}),
      };
    }
    return schema;
  }

  // Landing / optimization → Service
  const provider: Record<string, unknown> = {
    "@type": "LocalBusiness",
    ...(clientName ? { "name": clientName } : {}),
    ...(siteUrl ? { "url": siteUrl } : {}),
    ...(city ? { "address": { "@type": "PostalAddress", "addressLocality": city, "addressCountry": "MX" } } : {}),
  };

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Service",
    "name": pageTitle,
    "description": metaDescription,
    "provider": provider,
  };
  if (city) {
    schema["areaServed"] = { "@type": "City", "name": city, "addressCountry": "MX" };
  }
  return schema;
}

/**
 * Valida que el keyword principal aparezca en H1, meta_title y primer párrafo.
 * Tolera variaciones de acento y capitalización.
 * Retorna lista de advertencias (vacío = ok).
 */
function validateKeywordPresence(
  h1: string,
  metaTitle: string,
  firstSectionText: string,
  keyword: string,
): string[] {
  const warnings: string[] = [];
  // Check each significant word of the keyword (ignore particles ≤3 chars)
  const kwWords = normStr(keyword)
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const check = (text: string, field: string) => {
    const t = normStr(text);
    const missing = kwWords.filter((w) => !t.includes(w));
    if (missing.length > 0) {
      warnings.push(`${field} no contiene: "${missing.join(", ")}" (de keyword "${keyword}")`);
    }
  };

  check(h1, "H1");
  check(metaTitle, "meta_title");
  check(firstSectionText.slice(0, 500), "primer párrafo");

  const metaTitleLen = metaTitle.length;
  if (metaTitleLen < 45) warnings.push(`meta_title demasiado corto (${metaTitleLen} chars, mínimo 45)`);
  if (metaTitleLen > 65) warnings.push(`meta_title demasiado largo (${metaTitleLen} chars, máximo 65)`);

  const metaDescLen = metaTitle.length; // intentional: reuse pattern
  const metaDesc = firstSectionText; // placeholder — real check below
  void metaDescLen; void metaDesc;

  return warnings;
}

/**
 * Segunda pasada con Haiku: verifica afirmaciones sobre el cliente y reemplaza
 * las que no tienen respaldo en factsBlock con [COMPLETAR: ...].
 *
 * Solo verifica campos de texto visible (sections, faq) — no modifica schema,
 * internal_links, ni campos de estructura.
 *
 * Devuelve pkg modificado + lista de reemplazos realizados.
 * Si Haiku falla o devuelve JSON inválido: devuelve el pkg original sin error.
 */
async function verifyAndReplaceUnsupportedClaims(
  pkg: Record<string, unknown>,
  factsBlock: string,
  anthropic: Anthropic,
): Promise<{ revisedPkg: Record<string, unknown>; replacements: string[] }> {
  // Skip if no real facts are available (factsBlock is the "no disponible" message)
  if (factsBlock.startsWith("PERFIL DEL SITIO: no disponible")) {
    return { revisedPkg: pkg, replacements: [] };
  }

  // Only send the text-bearing fields to Haiku — keeps token count low
  const toCheck = {
    h1: pkg.h1,
    sections: pkg.sections,
    faq: pkg.faq,
    cta: pkg.cta,
  };

  const systemPrompt = `Eres un verificador de afirmaciones para contenido SEO B2B en español.

OBJETIVO: identificar afirmaciones sobre el CLIENTE que no tienen respaldo en los HECHOS VERIFICADOS
y reemplazarlas con [COMPLETAR: descripción breve de qué se necesita confirmar].

AFIRMACIONES A VERIFICAR (solo del cliente, no del sector):
- Cobertura geográfica ("distribución nacional", "toda la república", "envíos a todo México")
- Productos/servicios específicos que distribuye o fabrica
- Certificaciones o normas que posee el cliente (ISO, ASME aplicado al cliente, etc.)
- Stock disponible, inventario, capacidad de entrega
- Tiempos de entrega, SLA, plazos de respuesta
- Años de experiencia, clientes atendidos, proyectos completados
- Cualquier número o estadística sobre el cliente

NO TOCAR: conocimiento sectorial general (qué es una brida, normas ASME de la industria,
tipos de productos, usos industriales, etc.) — ese contenido es educativo y no requiere fuente.

RESPONDE SOLO con JSON válido (sin markdown):
{
  "revised": { <mismo objeto JSON que recibiste, con reemplazos aplicados> },
  "replaced": ["texto original reemplazado 1", "texto original reemplazado 2"]
}

Si no encuentras ninguna afirmación no verificada, devuelve "replaced": [].`;

  const userMessage = `HECHOS VERIFICADOS (única fuente autorizada para afirmaciones del cliente):
${factsBlock}

CONTENIDO A VERIFICAR:
${JSON.stringify(toCheck, null, 2)}`;

  try {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 6000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const raw = response.content[0]?.type === "text" ? response.content[0].text : "{}";
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    const result = JSON.parse(cleaned) as { revised?: Record<string, unknown>; replaced?: string[] };

    const costUsd =
      Number(response.usage.input_tokens) * 0.0000008 +
      Number(response.usage.output_tokens) * 0.000004;
    await logApiUsage({ provider: "anthropic", endpoint: "wp-claim-verifier", cost: costUsd });

    if (result.revised && typeof result.revised === "object") {
      const merged = { ...pkg, ...result.revised };
      return { revisedPkg: merged, replacements: result.replaced ?? [] };
    }
  } catch {
    // Haiku failed or returned invalid JSON — silently return original
  }

  return { revisedPkg: pkg, replacements: [] };
}

/**
 * Genera el paquete completo de contenido SEO para una tarea CONTENT de WordPress.
 *
 * Flujo:
 *   1. Si kind=optimization: GET /pages → encontrar página → GET /elementor/{id} para "before" real.
 *      Si falla → lanza error descriptivo (tarea detenida, motivo en failureReason).
 *   2. Construye bloque de hechos verificados con fuente (slug de página).
 *   3. Llama a Claude con system prompt estricto de sourcing.
 *   4. Reemplaza schema con versión válida generada programáticamente.
 *   5. Valida presencia de keyword en H1 / meta_title / primer párrafo.
 *   6. Guarda validation_warnings en stagedChange.
 */
async function executeContentPackage(
  cerebroClientId: string,
  siteProfile: WpSiteProfile | null,
  task: { title: string; objective: string; kind: string; category: string; targetKeyword?: string | null },
  action: WpStepAction,
  taskId: string,
): Promise<WpStepResult> {
  const kind = (action.payload?.kind as string) ?? null;
  if (!kind) {
    return {
      notes: "waiting_human:missing_kind|Falta tipo de contenido (kind: blog/landing/optimization) en el payload del paso.",
    };
  }

  // Keyword resolution: payload → task.targetKeyword → quoted → sanitized → WAITING_HUMAN
  const { resolveKeyword } = await import("@/lib/keyword-resolver");
  const taskTargetKeyword = task.targetKeyword ?? null;
  const keyword = resolveKeyword(
    action.payload?.keyword as string | undefined,
    taskTargetKeyword,
    task.title,
  );
  if (!keyword) {
    return {
      notes: "waiting_human:missing_keyword",
      stagedChange: undefined,
    };
  }
  const pageTitle = (action.payload?.page_title as string) ?? keyword;

  // ── Step A: For optimization, fetch real Elementor data ────────────────────
  type ElementorWidget = { id?: string; type: string; text?: string; alt?: string };
  type ElementorSection = { id: string; type: string; widgets: ElementorWidget[] };
  type ElementorPage = { id: number; title: string; sections: ElementorSection[] };

  let optimizationContext = "";
  let targetPageId = 0;
  let targetPageSlug = "";
  let targetPageTitle = "";
  const realWidgets: Array<{ id?: string; section: string; type: string; text: string }> = [];

  if (kind === "optimization") {
    const pagesResult = await getWpPages(cerebroClientId, taskId);
    if (!pagesResult.ok) {
      throw new Error(
        `content_package optimization: no se pudo leer /pages — ${pagesResult.error}. ` +
        `Verifica que el plugin WP esté activo y el proxy accesible.`,
      );
    }

    // Find matching page: keyword words vs slug/title
    const kwNorm = normStr(keyword);
    const kwWords = kwNorm.split(/\s+/).filter((w) => w.length > 3);
    const match = pagesResult.data.find((p) => {
      const sl = normStr(p.slug);
      const ti = normStr(p.title);
      return kwWords.filter((w) => sl.includes(w) || ti.includes(w)).length >= 2;
    }) ?? pagesResult.data.find((p) => {
      // fallback: at least 1 word
      const sl = normStr(p.slug);
      const ti = normStr(p.title);
      return kwWords.some((w) => sl.includes(w) || ti.includes(w));
    });

    if (!match) {
      const available = pagesResult.data.map((p) => `/${p.slug} ("${p.title}")`).slice(0, 15).join(", ");
      throw new Error(
        `content_package optimization: no se encontró página para keyword "${keyword}". ` +
        `Páginas disponibles: ${available}. ` +
        `Actualiza el objetivo de la tarea con la URL exacta de la página a optimizar.`,
      );
    }

    targetPageId = match.id;
    targetPageTitle = match.title;
    targetPageSlug = match.slug;

    // Fetch Elementor widget tree
    const elResult = await getWpElementorPage(cerebroClientId, targetPageId, taskId);
    if (!elResult.ok) {
      throw new Error(
        `content_package optimization: no se pudo leer Elementor de "${targetPageTitle}" ` +
        `(/${targetPageSlug}, id=${targetPageId}) — ${elResult.error}. ` +
        `Verifica que la página usa Elementor y el plugin v1.5.0+ está instalado.`,
      );
    }

    const elPage = elResult.data as ElementorPage;
    for (const section of elPage.sections) {
      for (const widget of section.widgets) {
        if (widget.text && widget.text.trim().length > 5) {
          realWidgets.push({
            id: widget.id,
            section: section.id,
            type: widget.type,
            text: widget.text.trim().slice(0, 300),
          });
        }
      }
    }

    optimizationContext = [
      `\nPÁGINA A OPTIMIZAR: "${targetPageTitle}" (/${targetPageSlug}, post_id=${targetPageId})`,
      `WIDGETS ACTUALES (texto real de GET /elementor/${targetPageId}):`,
      ...realWidgets.slice(0, 20).map((w, i) => `  [${i + 1}] type=${w.type} id=${w.id ?? "?"} | "${w.text.slice(0, 120)}"`),
      "",
      "INSTRUCCIÓN: Los campos 'before' en optimization_changes DEBEN usar el texto real de arriba.",
      "Incluye widget_id del widget correspondiente.",
    ].join("\n");
  }

  // ── Step B: Build verified-facts block ────────────────────────────────────
  const verifiedFacts = siteProfile
    ? parseVerifiedFacts(siteProfile.contentSummary, siteProfile.pages)
    : [];

  const factsBlock = siteProfile
    ? [
        "HECHOS VERIFICADOS DEL CLIENTE (con fuente — ÚNICA base para afirmaciones):",
        `Cliente: ${siteProfile.clientName}`,
        `Sitio: ${siteProfile.siteUrl}`,
        "",
        "Páginas del sitio:",
        siteProfile.pages.slice(0, 30).map((p) => `  /${p.slug || "(raíz)"} — "${p.title}"`).join("\n"),
        "",
        "Contenido extraído por página:",
        ...verifiedFacts.flatMap((pf) =>
          pf.lines.length > 0
            ? [`  [/${pf.slug}]`, ...pf.lines.map((l) => `    • ${l}`)]
            : []
        ),
      ].join("\n")
    : "PERFIL DEL SITIO: no disponible. Usa [COMPLETAR: descripción] para cualquier dato específico del cliente.";

  // ── Step C: Build prompt ──────────────────────────────────────────────────
  const systemPrompt = `Eres un especialista en contenido SEO para sitios WordPress en México.
Generas paquetes de contenido estructurados como JSON.

REGLA DE SOURCING (crítica, no negociable):
• Cada afirmación sobre lo que el CLIENTE vende, distribuye, cubre, certifica, garantiza
  o tiene en stock DEBE venir de los HECHOS VERIFICADOS. Si no hay fuente → [COMPLETAR: descripción].
• Puedes incluir contenido EDUCATIVO general del sector (qué es una brida weld neck,
  cómo funciona una tubería API) sin atribuírselo al cliente como oferta propia.
• Ejemplos válidos: "Las bridas weld neck se usan en sistemas de alta presión" (educativo, ok)
• Ejemplos inválidos: "Distribuimos bridas weld neck" (afirmación del cliente sin fuente → [COMPLETAR])

FORMATO:
• keyword: incluir las palabras clave principales en H1 y meta_title. Pueden reorganizarse o abreviarse para cumplir con los límites.
• meta_title: 50-65 caracteres. Si la keyword es larga, usa solo sus palabras significativas (no forzar el texto exacto). meta_description: 140-160 caracteres.
• Cada sección: texto completo de 80-150 palabras (no resúmenes).
• Tablas: usa filas reales si los datos son de conocimiento sectorial (normas ASME, clases de presión).
  Si dependen del inventario del cliente → [COMPLETAR: valor].
• cta: objeto {text: "...", url: "/ruta-de-contacto"} usando rutas del sitio.
• internal_links: array de {anchor, url, context} con URLs reales del sitio.
• faq: mínimo 4 preguntas. Respuestas: datos verificados o [COMPLETAR].
• schema_jsonld: NO generar — se construye automáticamente.

RESPONDE SOLO con JSON válido (sin markdown, sin texto):
{
  "h1": "...",
  "sections": [{"h2": "...", "h3s": [...], "text": "...", "table": {"headers":[...],"rows":[[...]]}}],
  "meta_title": "...",
  "meta_description": "...",
  "internal_links": [{"anchor": "...", "url": "...", "context": "..."}],
  "faq": [{"q": "...", "a": "..."}],
  "cta": {"text": "...", "url": "..."},
  "image_brief": "...",
  "optimization_changes": []
}`;

  const cta_hint = siteProfile?.pages.find(
    (p) => /contacto|cotiz|contact/i.test(p.slug) || /contacto|cotiz/i.test(p.title),
  );
  const ctaUrl = cta_hint ? `/${cta_hint.slug}` : "/contacto";

  const kindInstructions: Record<string, string> = {
    blog: `Artículo de blog informativo de 1200-1800 palabras sobre "${keyword}". Mínimo 4 secciones H2, 4 FAQ, 2 enlaces internos. CTA url: "${ctaUrl}".`,
    landing: `Página de servicio/producto sobre "${keyword}". Mínimo 5 secciones H2, tabla de especificaciones/tipos (normas sectoriales ok, precios → [COMPLETAR]), 4 FAQ, 2 enlaces internos. CTA url: "${ctaUrl}".`,
    optimization: `Mejoras específicas para la página "${targetPageTitle}" (/${targetPageSlug}). optimization_changes DEBE usar los widgets reales listados en PÁGINA A OPTIMIZAR. widget_id obligatorio para cada cambio.`,
  };

  const userPrompt = [
    factsBlock,
    optimizationContext,
    "",
    `TIPO: ${kind}`,
    `KEYWORD PRINCIPAL: ${keyword}`,
    `TÍTULO SEO DE PÁGINA: ${pageTitle}`,
    `OBJETIVO DE LA TAREA: ${task.objective}`,
    "",
    kindInstructions[kind] ?? kindInstructions.landing,
  ].join("\n");

  // ── Steps D + D2: Generate (with 1 retry if keyword missing from H1/meta_title) ──
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  type PkgResult = {
    pkg: Record<string, unknown>;
    inputTokens: number;
    outputTokens: number;
  };

  async function callClaude(messages: Anthropic.MessageParam[]): Promise<PkgResult> {
    const { parseClaudeJson } = await import("@/lib/parse-claude-json");
    const res = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      system: systemPrompt,
      messages,
    });
    const raw = res.content[0]?.type === "text" ? res.content[0].text : "{}";
    const parsed = parseClaudeJson<Record<string, unknown>>(raw);
    if (!parsed.ok) {
      throw new Error(`content_package_json_failed:${parsed.rawText.slice(0, 500)}`);
    }
    return { pkg: parsed.data, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  }

  let { pkg, inputTokens, outputTokens } = await callClaude([
    { role: "user", content: userPrompt },
  ]);

  // Check keyword presence before possible retry
  // Use significant words (>3 chars) — at least 60% must appear, not all
  const kwWordsForCheck = normStr(keyword).split(/\s+/).filter((w) => w.length > 3);
  const threshold = Math.ceil(kwWordsForCheck.length * 0.6);
  const h1Norm = normStr((pkg.h1 as string) ?? "");
  const metaNorm = normStr((pkg.meta_title as string) ?? "");
  const h1Hits = kwWordsForCheck.filter((w) => h1Norm.includes(w)).length;
  const metaHits = kwWordsForCheck.filter((w) => metaNorm.includes(w)).length;
  const hasKwInH1 = h1Hits >= threshold;
  const hasKwInMeta = metaHits >= threshold;

  if (!hasKwInH1 || !hasKwInMeta) {
    const missing: string[] = [];
    if (!hasKwInH1) missing.push(`H1 actual: "${(pkg.h1 as string) ?? ""}" (${h1Hits}/${kwWordsForCheck.length} palabras clave)`);
    if (!hasKwInMeta) missing.push(`meta_title actual: "${(pkg.meta_title as string) ?? ""}" (${metaHits}/${kwWordsForCheck.length} palabras clave)`);

    // Single retry — flexible: include significant words, not exact string
    const retryMessages: Anthropic.MessageParam[] = [
      { role: "user", content: userPrompt },
      { role: "assistant", content: JSON.stringify(pkg) },
      {
        role: "user",
        content: [
          `CORRECCIÓN: las palabras clave de "${keyword}" no aparecen suficientemente en:`,
          ...missing,
          "",
          `Reescribe el JSON con estas correcciones:`,
          `- h1: incluir las palabras principales de "${keyword}" (pueden reorganizarse)`,
          `- meta_title: incluir las palabras principales (máx 65 caracteres, no forzar texto exacto)`,
          `Responde SOLO con el JSON corregido.`,
        ].join("\n"),
      },
    ];
    const retry = await callClaude(retryMessages);
    inputTokens += retry.inputTokens;
    outputTokens += retry.outputTokens;

    const retryH1Ok = kwWordsForCheck.every((w) => normStr((retry.pkg.h1 as string) ?? "").includes(w));
    const retryMetaOk = kwWordsForCheck.every((w) => normStr((retry.pkg.meta_title as string) ?? "").includes(w));

    if (retryH1Ok && retryMetaOk) {
      pkg = retry.pkg;
    } else {
      // Still failing after retry → use retry result but flag for human review
      pkg = retry.pkg;
      const stillMissing: string[] = [];
      if (!retryH1Ok) stillMissing.push("H1");
      if (!retryMetaOk) stillMissing.push("meta_title");
      pkg.__needs_human_review = true;
      pkg.__human_review_reason = `Keyword "${keyword}" no incluida en: ${stillMissing.join(", ")} tras reintento automático. Revisar y corregir manualmente.`;
    }
  }

  // ── Step D3: Claim verifier (Haiku second pass) ───────────────────────────
  const { revisedPkg, replacements } = await verifyAndReplaceUnsupportedClaims(
    pkg,
    factsBlock,
    anthropic,
  );
  if (replacements.length > 0) {
    pkg = revisedPkg;
  }

  // ── Step E: Build valid schema (programmatic, not from Claude) ────────────
  const safeSchema = buildSafeSchema(kind, pageTitle, (pkg.meta_description as string) ?? "", siteProfile, keyword);

  // ── Step F: Normalize optimization_changes with real widget IDs ───────────
  type RawChange = { page_title?: string; page_id?: number; widgets?: Array<{
    widget_id?: string; section?: string; widget_type?: string; before?: string; after?: string;
  }> };
  const rawChanges = (pkg.optimization_changes as RawChange[] | undefined) ?? [];
  const normalizedChanges: WpStagedContentPackageChange["optimization_changes"] =
    kind === "optimization" && rawChanges.length > 0
      ? rawChanges.map((c) => ({
          page_title: c.page_title ?? targetPageTitle,
          page_id: c.page_id ?? targetPageId,
          page_slug: targetPageSlug,
          widgets: (c.widgets ?? []).map((w) => {
            const realWidget = w.widget_id
              ? realWidgets.find((rw) => rw.id === w.widget_id)
              : realWidgets.find(
                  (rw) =>
                    rw.type === w.widget_type &&
                    w.before && normStr(rw.text).includes(normStr(w.before).slice(0, 20)),
                );
            return {
              widget_id: realWidget?.id ?? w.widget_id,
              section: realWidget?.section ?? w.section ?? "",
              widget_type: realWidget?.type ?? w.widget_type ?? "",
              before: realWidget?.text ?? w.before ?? "",
              after: w.after ?? "",
            };
          }),
        }))
      : undefined;

  // ── Step G: CTA normalization ─────────────────────────────────────────────
  type CtaObj = { text?: string; url?: string };
  const rawCta = pkg.cta as string | CtaObj | undefined;
  const ctaText = typeof rawCta === "object" ? (rawCta?.text ?? "") : (rawCta ?? "");
  const ctaUrlFinal = typeof rawCta === "object" ? (rawCta?.url ?? ctaUrl) : ctaUrl;
  const ctaFinal = `${ctaText} — ${ctaUrlFinal}`;

  // ── Step H: Validate keyword + lengths ───────────────────────────────────
  const h1 = (pkg.h1 as string) ?? pageTitle;
  const metaTitle = (pkg.meta_title as string) ?? "";
  const metaDescription = (pkg.meta_description as string) ?? "";
  const sections = (pkg.sections as WpStagedContentPackageChange["sections"]) ?? [];
  const firstSectionText = sections[0]?.text ?? "";

  const warnings = validateKeywordPresence(h1, metaTitle, firstSectionText, keyword);

  if (metaDescription.length < 120) warnings.push(`meta_description corta (${metaDescription.length} chars, recomendado 140+)`);
  if (metaDescription.length > 165) warnings.push(`meta_description larga (${metaDescription.length} chars, máximo 165)`);

  // Claim verifier results
  if (replacements.length > 0) {
    warnings.push(
      `[verificador] ${replacements.length} afirmación(es) sin fuente reemplazada(s) con [COMPLETAR]:`,
      ...replacements.map((r) => `  • "${r.slice(0, 120)}"`),
    );
  }

  // Propagate human review flag from retry logic
  if (pkg.__needs_human_review) {
    warnings.unshift(`⚠ REVISIÓN HUMANA REQUERIDA: ${pkg.__human_review_reason as string}`);
  }

  // ── Assemble staged change ────────────────────────────────────────────────
  const stagedChange: WpStagedContentPackageChange = {
    type: "content_package" as const,
    kind: kind as "blog" | "landing" | "optimization",
    keyword,
    page_title: pageTitle,
    h1,
    sections,
    meta_title: metaTitle,
    meta_description: metaDescription,
    schema_jsonld: safeSchema,
    internal_links: (pkg.internal_links as WpStagedContentPackageChange["internal_links"]) ?? [],
    faq: (pkg.faq as WpStagedContentPackageChange["faq"]) ?? [],
    cta: ctaFinal,
    image_brief: (pkg.image_brief as string | undefined),
    optimization_changes: normalizedChanges,
    validation_warnings: warnings.length > 0 ? warnings : undefined,
    staged_at: new Date().toISOString(),
  };

  const costUsd = inputTokens * 0.000003 + outputTokens * 0.000015;
  await logApiUsage({ provider: "anthropic", endpoint: "wp-content-package", cost: costUsd });

  const needsReview = !!pkg.__needs_human_review;
  const warnNote = warnings.length > 0
    ? needsReview ? ` | 🔴 REVISIÓN REQUERIDA` : ` | ⚠ ${warnings.length} advertencia(s)`
    : "";
  const notes = `content_package OK — kind=${kind} kw="${keyword}" secciones=${sections.length} faq=${stagedChange.faq?.length ?? 0}${warnNote}`;

  return { notes, stagedChange };
}

// --- Publish -----------------------------------------------------------------

/**
 * Genera articulo de blog con Claude y lo crea como borrador en WP.
 * El generador solo puede afirmar datos del perfil del sitio.
 * Datos desconocidos -> [COMPLETAR: descripcion].
 */
async function executeWpPublish(
  cerebroClientId: string,
  siteProfile: WpSiteProfile | null,
  task: { title: string; objective: string },
  action: WpStepAction,
  taskId: string,
): Promise<WpStepResult> {
  const title = String(action.payload?.title ?? task.title);
  const brief = action.content_brief ?? task.objective;

  const profileBlock = siteProfile?.hasContent
    ? [
        "PERFIL DEL SITIO (unica fuente de verdad — solo afirma lo que esta aqui):",
        "---",
        `Cliente: ${siteProfile.clientName}`,
        `Sitio: ${siteProfile.siteUrl}`,
        "",
        "Paginas del sitio:",
        siteProfile.pages.map((p) => `- ${p.title} (/${p.slug})`).join("\n"),
        "",
        "Extracto del contenido actual:",
        siteProfile.contentSummary,
        "---",
      ].join("\n")
    : [
        "PERFIL DEL SITIO: no disponible.",
        "Usa [COMPLETAR: descripcion] para CUALQUIER dato especifico del cliente.",
        "Solo incluye contenido informativo general del sector.",
      ].join("\n");

  const systemPrompt = [
    "Eres un especialista en contenido SEO para agencias de marketing digital en Mexico.",
    "Escribes articulos de blog en espanol para sitios WordPress de clientes reales.",
    "",
    "REGLAS CRITICAS:",
    "1. Solo puedes afirmar datos que esten explicitamente en el PERFIL DEL SITIO.",
    "2. Si un dato especifico (precio, certificacion, caso de exito, numero, direccion, telefono) NO esta en el perfil -> escribe [COMPLETAR: descripcion del dato] como placeholder.",
    "3. Contenido informativo del sector que no requiera verificacion -> puedes incluirlo.",
    "4. PROHIBIDO inventar: testimonios falsos, estadisticas del cliente, certificaciones no mencionadas.",
    "5. HTML semantico sin <html>/<body>/<head>. Usa <h2>, <h3>, <p>, <ul>, <li>, <strong>, <em>.",
    "6. Entre 1500 y 2500 palabras.",
  ].join("\n");

  const userPrompt = [
    profileBlock,
    "",
    `TITULO: ${title}`,
    "",
    "BRIEF:",
    brief,
    "",
    "Escribe el articulo completo de blog.",
  ].join("\n");

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const contentResponse = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const content = contentResponse.content[0]?.type === "text" ? contentResponse.content[0].text : "";
  if (!content) throw new Error("Claude no genero contenido para el articulo");

  // Conteo y muestras de placeholders
  const placeholderMatches = content.match(/\[COMPLETAR[^\]]*\]/gi) ?? [];
  const placeholderSamples = placeholderMatches.slice(0, 3).map((s) => s.slice(0, 80));

  const publishResult = await publishWpPost(cerebroClientId, {
    title,
    content,
    status: "draft",
    slug: action.payload?.slug as string | undefined,
    focus_keyword: action.payload?.focus_keyword as string | undefined,
    categories: action.payload?.categories as string[] | undefined,
  }, taskId);

  if (!publishResult.ok) throw new Error(`WP /publish fallo: ${publishResult.error}`);

  const { post_id, draft_url, edit_url } = publishResult.data;
  const previewUrl = draft_url ?? edit_url;

  const stagedChange: WpStagedBlogChange = {
    type: "blog",
    post_id,
    title,
    draft_url: previewUrl ?? null,
    focus_keyword: action.payload?.focus_keyword as string | null ?? null,
    has_placeholders: placeholderMatches.length > 0,
    placeholder_count: placeholderMatches.length,
    placeholder_samples: placeholderSamples,
    staged_at: new Date().toISOString(),
  };

  const placeholderNote = placeholderMatches.length > 0
    ? ` | ${placeholderMatches.length} placeholder(s) [COMPLETAR pendientes`
    : "";
  const notes = `wp:publish OK — post_id=${post_id}${previewUrl ? ` draft_url=${previewUrl}` : ""}${placeholderNote}`;

  const costUsd =
    Number(contentResponse.usage.input_tokens) * 0.000003 +
    Number(contentResponse.usage.output_tokens) * 0.000015;
  await logApiUsage({ provider: "anthropic", endpoint: "wp-publish-content", cost: costUsd });

  return { notes, previewUrl, stagedChange };
}

// --- SEO (siempre stagea — NUNCA aplica directamente) ------------------------

/**
 * Genera meta title/description con Claude y los stagea en PlanStep.stagedChange.
 *
 * NUNCA llama a updateWpSeo() — eso es responsabilidad de publishWpPlanAction.
 * Si page_id=0 (desconocido), publishWpPlanAction intentara resolverlo via GET /pages.
 */
async function executeWpSeo(
  cerebroClientId: string,
  task: { title: string; objective: string },
  action: WpStepAction,
  _taskId: string,
): Promise<WpStepResult> {
  const pageId = Number(action.payload?.page_id ?? 0);
  let metaTitle = action.payload?.meta_title as string | undefined;
  let metaDescription = action.payload?.meta_description as string | undefined;
  const focusKeyword = action.payload?.focus_keyword as string | undefined ?? null;

  if (!metaTitle || !metaDescription) {
    const brief = action.content_brief ?? `${task.title}: ${task.objective}`;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const metaResponse = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      messages: [{
        role: "user",
        content: [
          "Genera meta title y meta description para SEO segun este contexto.",
          "meta_title: 50-60 caracteres exactos, incluye keyword principal.",
          "meta_description: 140-160 caracteres exactos, incluye beneficio claro y CTA suave.",
          "PROHIBIDO inventar datos del cliente.",
          'Responde SOLO con JSON: {"meta_title": "...", "meta_description": "..."}',
          "",
          "CONTEXTO:",
          brief,
        ].join("\n"),
      }],
    });

    const rawMeta = metaResponse.content[0]?.type === "text" ? metaResponse.content[0].text : "{}";
    try {
      const cleaned = rawMeta.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
      const parsed = JSON.parse(cleaned) as { meta_title?: string; meta_description?: string };
      metaTitle = metaTitle ?? parsed.meta_title;
      metaDescription = metaDescription ?? parsed.meta_description;
    } catch {
      // usar lo que tengamos
    }

    const costUsd =
      Number(metaResponse.usage.input_tokens) * 0.000003 +
      Number(metaResponse.usage.output_tokens) * 0.000015;
    await logApiUsage({ provider: "anthropic", endpoint: "wp-seo-meta", cost: costUsd });
  }

  const stagedChange: WpStagedSeoChange = {
    type: "seo",
    page_id: pageId,
    meta_title: metaTitle ?? "",
    meta_description: metaDescription ?? "",
    focus_keyword: focusKeyword,
    objective: task.objective.slice(0, 200),
    generated: !!(metaTitle && metaDescription),
    staged_at: new Date().toISOString(),
  };

  const pageNote = pageId === 0
    ? " (page_id=0 — se resolvera con GET /pages al publicar)"
    : ` para page_id=${pageId}`;
  const generatedNote = metaTitle && metaDescription
    ? `meta_title="${metaTitle}" (${metaTitle.length} chars)${pageNote}`
    : `generacion fallida — completar manualmente${pageNote}`;

  return {
    notes: `wp:seo staged — ${generatedNote}`,
    stagedChange,
  };
}

// --- Elementor (stagea borrador — NUNCA aplica directamente) -----------------

/**
 * Edita una pagina Elementor existente con Claude:
 *   1. Lee el arbol de widgets via GET /elementor/{page_id}
 *   2. Usa Claude para generar los widget updates segun el objetivo del step
 *   3. Duplica la pagina como borrador via POST /elementor/duplicate/{page_id}
 *   4. Aplica los widget updates al borrador via PATCH /elementor/{draft_id}/widgets
 *   5. Stagea WpStagedElementorChange en PlanStep.stagedChange
 *
 * NUNCA llama a applyWpElementorDraft() — eso es responsabilidad de publishWpPlanAction.
 */
async function executeWpElementor(
  cerebroClientId: string,
  task: { title: string; objective: string },
  action: WpStepAction,
  taskId: string,
): Promise<WpStepResult> {
  const pageId = Number(action.payload?.page_id ?? 0);

  if (!pageId) {
    return {
      notes: `wp:elementor staged — page_id=0: completar manualmente. Objetivo: ${task.objective.slice(0, 200)}`,
    };
  }

  // 1. Obtener el arbol de widgets actual para que Claude sepa que cambiar
  const pageResult = await getWpElementorPage(cerebroClientId, pageId, taskId);
  const currentWidgets = pageResult.ok ? pageResult.data.sections.flatMap((s) => s.widgets) : [];
  const pageTitle = pageResult.ok ? pageResult.data.title : `Pagina ${pageId}`;

  // 2. Generar widget updates con Claude
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const widgetsContext = currentWidgets.length > 0
    ? [
        "WIDGETS ACTUALES DE LA PAGINA (id, tipo, texto actual):",
        ...currentWidgets.slice(0, 20).map((w) => {
          const text = w.text ?? w.alt ?? "";
          return `- id="${w.id}" type="${w.type}"${text ? ` texto="${text.slice(0, 80)}"` : ""}`;
        }),
      ].join("\n")
    : "WIDGETS: no disponibles (la pagina no tiene datos Elementor o el proxy no respondio)";

  const updateResponse = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: [
        "Eres un especialista en WordPress/Elementor para una agencia de marketing digital.",
        "Debes generar los cambios exactos de widgets para cumplir el objetivo del step.",
        "",
        widgetsContext,
        "",
        `OBJETIVO DEL STEP: ${task.objective}`,
        `TAREA: ${task.title}`,
        "",
        "INSTRUCCIONES:",
        "1. Devuelve SOLO un JSON array de widget updates.",
        "2. Solo incluye widgets que realmente necesitan cambio.",
        "3. Para heading: { id, type:'heading', text:'...', heading_size?:'h1'|'h2'|'h3'|'h4' }",
        "4. Para text-editor: { id, type:'text-editor', text:'<p>...</p>' }",
        "5. Para image: { id, type:'image', url:'...', alt:'...' }",
        "6. Para button: { id, type:'button', text:'...', link?:'...' }",
        "7. PROHIBIDO inventar datos del cliente sin certeza. Usa texto descriptivo si no sabes el valor exacto.",
        "8. Si no hay widgets aplicables, devuelve []",
        "",
        'Responde SOLO con JSON array: [{ "id": "...", "type": "...", ... }, ...]',
      ].join("\n"),
    }],
  });

  const rawUpdates = updateResponse.content[0]?.type === "text" ? updateResponse.content[0].text : "[]";
  let widgetUpdates: WpWidgetUpdate[] = [];
  try {
    const cleaned = rawUpdates.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    widgetUpdates = JSON.parse(cleaned) as WpWidgetUpdate[];
    if (!Array.isArray(widgetUpdates)) widgetUpdates = [];
  } catch {
    // si Claude no devuelve JSON valido, continuar con updates vacios
  }

  const costUsd =
    Number(updateResponse.usage.input_tokens) * 0.000003 +
    Number(updateResponse.usage.output_tokens) * 0.000015;
  await logApiUsage({ provider: "anthropic", endpoint: "wp-elementor-updates", cost: costUsd });

  // 3. Duplicar la pagina como borrador
  const dupResult = await duplicateWpElementorPage(cerebroClientId, pageId, taskId);
  if (!dupResult.ok) {
    return {
      notes: `wp:elementor error — no se pudo duplicar pagina ${pageId}: ${dupResult.error}`,
    };
  }

  const draftId = dupResult.data.draft_id;
  const editUrl = dupResult.data.edit_url;
  let widgetsApplied = 0;

  // 4. Aplicar widget updates al borrador (si hay updates)
  if (widgetUpdates.length > 0) {
    const patchResult = await updateWpElementorWidgets(cerebroClientId, draftId, widgetUpdates, taskId);
    if (patchResult.ok) {
      widgetsApplied = patchResult.data.applied;
    }
  }

  const stagedChange: WpStagedElementorChange = {
    type: "elementor",
    page_id: pageId,
    page_title: pageTitle,
    draft_id: draftId,
    draft_title: dupResult.data.draft_title,
    widgets_updated: widgetsApplied,
    edit_url: editUrl,
    staged_at: new Date().toISOString(),
  };

  const notes = [
    `wp:elementor staged — pagina "${pageTitle}" (id=${pageId})`,
    `borrador draft_id=${draftId}`,
    widgetsApplied > 0 ? `${widgetsApplied} widget(s) actualizado(s)` : "sin cambios de widget (revisar manualmente)",
    `editar: ${editUrl}`,
  ].join(" | ");

  return { notes, previewUrl: editUrl, stagedChange };
}
