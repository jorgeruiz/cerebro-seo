/**
 * Site crawler — analiza las páginas de un sitio web para detectar problemas SEO/técnicos.
 *
 * Usa Cheerio para parsing HTML (fetch estático).
 * No lanza Playwright/Chromium para evitar consumo de RAM en el VPS.
 *
 * Lo que analiza por página:
 *   - Title, meta description, canonical, robots meta
 *   - H1, H2, H3 headings
 *   - Links (internos rotos, nofollow, externos)
 *   - Imágenes sin alt
 *   - Redirecciones
 *   - Tiempo de respuesta (TTFB proxy)
 *   - Status codes (200, 301, 302, 404, 5xx)
 *
 * Respeta robots.txt. Límite: maxPages (default 50).
 */

import * as cheerio from "cheerio";
import pLimit from "p-limit";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PageAnalysis {
  url: string;
  statusCode: number;
  redirectUrl?: string;
  ttfbMs: number;
  title?: string;
  metaDescription?: string;
  canonical?: string;
  robotsMeta?: string;  // "index,follow" | "noindex" | etc.
  h1Count: number;
  h1Text?: string;
  h2Count: number;
  imagesWithoutAlt: number;
  internalLinks: string[];
  externalLinks: number;
  wordCount: number;
  issues: PageIssue[];
}

export interface PageIssue {
  type: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  message: string;
  data?: Record<string, unknown>;
}

export interface CrawlResult {
  siteUrl: string;
  pagesCrawled: number;
  pagesIndexable: number;
  brokenPages: number;    // 4xx/5xx
  redirectPages: number;  // 3xx
  pages: PageAnalysis[];
  robotsTxtFound: boolean;
  crawledAt: Date;
}

// ─── Crawler ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_PAGES = 50;
const DEFAULT_CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 15_000;

const USER_AGENT =
  "CerebroSEO/1.0 (+https://seo.clicksociety.mx; internal crawler)";

/**
 * Obtiene y parsea robots.txt del sitio.
 * Retorna null si no existe o falla.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchRobotsTxt(baseUrl: string): Promise<any | null> {
  try {
    const robotsUrl = new URL("/robots.txt", baseUrl).href;
    const res = await fetch(robotsUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    // robots-parser espera (url, content)
    const { default: robotsParser } = await import("robots-parser");
    return robotsParser(robotsUrl, text);
  } catch {
    return null;
  }
}

/**
 * Descarga una URL y mide TTFB.
 * Sigue redirects (fetch lo hace por defecto) y registra el URL final.
 */
async function fetchPage(url: string): Promise<{
  html: string;
  statusCode: number;
  finalUrl: string;
  ttfbMs: number;
  redirected: boolean;
}> {
  const start = Date.now();
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const ttfbMs = Date.now() - start;
  const html = res.ok ? await res.text() : "";

  return {
    html,
    statusCode: res.status,
    finalUrl: res.url,
    ttfbMs,
    redirected: res.redirected,
  };
}

/**
 * Analiza el HTML de una página y genera PageAnalysis + issues.
 */
