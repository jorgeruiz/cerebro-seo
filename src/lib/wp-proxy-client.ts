/**
 * Cliente para el proxy WP plugin de Cerebro web.
 *
 * Cerebro SEO NUNCA almacena credenciales de WordPress.
 * Las keys del plugin viven en Cerebro web (WpSiteCredential, AES-256-GCM).
 * Cerebro SEO accede al plugin WP únicamente a través de este proxy,
 * autenticando con SEO_INTERNAL_SECRET (bearer token M2M).
 *
 * ─── REQUISITO EN CEREBRO WEB ────────────────────────────────────────────────
 * El proxy actualmente usa getServerSession (NextAuth). Para llamadas M2M desde
 * el worker de Cerebro SEO (sin sesión de usuario), el proxy debe aceptar:
 *   Authorization: Bearer ${SEO_INTERNAL_SECRET}
 * como alternativa a la sesión. Hasta que se implemente, todas las funciones
 * retornan error "auth-m2m-not-supported" y el decomposer usa catálogo estático.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Contrato del proxy (app/api/wp-plugin/proxy/route.ts en Cerebro web):
 *   POST {CEREBRO_API_URL}/api/wp-plugin/proxy
 *   Authorization: Bearer {SEO_INTERNAL_SECRET}
 *   Body: { clienteId: string, endpoint: string, method?: "GET"|"POST", body?: object }
 *   Response: { ok: true, status: number, data: unknown }
 *           | { ok: false, error: string, status?: number }
 *
 * Plugin WP namespace (desde v1.5.0): /wp-json/clicksociety/v1/
 *
 * Allowlist activa en el proxy:
 *   GET:  /ping, /categories, /system-info, /capabilities, /pages, /templates,
 *         /seo/{id}, /elementor/{id}
 *   POST: /publish, /media, /seo/{id}
 *   PUT:  /update/{id}
 */

import { redis } from "@/lib/redis";

const CEREBRO_BASE = (process.env.CEREBRO_API_URL ?? "").replace(/\/$/, "");
const SEO_SECRET = process.env.SEO_INTERNAL_SECRET ?? "";

const CAPABILITIES_TTL_SECONDS = 24 * 60 * 60; // 24 h

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface WpCapabilities {
  /** Endpoints activos en el plugin (sin slash inicial). Ej: ["publish","update","media","seo","pages","elementor","capabilities"] */
  endpoints: string[];
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

/** Resultado tipado: o bien los datos, o bien un error con razón (sin secretos). */
export type WpProxyResult<T> =
  | { ok: true; data: T; fromCache?: boolean }
  | { ok: false; error: string };

// ─── Proxy call ──────────────────────────────────────────────────────────────

interface ProxyOptions {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
}

async function proxyCall(
  clienteId: string,
  endpoint: string,
  opts: ProxyOptions = {}
): Promise<WpProxyResult<unknown>> {
  if (!CEREBRO_BASE) {
    return { ok: false, error: "CEREBRO_API_URL no configurado" };
  }
  if (!SEO_SECRET) {
    return { ok: false, error: "SEO_INTERNAL_SECRET no configurado" };
  }

  const method = opts.method ?? "GET";

  try {
    const res = await fetch(`${CEREBRO_BASE}/api/wp-plugin/proxy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SEO_SECRET}`,
      },
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
      return {
        ok: false,
        error: "auth-m2m-not-supported: el proxy requiere M2M bearer token (ver requisito en wp-proxy-client.ts)",
      };
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
 * clienteId = cerebroClientId del cliente en Cerebro SEO (= Notion page ID sin dashes).
 */
export async function getWpCapabilities(
  clienteId: string
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

  const result = await proxyCall(clienteId, "/capabilities");
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
  clienteId: string
): Promise<WpProxyResult<WpPage[]>> {
  const result = await proxyCall(clienteId, "/pages");
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
  pageId: number
): Promise<WpProxyResult<WpElementorPage>> {
  const result = await proxyCall(clienteId, `/elementor/${pageId}`);
  if (!result.ok) {
    console.warn(`[wp-proxy] getElementorPage cliente=${clienteId} page=${pageId}: ${result.error}`);
    return result;
  }
  return { ok: true, data: result.data as WpElementorPage };
}
