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
  task: { title: string; objective: string; kind: string; category: string },
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

  if (action.action === "content_package") return executeContentPackage(siteProfile, task, action, taskId);
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

/**
 * Genera el paquete completo de contenido SEO para una tarea CONTENT de WordPress.
 * No requiere plugin WP — es generación pura con Claude usando el perfil del sitio.
 *
 * Tipos:
 *   blog        → H1, H2/H3, textos, tablas, FAQ, CTA, metas, schema, enlaces, brief imagen
 *   landing     → igual que blog, orientado a página de servicio/producto
 *   optimization → cambios antes→después por widget para una página existente
 *
 * El resultado se guarda en PlanStep.stagedChange como WpStagedContentPackageChange.
 * La UI lo muestra con bloques copiables individuales.
 */
async function executeContentPackage(
  siteProfile: WpSiteProfile | null,
  task: { title: string; objective: string; kind: string; category: string },
  action: WpStepAction,
  taskId: string,
): Promise<WpStepResult> {
  const kind = (action.payload?.kind as string) ?? "landing";
  const keyword = (action.payload?.keyword as string) ?? task.title;
  const pageTitle = (action.payload?.page_title as string) ?? task.title;

  const profileBlock = siteProfile?.hasContent
    ? [
        "PERFIL DEL SITIO (única fuente — solo afirma lo que está aquí):",
        `Cliente: ${siteProfile.clientName}`,
        `Sitio: ${siteProfile.siteUrl}`,
        "",
        "Páginas existentes:",
        siteProfile.pages.slice(0, 30).map((p) => `- /${p.slug || ""} — "${p.title}"`).join("\n"),
        "",
        "Contenido actual:",
        siteProfile.contentSummary.slice(0, 2000),
      ].join("\n")
    : "PERFIL DEL SITIO: no disponible. Usa [COMPLETAR: descripción] para cualquier dato específico del cliente.";

  const systemPrompt = `Eres un especialista en contenido SEO para sitios WordPress en México.
Generas paquetes de contenido estructurados en JSON.

REGLAS:
1. Solo afirmar datos que estén explícitamente en el PERFIL DEL SITIO.
2. Datos no verificables (precio, certificaciones, casos reales, direcciones) → "[COMPLETAR: descripción]"
3. Para kind=optimization: propón cambios específicos de widgets existentes (antes→después).
4. Español de México, tono profesional, sin tecnicismos innecesarios.
5. Schema JSON-LD debe ser válido y apropiado para el tipo de página.
6. Meta title: 50-60 caracteres. Meta description: 140-160 caracteres.
7. Mínimo 3 secciones H2. Mínimo 3 FAQ. Mínimo 2 enlaces internos.

RESPONDE SOLO con JSON (sin markdown, sin texto adicional):`;

  const kindInstructions: Record<string, string> = {
    blog: `Artículo de blog informativo sobre "${keyword}". JSON con: h1, sections([{h2, h3s?, text, table?}]), meta_title, meta_description, schema_jsonld({@type:Article}), internal_links([{anchor,url,context}]), faq([{q,a}]), cta, image_brief.`,
    landing: `Página de aterrizaje para "${keyword}". JSON con: h1, sections([{h2, h3s?, text, table?}]), meta_title, meta_description, schema_jsonld({@type:Service o Product}), internal_links([{anchor,url,context}]), faq([{q,a}]), cta, image_brief.`,
    optimization: `Optimización de página existente sobre "${keyword}". JSON con: h1 (nuevo), sections([{h2, h3s?, text}]), meta_title (mejorado), meta_description (mejorada), schema_jsonld, internal_links, faq, cta, optimization_changes([{page_title,page_id:0,widgets:[{section,widget_type,before,after}]}]).`,
  };

  const userPrompt = [
    profileBlock,
    "",
    `TIPO: ${kind}`,
    `KEYWORD PRINCIPAL: ${keyword}`,
    `TÍTULO DE PÁGINA: ${pageTitle}`,
    `OBJETIVO: ${task.objective}`,
    "",
    kindInstructions[kind] ?? kindInstructions.landing,
  ].join("\n");

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const rawText = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const cleaned = rawText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new Error(`content_package: JSON parse failed. Respuesta: ${cleaned.slice(0, 300)}`);
  }

  const stagedChange: WpStagedContentPackageChange = {
    type: "content_package" as const,
    kind: kind as "blog" | "landing" | "optimization",
    keyword,
    page_title: pageTitle,
    h1: (pkg.h1 as string) ?? pageTitle,
    sections: (pkg.sections as WpStagedContentPackageChange["sections"]) ?? [],
    meta_title: (pkg.meta_title as string) ?? "",
    meta_description: (pkg.meta_description as string) ?? "",
    schema_jsonld: (pkg.schema_jsonld as Record<string, unknown>) ?? {},
    internal_links: (pkg.internal_links as WpStagedContentPackageChange["internal_links"]) ?? [],
    faq: (pkg.faq as WpStagedContentPackageChange["faq"]) ?? [],
    cta: (pkg.cta as string) ?? "",
    image_brief: (pkg.image_brief as string | undefined),
    optimization_changes: (pkg.optimization_changes as WpStagedContentPackageChange["optimization_changes"]),
    staged_at: new Date().toISOString(),
  };

  const costUsd =
    Number(response.usage.input_tokens) * 0.000003 +
    Number(response.usage.output_tokens) * 0.000015;
  await logApiUsage({ provider: "anthropic", endpoint: "wp-content-package", cost: costUsd });

  const sectionCount = stagedChange.sections?.length ?? 0;
  const faqCount = stagedChange.faq?.length ?? 0;
  const notes = `content_package OK — kind=${kind} keyword="${keyword}" secciones=${sectionCount} faq=${faqCount}`;

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
