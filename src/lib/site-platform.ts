/**
 * Detección de plataforma de un sitio web en producción.
 *
 * Señales técnicas (nunca texto de la página):
 * - Next.js: __NEXT_DATA__ en HTML, /_next/ en recursos
 * - WordPress: /wp-content/ o /wp-includes/ en recursos, meta generator, /wp-json
 *
 * Combinado con Site.framework para detectar MIGRACION:
 *   framework="nextjs" + producción=WordPress → MIGRACION
 */

import type { SitePlatform } from "@prisma/client";

export interface PlatformDetectionResult {
  platform: SitePlatform;
  signals: string[];
  confidence: "high" | "medium" | "low";
}

interface DetectionSignals {
  nextjs: string[];
  wordpress: string[];
}

/**
 * Detecta la plataforma de un sitio analizando su HTML y headers.
 * Solo usa señales técnicas — nunca el texto visible de la página.
 */
export async function detectPlatform(
  siteUrl: string,
  framework?: string | null,
  githubRepo?: string | null
): Promise<PlatformDetectionResult> {
  const signals = await gatherSignals(siteUrl);

  const hasNext = signals.nextjs.length > 0;
  const hasWp = signals.wordpress.length > 0;
  const hasRepo = !!githubRepo;

  let platform: SitePlatform;
  let confidence: "high" | "medium" | "low";

  if (hasNext && !hasWp) {
    // Producción es Next.js
    if (framework === "wordpress") {
      // Raro: Notion dice WordPress pero producción es Next.js → probablemente Notion desactualizado
      platform = "NEXTJS";
      confidence = "medium";
    } else {
      platform = "NEXTJS";
      confidence = "high";
    }
  } else if (hasWp && !hasNext) {
    // Producción es WordPress
    if (framework === "nextjs" || hasRepo) {
      // framework=nextjs O tiene githubRepo (Next.js en desarrollo) pero producción=WordPress → MIGRACION
      platform = "MIGRACION";
      confidence = "high";
    } else {
      platform = "WORDPRESS";
      confidence = "high";
    }
  } else if (hasNext && hasWp) {
    // Ambas señales (raro — puede ser WordPress headless con Next.js frontend)
    platform = "NEXTJS";
    confidence = "medium";
  } else {
    // Sin señales claras
    platform = "OTRO";
    confidence = "low";
  }

  return {
    platform,
    signals: [...signals.nextjs.map((s) => `next:${s}`), ...signals.wordpress.map((s) => `wp:${s}`)],
    confidence,
  };
}

async function gatherSignals(siteUrl: string): Promise<DetectionSignals> {
  const url = siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`;
  const nextjs: string[] = [];
  const wordpress: string[] = [];

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "CerebroSEO-PlatformDetector/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });

    const html = await res.text();

    // ── Next.js signals ────────────────────────────────────────────────
    if (html.includes("__NEXT_DATA__")) {
      nextjs.push("__NEXT_DATA__");
    }
    if (html.includes("/_next/")) {
      nextjs.push("/_next/");
    }
    if (html.includes("next/dist")) {
      nextjs.push("next/dist");
    }

    // ── WordPress signals (solo tags técnicos, nunca texto) ───────────
    if (html.includes("/wp-content/")) {
      wordpress.push("/wp-content/");
    }
    if (html.includes("/wp-includes/")) {
      wordpress.push("/wp-includes/");
    }
    // Meta generator tag
    const generatorMatch = html.match(/<meta[^>]*name=["']generator["'][^>]*content=["']([^"']*wordpress[^"']*)["']/i);
    if (generatorMatch) {
      wordpress.push(`generator:${generatorMatch[1]}`);
    }

    // ── Check /wp-json endpoint ──────────────────────────────────────
    try {
      const wpJsonRes = await fetch(`${url}/wp-json`, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(5_000),
      });
      if (wpJsonRes.ok || wpJsonRes.status === 401) {
        wordpress.push("/wp-json");
      }
    } catch {
      // Not WordPress or endpoint blocked
    }
  } catch (err) {
    console.warn(`[site-platform] Failed to fetch ${url}:`, err instanceof Error ? err.message : err);
  }

  return { nextjs, wordpress };
}

/**
 * Fuente única de plataforma de un sitio.
 * Usar esta función — nunca leer site.platform directamente en lógica de negocio.
 * site.framework se ignora para decisiones de modo (es dato declarativo de Notion, puede estar desactualizado).
 */
export function getSitePlatform(site: { platform: SitePlatform | null }): SitePlatform {
  return site.platform ?? "OTRO";
}

/**
 * Determina si un sitio es elegible para ejecución de tareas IA vía repo (Next.js).
 * @deprecated Use getPlatformPolicy(platform).needsRepo instead.
 */
export function isEligibleForExecution(platform: SitePlatform | null): boolean {
  return platform === "NEXTJS";
}

/**
 * Determina si un sitio es elegible para ejecución de tareas IA vía plugin WP.
 * @deprecated Use getPlatformPolicy(platform).executable instead.
 */
export function isEligibleForWpExecution(platform: SitePlatform | null): boolean {
  return platform === "WORDPRESS" || platform === "MIGRACION";
}

/**
 * Motivo de restricción por plataforma, o null si no hay restricción.
 * @deprecated Use getPlatformPolicy(platform).ineligibilityReason instead.
 */
export function ineligibilityReason(platform: SitePlatform | null): string | null {
  if (platform === "NEXTJS") return null;
  if (platform === "WORDPRESS") return null;
  if (platform === "MIGRACION") return "Sitio en migración — producción aún en WordPress. Tareas AI usan el plugin WP.";
  if (platform === "OTRO") return "Plataforma no reconocida — el Plan mensual requiere Next.js o WordPress.";
  return "Plataforma no detectada — ejecuta la detección de plataforma primero.";
}