function analyzePage(
  url: string,
  html: string,
  statusCode: number,
  finalUrl: string,
  ttfbMs: number,
  baseHost: string
): PageAnalysis {
  const issues: PageIssue[] = [];
  const redirectUrl = url !== finalUrl ? finalUrl : undefined;

  if (!html || statusCode >= 400) {
    return {
      url,
      statusCode,
      redirectUrl,
      ttfbMs,
      h1Count: 0,
      h2Count: 0,
      imagesWithoutAlt: 0,
      internalLinks: [],
      externalLinks: 0,
      wordCount: 0,
      issues: [
        {
          type: statusCode >= 500 ? "server_error" : "not_found",
          severity: "critical",
          message: `HTTP ${statusCode}: página no accesible`,
        },
      ],
    };
  }

  const $ = cheerio.load(html);

  // ── Meta ────────────────────────────────────────────────────────────────────

  const title = $("title").first().text().trim() || undefined;
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() || undefined;
  const canonical = $('link[rel="canonical"]').attr("href")?.trim() || undefined;
  const robotsMeta =
    $('meta[name="robots"]').attr("content")?.trim() || undefined;

  // ── Headings ────────────────────────────────────────────────────────────────

  const h1Elements = $("h1");
  const h1Count = h1Elements.length;
  const h1Text = h1Elements.first().text().trim() || undefined;
  const h2Count = $("h2").length;

  // ── Images ──────────────────────────────────────────────────────────────────

  let imagesWithoutAlt = 0;
  $("img").each((_, el) => {
    const alt = $(el).attr("alt");
    if (alt === undefined || alt === "") imagesWithoutAlt++;
  });

  // ── Links ───────────────────────────────────────────────────────────────────

  const internalLinks: string[] = [];
  let externalLinks = 0;

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;

    try {
      const resolved = new URL(href, url);
      if (resolved.hostname === baseHost) {
        const cleanUrl = resolved.origin + resolved.pathname;
        if (!internalLinks.includes(cleanUrl)) internalLinks.push(cleanUrl);
      } else {
        externalLinks++;
      }
    } catch {
      // URL inválida — skip
    }
  });

  // ── Word count (aproximado) ──────────────────────────────────────────────────

  $("script, style, nav, footer, header").remove();
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(" ").length : 0;

  // ── Issues ──────────────────────────────────────────────────────────────────

  if (!title) {
    issues.push({ type: "missing_title", severity: "critical", message: "Falta la etiqueta <title>" });
  } else if (title.length < 30) {
    issues.push({ type: "title_too_short", severity: "medium", message: `Title muy corto (${title.length} chars): "${title}"`, data: { length: title.length } });
  } else if (title.length > 60) {
    issues.push({ type: "title_too_long", severity: "low", message: `Title muy largo (${title.length} chars)`, data: { length: title.length } });
  }

  if (!metaDescription) {
    issues.push({ type: "missing_meta_description", severity: "high", message: "Falta meta description" });
  } else if (metaDescription.length < 70) {
    issues.push({ type: "meta_description_too_short", severity: "low", message: `Meta description corta (${metaDescription.length} chars)`, data: { length: metaDescription.length } });
  } else if (metaDescription.length > 160) {
    issues.push({ type: "meta_description_too_long", severity: "low", message: `Meta description larga (${metaDescription.length} chars)`, data: { length: metaDescription.length } });
  }

  if (h1Count === 0) {
    issues.push({ type: "missing_h1", severity: "high", message: "Falta etiqueta H1" });
  } else if (h1Count > 1) {
    issues.push({ type: "multiple_h1", severity: "medium", message: `Múltiples H1 (${h1Count})`, data: { count: h1Count } });
  }

  if (imagesWithoutAlt > 0) {
    issues.push({ type: "images_missing_alt", severity: "medium", message: `${imagesWithoutAlt} imagen(es) sin atributo alt`, data: { count: imagesWithoutAlt } });
  }

  if (robotsMeta?.includes("noindex")) {
    issues.push({ type: "noindex", severity: "critical", message: "Página con meta robots noindex — Google no la indexará" });
  }

  if (!canonical) {
    issues.push({ type: "missing_canonical", severity: "low", message: "Falta etiqueta canonical" });
  }

  if (wordCount < 300 && statusCode === 200) {
    issues.push({ type: "thin_content", severity: "medium", message: `Contenido escaso (~${wordCount} palabras)`, data: { wordCount } });
  }

  if (ttfbMs > 2000) {
    issues.push({ type: "slow_ttfb", severity: "high", message: `TTFB lento: ${ttfbMs}ms (>2s)`, data: { ttfbMs } });
  } else if (ttfbMs > 800) {
    issues.push({ type: "slow_ttfb", severity: "medium", message: `TTFB elevado: ${ttfbMs}ms (>800ms)`, data: { ttfbMs } });
  }

  return {
    url,
    statusCode,
    redirectUrl,
    ttfbMs,
    title,
    metaDescription,
    canonical,
    robotsMeta,
    h1Count,
    h1Text,
    h2Count,
    imagesWithoutAlt,
    internalLinks,
    externalLinks,
    wordCount,
    issues,
  };
}

