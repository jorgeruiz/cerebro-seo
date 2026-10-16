/**
 * Cliente para el proxy WP plugin de Cerebro web.
 *
 * Cerebro SEO NUNCA almacena credenciales de WordPress.
 * Las keys del plugin viven en Cerebro web (WpSiteCredential, cifradas).
 * Cerebro SEO accede al plugin WP únicamente a través de este proxy,
 * autenticando con CEREBRO_INTERNAL_SECRET.
 *
 * Endpoint proxy (pendiente de implementar en Cerebro web):
 *   POST {CEREBRO_API_URL}/api/wp-plugin/proxy
 *   Authorization: Bearer {CEREBRO_INTERNAL_SECRET}
 *   Body: { cerebroClientId: string, endpoint: string }
 *   Response: el JSON devuelto por el plugin WP
 *
 * Mientras el endpoint no exista en Cerebro web, todas las funciones retornan
 * null en silencio. El decomposer usa el catálogo estático como fallback.
 */

import { redis } from "@/lib/redis";

const CEREBRO_BASE = process.env.CEREBRO_API_URL ?? "";
const CEREBRO_SECRET = process.env.CEREBRO_INTERNAL_SECRET ?? "";

const CAPABILITIES_TTL_SECONDS = 24 * 60 * 60; // 24 h

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface WpCapabilities {
  /** Lista de endpoints activos en el plugin (sin slash inicial). Ej: ["publish","update","media","seo","pages","elementor","capabilities"] */
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

// ─── Proxy call ──────────────────────────────────────────────────────────────

async function proxyGet(cerebroClientId: string, endpoint: string): Promise<unknown | null> {
  if (!CEREBRO_BASE || !CEREBRO_SECRET) {
    // Proxy no configurado (CEREBRO_API_URL o CEREBRO_INTERNAL_SECRET ausente).
    // Silent fallback — el caller usa catálogo estático.
    return null;
  }

  try {
    const res = await fetch(`${CEREBRO_BASE}/api/wp-plugin/proxy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CEREBRO_SECRET}`,
      },
      body: JSON.stringify({ cerebroClientId, endpoint }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(
        `[wp-proxy] HTTP ${res.status} — cliente=${cerebroClientId} endpoint=${endpoint}`
      );
      return null;
    }

    return res.json() as unknown;
  } catch (err) {
    console.warn("[wp-proxy] Error de conexión:", (err as Error).message);
    return null;
  }
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Obtiene las capacidades del plugin WP para un cliente.
 * Resultado cacheado 24 h en Redis para no golpear el proxy en cada descomposición.
 *
 * Retorna null si:
 * - el proxy no está configurado
 * - el cliente no tiene WpSiteCredential en Cerebro web
 * - el plugin no responde
 */
export async function getWpCapabilities(
  cerebroClientId: string
): Promise<WpCapabilities | null> {
  const cacheKey = `wp:caps:${cerebroClientId}`;

  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached) as WpCapabilities;
    } catch {
      // cache corrupto — continuar y refrescar
    }
  }

  const data = await proxyGet(cerebroClientId, "/capabilities");
  if (!data) return null;

  const caps = data as WpCapabilities;
  await redis.setex(cacheKey, CAPABILITIES_TTL_SECONDS, JSON.stringify(caps)).catch(() => {});
  return caps;
}

/**
 * Obtiene el árbol de páginas del sitio WP.
 * Sin caché (cambia con frecuencia).
 */
export async function getWpPages(cerebroClientId: string): Promise<WpPage[] | null> {
  const data = await proxyGet(cerebroClientId, "/pages");
  return data ? (data as WpPage[]) : null;
}

/**
 * Obtiene el árbol simplificado de una página Elementor.
 * Útil en pasos HUMAN para localizar el widget exacto (sección > columna > widget)
 * con el texto/alt actual listo para mostrar al equipo.
 */
export async function getWpElementorPage(
  cerebroClientId: string,
  pageId: number
): Promise<WpElementorPage | null> {
  const data = await proxyGet(cerebroClientId, `/elementor/${pageId}`);
  return data ? (data as WpElementorPage) : null;
}
