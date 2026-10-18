/**
 * Cliente para el proxy WP plugin de Cerebro web.
 *
 * Cerebro SEO NUNCA almacena credenciales de WordPress.
 * Las keys del plugin viven en Cerebro web (WpSiteCredential, AES-256-GCM).
 * Cerebro SEO accede al plugin WP únicamente a través de este proxy,
 * autenticando con WP_PROXY_SECRET (bearer token M2M).
 *
 * Contrato del proxy (app/api/wp-plugin/proxy/route.ts en Cerebro web):
 *   POST {CEREBRO_API_URL}/api/wp-plugin/proxy
 *   Authorization: Bearer {WP_PROXY_SECRET}
 *   X-Task-Id: {taskId}   (requerido en rutas de escritura — audit log)
 *   Body: { clienteId: string, endpoint: string, method?: "GET"|"POST"|"PUT"|"PATCH", body?: object }
 *   Response: { ok: true, status: number, data: unknown }
 *           | { ok: false, error: string, status?: number }
 *
 * Plugin WP namespace (desde v1.5.0): /wp-json/clicksociety/v1/
 *
 * Allowlist activa en el proxy:
 *   GET:   /ping, /categories, /system-info, /capabilities, /pages, /templates,
 *          /seo/{id}, /elementor/{id}, /kit, /forms/submissions
 *   POST:  /publish, /media, /seo/{id}
 *          /elementor/duplicate/{pageId}           (requiere X-Task-Id)
 *          /elementor/apply/{draftId}              (requiere X-Task-Id)
 *          /elementor/revert/{pageId}/{revisionId} (requiere X-Task-Id)
 *          /elementor/from-template                (requiere X-Task-Id)
 *          /elementor/import                       (requiere X-Task-Id)
 *   PUT:   /update/{id}                            (requiere X-Task-Id)
 *   PATCH: /elementor/{draftId}/widgets            (requiere X-Task-Id)
 */

import { redis } from "@/lib/redis";

const CEREBRO_BASE = (process.env.CEREBRO_API_URL ?? "").replace(/\/$/, "");
const WP_PROXY_SECRET = process.env.WP_PROXY_SECRET ?? "";

const CAPABILITIES_TTL_SECONDS = 24 * 60 * 60; // 24 h

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface WpCapabilities {
  /** Endpoints activos en el plugin (sin slash inicial). */
  endpoints: string[];
  /** true desde v1.6.0: todas las rutas de escritura requieren X-Task-Id. */
  write_require_task_id?: boolean;
  elementor_active?: boolean;
  elementor_pro_active?: boolean;
}

export interface WpPage {
  id: number;
  title: string;
  slug: string;
  link: string;
}

export interface WpElementorWidget {
  type: string;
  id: string;
  text?: string;
  alt?: string;
  src?: string;
  href?: string;
}

export interface WpElementorSection {
  id: string;
  type: string;
  widgets: WpElementorWidget[];
}

export interface WpElementorPage {
  id: number;
  title: string;
  sections: WpElementorSection[];
}

// ─── v1.6.0 tipos ────────────────────────────────────────────────────────────

export interface WpKitColor {
  _id: string;
  title: string;
  color: string;
}

export interface WpKitTypography {
  _id: string;
  title: string;
  font_family: string;
  font_weight: string;
  font_size?: string | number;
  font_size_unit?: string;
}

export interface WpKit {
  kit_id: number;
  kit_title: string;
  system_colors: WpKitColor[];
  custom_colors: WpKitColor[];
  system_typography: WpKitTypography[];
  custom_typography: WpKitTypography[];
}

/** Widget plano devuelto por duplicate/from-template/import/widgets para edición inmediata. */
export interface WpSimplifiedWidget {
  id: string;
  type: string;
  text?: string;
  heading_size?: string;
  url?: string;
  alt?: string;
  link?: string;
  title?: string;
  description?: string;
  content?: string;
  name?: string;
}

export interface WpElementorDraft {
  draft_id: number;
  draft_title: string;
  source_id?: number;
  template_id?: number;
  post_type: string;
  edit_url: string;
  widgets: WpSimplifiedWidget[];
}