/**
 * Crawlea un sitio y retorna el análisis completo.
 *
 * @param siteUrl - URL raíz del sitio (ej: "https://molinoazteca.mx")
 * @param maxPages - límite de páginas a crawlear (default 50)
 */
export async function crawlSite(
  siteUrl: string,
  maxPages = DEFAULT_MAX_PAGES
): Promise<CrawlResult> {
  const baseUrl = new URL(siteUrl);
  const baseHost = baseUrl.hostname;

  // ── Robots.txt ──────────────────────────────────────────────────────────────

  const robots = await fetchRobotsTxt(siteUrl);
  const robotsTxtFound = robots !== null;

  function isAllowed(url: string): boolean {
    if (!robots) return true;
    return robots.isAllowed(url, USER_AGENT) !== false;
  }

  // ── BFS crawl ───────────────────────────────────────────────────────────────

  const visited = new Set<string>();
  const queue: string[] = [siteUrl.replace(/\/$/, "")];
  const pages: PageAnalysis[] = [];
  const limit = pLimit(DEFAULT_CONCURRENCY);

  while (queue.length > 0 && pages.length < maxPages) {
    const batch = queue.splice(0, DEFAULT_CONCURRENCY);
    const toFetch = batch.filter((u) => !visited.has(u) && isAllowed(u));

    if (toFetch.length === 0) continue;
    toFetch.forEach((u) => visited.add(u));

    const results = await Promise.all(
      toFetch.map((url) =>
        limit(async () => {
          try {
            const { html, statusCode, finalUrl, ttfbMs, redirected } =
              await fetchPage(url);

            const analysis = analyzePage(url, html, statusCode, finalUrl, ttfbMs, baseHost);

            // Si redirigió, añadir URL final a la cola también
            if (redirected && finalUrl !== url) {
              const resolvedHost = new URL(finalUrl).hostname;
              if (resolvedHost === baseHost && !visited.has(finalUrl)) {
                queue.push(finalUrl);
              }
            }

            // Encolar links internos encontrados
            for (const link of analysis.internalLinks) {
              if (!visited.has(link) && !queue.includes(link) && pages.length + queue.length < maxPages * 2) {
                queue.push(link);
              }
            }

            return analysis;
          } catch (err) {
            // Timeout o error de red
            const errMsg = err instanceof Error ? err.message : String(err);
            return {
              url,
              statusCode: 0,
              ttfbMs: REQUEST_TIMEOUT_MS,
              h1Count: 0,
              h2Count: 0,
              imagesWithoutAlt: 0,
              internalLinks: [],
              externalLinks: 0,
              wordCount: 0,
              issues: [
                {
                  type: "fetch_error",
                  severity: "high" as const,
                  message: `Error al acceder a la página: ${errMsg.slice(0, 100)}`,
                },
              ],
            } satisfies PageAnalysis;
          }
        })
      )
    );

    pages.push(...results);
  }

  // ── Aggregate stats ─────────────────────────────────────────────────────────

  const pagesIndexable = pages.filter(
    (p) => p.statusCode === 200 && !p.robotsMeta?.includes("noindex")
  ).length;

  const brokenPages = pages.filter(
    (p) => p.statusCode >= 400 || p.statusCode === 0
  ).length;

  const redirectPages = pages.filter(
    (p) => p.statusCode >= 300 && p.statusCode < 400
  ).length;

  return {
    siteUrl,
    pagesCrawled: pages.length,
    pagesIndexable,
    brokenPages,
    redirectPages,
    pages,
    robotsTxtFound,
    crawledAt: new Date(),
  };
}
