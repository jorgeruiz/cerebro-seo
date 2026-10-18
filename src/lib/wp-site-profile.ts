/**
 * Perfil de sitio WordPress.
 *
 * Antes de generar contenido de blog, el generador necesita saber que servicios
 * y productos ofrece el cliente (para no inventar datos).
 *
 * Fuentes:
 *   /pages — arbol de paginas del sitio
 *   /elementor/{id} — contenido de hasta 8 paginas priorizadas
 *
 * Prioridad de paginas:
 *   1. Home (slug="" o "home", titulo "inicio/home")
 *   2. Servicios / Productos (slug o titulo contiene esas palabras)
 *   3. Nosotros / Acerca / About / Empresa
 *   4. Resto de paginas
 *
 * Cache: Redis 7 dias (la estructura del sitio cambia pocas veces al mes).
 */

import { redis } from "@/lib/redis";
import { getWpPages, getWpElementorPage } from "@/lib/wp-proxy-client";
import type { WpPage } from "@/lib/wp-proxy-client";

const PROFILE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 dias
const MAX_PROFILE_PAGES = 8;
const MAX_WIDGET_CHARS = 200;
const MAX_SUMMARY_CHARS = 5000;

// --- Tipos -------------------------------------------------------------------

export interface WpSiteProfile {
  clientName: string;
  siteUrl: string;
  /** Todas las paginas del sitio con title y slug */
  pages: Array<{ title: string; slug: string }>;
  /**
   * Texto extraido de hasta 8 paginas priorizadas (home + servicios/productos).
   * Max 5000 caracteres — contexto real para Claude.
   */
  contentSummary: string;
  /**
   * true si se pudo extraer suficiente contenido (>200 chars).
   * false — el generador debe usar [COMPLETAR] agresivamente.
   */
  hasContent: boolean;
  /** ISO timestamp de cuando se construyo el perfil */
  buildAt: string;
}

// --- Prioridad de paginas ----------------------------------------------------

const HOME_PATTERNS = [/^$/, /^home$/, /^inicio$/];
const SERVICE_PATTERNS = [/servicio/, /producto/, /service/, /product/, /solucio/, /catalogo/, /catalog/];
const ABOUT_PATTERNS = [/nosotros/, /acerca/, /about/, /empresa/, /quienes/];

function pageScore(page: WpPage): number {
  const slug = page.slug.toLowerCase();
  const title = page.title.toLowerCase();
  if (HOME_PATTERNS.some((p) => p.test(slug) || p.test(title))) return 100;
  if (SERVICE_PATTERNS.some((p) => p.test(slug) || p.test(title))) return 80;
  if (ABOUT_PATTERNS.some((p) => p.test(slug) || p.test(title))) return 60;
  return 20;
}

// --- Builder -----------------------------------------------------------------

/**
 * Obtiene o construye el perfil del sitio WP.
 * Devuelve null si el proxy falla — el generador de blog continua con restricciones maximas.
 */
export async function getWpSiteProfile(
  cerebroClientId: string,
  clientName: string,
  siteUrl: string,
  taskId?: string,
): Promise<WpSiteProfile | null> {
  const cacheKey = `wp:profile:${cerebroClientId}`;

  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached) as WpSiteProfile;
    } catch {
      // cache corrupto — reconstruir
    }
  }

  const pagesResult = await getWpPages(cerebroClientId, taskId);
  if (!pagesResult.ok) {
    console.warn(`[wp-profile] getPages failed cliente=${cerebroClientId}: ${pagesResult.error}`);
    return null;
  }

  const allPages = pagesResult.data;
  const pages = allPages.map((p) => ({ title: p.title, slug: p.slug }));

  // Seleccionar paginas por prioridad
  const ranked = [...allPages].sort((a, b) => pageScore(b) - pageScore(a));
  const topPages = ranked.slice(0, MAX_PROFILE_PAGES);

  // Extraer contenido Elementor
  const textChunks: string[] = [];
  for (const page of topPages) {
    const elResult = await getWpElementorPage(cerebroClientId, page.id, taskId);
    if (!elResult.ok) continue;

    const pageLines: string[] = [`=== ${page.title} ===`];
    for (const section of elResult.data.sections) {
      for (const widget of section.widgets) {
        if (widget.text && widget.text.trim().length > 10) {
          const clean = widget.text.trim().replace(/\s+/g, " ").slice(0, MAX_WIDGET_CHARS);
          pageLines.push(clean);
        }
      }
    }
    if (pageLines.length > 1) textChunks.push(pageLines.join("\n"));
  }

  const contentSummary = textChunks.join("\n\n").slice(0, MAX_SUMMARY_CHARS);
  const hasContent = contentSummary.length > 200;

  const profile: WpSiteProfile = {
    clientName,
    siteUrl,
    pages,
    contentSummary,
    hasContent,
    buildAt: new Date().toISOString(),
  };

  await redis.setex(cacheKey, PROFILE_TTL_SECONDS, JSON.stringify(profile)).catch(() => {});
  console.log(
    `[wp-profile] Perfil construido cliente=${cerebroClientId} total=${pages.length} ` +
    `top=${topPages.length} hasContent=${hasContent}`,
  );
  return profile;
}

/**
 * Invalida el perfil cacheado (ej: despues de publicar nuevo contenido en el sitio).
 */
export async function invalidateWpSiteProfile(cerebroClientId: string): Promise<void> {
  await redis.del(`wp:profile:${cerebroClientId}`).catch(() => {});
}