/** Payload para actualizar un widget en PATCH /elementor/{draftId}/widgets. */
export interface WpWidgetUpdate {
  /** ID interno del nodo Elementor (no el post_id). */
  id: string;
  type?: string;
  /** heading / text-editor / icon-box description / genérico */
  text?: string;
  /** Solo heading: h1–h6 */
  heading_size?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  /** image: URL de la imagen */
  url?: string;
  /** image: texto alternativo */
  alt?: string;
  /** image: attachment_id de WP (opcional) */
  attachment_id?: number;
  /** button: URL del enlace */
  link?: string;
  /** icon-box: título */
  title?: string;
}

export interface WpWidgetsResult {
  draft_id: number;
  applied: number;
  not_found: string[];
  widgets: WpSimplifiedWidget[];
}

export interface WpApplyResult {
  original_id: number;
  link: string;
  /** Revisión WP creada antes de sobreescribir. Pasar a /revert para deshacer. */
  revision_id: number | null;
  applied_at: string;
}

export interface WpRevertResult {
  page_id: number;
  revision_id: number;
  reverted_at: string;
  link: string;
}

export interface WpFormSubmissionSummary {
  form_page_id: number;
  form_page_title: string;
  count_30d: number;
  last_submission: string;
  /** Nombres de campos del formulario — sin valores (no PII). */
  field_names: string[];
}

export interface WpFormsSubmissionsResult {
  elementor_pro: boolean;
  message?: string;
  period?: string;
  total_forms?: number;
  submissions: WpFormSubmissionSummary[];
}

// ─────────────────────────────────────────────────────────────────────────────

/** Resultado tipado: o bien los datos, o bien un error con razón (sin secretos). */
export type WpProxyResult<T> =
  | { ok: true; data: T; fromCache?: boolean }
  | { ok: false; error: string };

// ─── Proxy call ──────────────────────────────────────────────────────────────

interface ProxyOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH";
  body?: unknown;
  taskId?: string;
}

async function proxyCall(
  clienteId: string,
  endpoint: string,
  opts: ProxyOptions = {}
): Promise<WpProxyResult<unknown>> {
  if (!CEREBRO_BASE) {
    return { ok: false, error: "CEREBRO_API_URL no configurado" };
  }
  if (!WP_PROXY_SECRET) {
    return { ok: false, error: "WP_PROXY_SECRET no configurado" };
  }

  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${WP_PROXY_SECRET}`,
  };
  if (opts.taskId) headers["X-Task-Id"] = opts.taskId;

  try {
    const res = await fetch(`${CEREBRO_BASE}/api/wp-plugin/proxy`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        clienteId,
        endpoint,
        method,
        ...(opts.body !== undefined ? { body: opts.body } : {}),
      }),
      signal: AbortSignal.timeout(35_000), // 5 s más que el timeout del proxy (30 s)
    });

    // El proxy siempre devuelve 200 con ok:false en errores de aplicación,
    // pero puede devolver 401/403/502 en errores de red o auth.
    if (res.status === 401) {
      return { ok: false, error: "WP_PROXY_SECRET inválido o M2M auth no habilitado en el proxy" };
    }
    if (res.status === 403) {
      return { ok: false, error: `endpoint-blocked: ${method} ${endpoint} no está en la allowlist del proxy` };
    }

    let payload: { ok: boolean; status?: number; data?: unknown; error?: string };
    try {
      payload = await res.json() as typeof payload;
    } catch {
      return { ok: false, error: `respuesta no-JSON del proxy (HTTP ${res.status})` };
    }

    if (!payload.ok) {
      return { ok: false, error: payload.error ?? `proxy error HTTP ${payload.status ?? res.status}` };
    }

    return { ok: true, data: payload.data };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    // No loguear secretos ni URLs con keys — solo el mensaje de error.
    return { ok: false, error: `conexión fallida: ${msg}` };
  }
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Obtiene las capacidades del plugin WP para un cliente.
 * Cacheado 24 h en Redis para no golpear el proxy en cada descomposición.
 *
 * clienteId = cerebroClientId del cliente (= Notion page ID sin dashes).
 * taskId    = PlanTask.id (opcional, para audit log en el proxy).
 */
export async function getWpCapabilities(
  clienteId: string,
  taskId?: string
): Promise<WpProxyResult<WpCapabilities>> {
  const cacheKey = `wp:caps:${clienteId}`;

  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    try {
      const data = JSON.parse(cached) as WpCapabilities;
      return { ok: true, data, fromCache: true };
    } catch {
      // cache corrupto — continuar y refrescar
    }
  }

  const result = await proxyCall(clienteId, "/capabilities", { taskId });
  if (!result.ok) {
    console.warn(`[wp-proxy] getCapabilities cliente=${clienteId}: ${result.error}`);
    return result;
  }

  const caps = result.data as WpCapabilities;
  await redis.setex(cacheKey, CAPABILITIES_TTL_SECONDS, JSON.stringify(caps)).catch(() => {});
  return { ok: true, data: caps };
}

/**
 * Obtiene el árbol de páginas del sitio WP.
 */
export async function getWpPages(
  clienteId: string,
  taskId?: string
): Promise<WpProxyResult<WpPage[]>> {
  const result = await proxyCall(clienteId, "/pages", { taskId });
  if (!result.ok) {
    console.warn(`[wp-proxy] getPages cliente=${clienteId}: ${result.error}`);
    return result;
  }
  return { ok: true, data: result.data as WpPage[] };
}

/**
 * Obtiene el árbol simplificado de una página Elementor.
 * Útil en pasos HUMAN: localiza el widget exacto (sección > columna > widget)
 * con el texto/alt actual listo para mostrar al equipo.
 */
export async function getWpElementorPage(
  clienteId: string,
  pageId: number,
  taskId?: string
): Promise<WpProxyResult<WpElementorPage>> {
  const result = await proxyCall(clienteId, `/elementor/${pageId}`, { taskId });
  if (!result.ok) {
    console.warn(`[wp-proxy] getElementorPage cliente=${clienteId} page=${pageId}: ${result.error}`);
    return result;
  }
  return { ok: true, data: result.data as WpElementorPage };
}

// ─── Write API (v1.5.0) ───────────────────────────────────────────────────────

export interface WpPublishResult {
  post_id: number;
  draft_url?: string;
  edit_url?: string;
  status?: string;
}

export interface WpSeoResult {
  success: boolean;
  page_id: number;
}

export interface WpUpdateResult {
  success: boolean;
  post_id: number;
  /** URL pública del post tras cambiar status a "publish" */
  link?: string;
}

/**
 * Crea un nuevo artículo de blog como borrador.
 * Plugin v1.5.0: POST /wp-json/clicksociety/v1/publish
 * Siempre crea como status="draft" — se publica desde WP Admin o "Publicar Plan".
 */
export async function publishWpPost(
  clienteId: string,
  post: {
    title: string;
    content: string;
    status?: "draft" | "publish";
    slug?: string;
    categories?: string[];
    focus_keyword?: string;
  },
  taskId?: string
): Promise<WpProxyResult<WpPublishResult>> {
  const result = await proxyCall(clienteId, "/publish", {
    method: "POST",
    body: { ...post, status: post.status ?? "draft" },
    taskId,
  });
  if (!result.ok) {
    console.warn(`[wp-proxy] publishPost cliente=${clienteId}: ${result.error}`);
    return result;
  }
  return { ok: true, data: result.data as WpPublishResult };
}

/**
 * Actualiza meta title, meta description y focus keyword de una página/post via Yoast SEO.
 * Plugin v1.5.0: POST /wp-json/clicksociety/v1/seo/{id}
 */
export async function updateWpSeo(
  clienteId: string,
  pageId: number,
  meta: {
    meta_title?: string;
    meta_description?: string;
    focus_keyword?: string;
  },
  taskId?: string
): Promise<WpProxyResult<WpSeoResult>> {
  const result = await proxyCall(clienteId, `/seo/${pageId}`, {
    method: "POST",
    body: meta,
    taskId,
  });
  if (!result.ok) {
    console.warn(`[wp-proxy] updateSeo cliente=${clienteId} page=${pageId}: ${result.error}`);
    return result;
  }
  return { ok: true, data: result.data as WpSeoResult };
}

// ─── Media Upload (image with alt text) ──────────────────────────────────────

export interface WpMediaResult {
  id: number;
  source_url: string;
  title?: string;
  alt_text?: string;
}

/**
 * Sube una imagen al media library de WP via el proxy de Cerebro web.
 * Plugin v1.5.0: POST /wp-json/clicksociety/v1/media
 *
 * El proxy acepta el body como JSON con la imagen en base64.
 * El plugin la decodifica y la sube a wp-content/uploads.
 */
export async function uploadWpMedia(
  clienteId: string,
  media: {
    filename: string;
    base64Data: string;
    alt_text: string;
    mime_type?: string;
  },
  taskId?: string,
): Promise<WpProxyResult<WpMediaResult>> {
  const result = await proxyCall(clienteId, "/media", {
    method: "POST",
    body: {
      filename: media.filename,
      data: media.base64Data,
      alt_text: media.alt_text,
      mime_type: media.mime_type ?? "image/webp",
    },
    taskId,
  });
  if (!result.ok) {
    console.warn(`[wp-proxy] uploadMedia cliente=${clienteId}: ${result.error}`);
    return result;
  }
  return { ok: true, data: result.data as WpMediaResult };
}

/**
 * Edita título, contenido, status y/o imagen destacada de un post.
 * Plugin v1.6.0: PUT /wp-json/clicksociety/v1/update/{id}
 * Para posts Elementor usa Document API en lugar de wp_update_post().
 * Requiere taskId (audit log).
 */
export async function updateWpPost(
  clienteId: string,
  postId: number,
  update: {
    title?: string;
    content?: string;
    status?: "publish" | "draft" | "private";
    featured_image_id?: number;
  },
  taskId?: string
): Promise<WpProxyResult<WpUpdateResult>> {
  const result = await proxyCall(clienteId, `/update/${postId}`, {
    method: "PUT",
    body: update,
    taskId,
  });
  if (!result.ok) {
    console.warn(`[wp-proxy] updatePost cliente=${clienteId} post=${postId}: ${result.error}`);
    return result;
  }
  return { ok: true, data: result.data as WpUpdateResult };
}

// ─── Write API v1.6.0 — Elementor ────────────────────────────────────────────

/**
 * POST /elementor/duplicate/{pageId}
 * Copia una página como borrador Elementor listo para edición.
 * Devuelve draft_id + árbol simplificado de widgets.
 * Requiere taskId.
 */
export async function duplicateWpElementorPage(
  clienteId: string,
  pageId: number,
  taskId: string
): Promise<WpProxyResult<WpElementorDraft>> {
  const result = await proxyCall(clienteId, `/elementor/duplicate/${pageId}`, {
    method: "POST",
    taskId,
  });
  if (!result.ok) {
    console.warn(`[wp-proxy] duplicatePage cliente=${clienteId} page=${pageId}: ${result.error}`);
    return result;
  }
  return { ok: true, data: result.data as WpElementorDraft };
}

/**
 * PATCH /elementor/{draftId}/widgets
 * Actualiza en lote texto, headings, imágenes y botones de un borrador.
 * Requiere taskId.
 */
export async function updateWpElementorWidgets(
  clienteId: string,
  draftId: number,
  widgets: WpWidgetUpdate[],
  taskId: string
): Promise<WpProxyResult<WpWidgetsResult>> {
  const result = await proxyCall(clienteId, `/elementor/${draftId}/widgets`, {
    method: "PATCH",
    body: { widgets },
    taskId,
  });
  if (!result.ok) {
    console.warn(`[wp-proxy] updateWidgets cliente=${clienteId} draft=${draftId}: ${result.error}`);
    return result;
  }
  return { ok: true, data: result.data as WpWidgetsResult };
}

/**
 * POST /elementor/apply/{draftId}
 * Aplica el borrador a la página original creando una revisión WP previa.
 * El borrador se elimina tras el apply. Devuelve revision_id para posible /revert.
 * Requiere taskId.
 */
export async function applyWpElementorDraft(
  clienteId: string,
  draftId: number,
  options: { original_id?: number } = {},
  taskId: string
): Promise<WpProxyResult<WpApplyResult>> {
  const result = await proxyCall(clienteId, `/elementor/apply/${draftId}`, {
    method: "POST",
    body: Object.keys(options).length > 0 ? options : undefined,
    taskId,
  });
  if (!result.ok) {
    console.warn(`[wp-proxy] applyDraft cliente=${clienteId} draft=${draftId}: ${result.error}`);
    return result;
  }
  return { ok: true, data: result.data as WpApplyResult };
}

/**
 * POST /elementor/revert/{pageId}/{revisionId}
 * Restaura la página al estado previo al apply.
 * Requiere taskId.
 */
export async function revertWpElementorPage(
  clienteId: string,
  pageId: number,
  revisionId: number,
  taskId: string
): Promise<WpProxyResult<WpRevertResult>> {
  const result = await proxyCall(clienteId, `/elementor/revert/${pageId}/${revisionId}`, {
    method: "POST",
    taskId,
  });
  if (!result.ok) {
    console.warn(`[wp-proxy] revertPage cliente=${clienteId} page=${pageId} rev=${revisionId}: ${result.error}`);
    return result;
  }
  return { ok: true, data: result.data as WpRevertResult };
}

/**
 * POST /elementor/from-template
 * Clona una plantilla de la biblioteca Elementor como nuevo borrador.
 * Requiere taskId.
 */
export async function createWpDraftFromTemplate(
  clienteId: string,
  params: { template_id: number; title: string; post_type?: string },
  taskId: string
): Promise<WpProxyResult<WpElementorDraft>> {
  const result = await proxyCall(clienteId, "/elementor/from-template", {
    method: "POST",
    body: params,
    taskId,
  });
  if (!result.ok) {
    console.warn(`[wp-proxy] fromTemplate cliente=${clienteId} tmpl=${params.template_id}: ${result.error}`);
    return result;
  }
  return { ok: true, data: result.data as WpElementorDraft };
}

/**
 * POST /elementor/import
 * Importa un árbol de containers Elementor V3 (JSON) como nuevo borrador.
 * Útil para crear landings desde cero con estructura generada por AI.
 * Requiere taskId.
 */
export async function importWpElementorPage(
  clienteId: string,
  params: { title: string; elements: unknown[]; post_type?: string },
  taskId: string
): Promise<WpProxyResult<WpElementorDraft>> {
  const result = await proxyCall(clienteId, "/elementor/import", {
    method: "POST",
    body: params,
    taskId,
  });
  if (!result.ok) {
    console.warn(`[wp-proxy] importPage cliente=${clienteId}: ${result.error}`);
    return result;
  }
  return { ok: true, data: result.data as WpElementorDraft };
}

// ─── Read API v1.6.0 ─────────────────────────────────────────────────────────

/**
 * GET /kit — colores globales y tipografía del Elementor Kit activo.
 * v1.6.0+
 */
export async function getWpKit(
  clienteId: string,
  taskId?: string
): Promise<WpProxyResult<WpKit>> {
  const result = await proxyCall(clienteId, "/kit", { taskId });
  if (!result.ok) {
    console.warn(`[wp-proxy] getKit cliente=${clienteId}: ${result.error}`);
    return result;
  }
  return { ok: true, data: result.data as WpKit };
}

/**
 * GET /forms/submissions — conteo de envíos Elementor Pro (sin PII).
 * v1.6.0+. Retorna ok=true con submissions=[] si Elementor Pro no está activo.
 */
export async function getWpFormsSubmissions(
  clienteId: string,
  taskId?: string
): Promise<WpProxyResult<WpFormsSubmissionsResult>> {
  const result = await proxyCall(clienteId, "/forms/submissions", { taskId });
  if (!result.ok) {
    console.warn(`[wp-proxy] getFormsSubmissions cliente=${clienteId}: ${result.error}`);
    return result;
  }
  return { ok: true, data: result.data as WpFormsSubmissionsResult };
}
