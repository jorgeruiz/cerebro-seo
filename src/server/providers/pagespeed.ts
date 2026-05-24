/**
 * Google PageSpeed Insights API v5 provider.
 *
 * Gratis hasta 25k requests/day. No requiere OAuth — solo API key.
 * Timeout recomendado: 60s (el análisis tarda 10-30s).
 *
 * Docs: https://developers.google.com/speed/docs/insights/v5/get-started
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PageSpeedCwv {
  lcp?: number;   // Largest Contentful Paint (ms)
  fcp?: number;   // First Contentful Paint (ms)
  cls?: number;   // Cumulative Layout Shift (unitless)
  inp?: number;   // Interaction to Next Paint (ms)
  ttfb?: number;  // Time to First Byte (ms)
  si?: number;    // Speed Index (ms)
  tbt?: number;   // Total Blocking Time (ms)
}

export interface PageSpeedScores {
  performance: number;    // 0-100
  accessibility: number;  // 0-100
  bestPractices: number;  // 0-100
  seo: number;            // 0-100
}

export interface PageSpeedResult {
  url: string;
  strategy: "mobile" | "desktop";
  scores: PageSpeedScores;
  cwv: PageSpeedCwv;
  /** Oportunidades de mejora clave del lighthouse report */
  opportunities: Array<{
    id: string;
    title: string;
    description: string;
    score: number | null;
    displayValue?: string;
  }>;
  fetchedAt: Date;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface LighthouseResult {
  categories: {
    performance?: { score: number | null };
    accessibility?: { score: number | null };
    "best-practices"?: { score: number | null };
    seo?: { score: number | null };
  };
  audits: Record<
    string,
    {
      id: string;
      title: string;
      description: string;
      score: number | null;
      displayValue?: string;
      details?: unknown;
    }
  >;
}

interface PsiResponse {
  id: string;
  lighthouseResult: LighthouseResult;
  loadingExperience?: {
    metrics?: Record<string, { percentile?: number; category?: string }>;
  };
}

// ─── Provider ────────────────────────────────────────────────────────────────

const PSI_BASE = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/** Normaliza score de 0-1 a 0-100 */
function toScore(raw: number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  return Math.round(raw * 100);
}

/**
 * Auditorías que se extraen como oportunidades de mejora.
 * Se filtran las que tienen score < 0.9 (hay margen de mejora).
 */
const OPPORTUNITY_AUDITS = [
  "render-blocking-resources",
  "unused-css-rules",
  "unused-javascript",
  "uses-optimized-images",
  "uses-webp-images",
  "uses-text-compression",
  "uses-responsive-images",
  "efficient-animated-content",
  "reduce-unused-javascript",
  "largest-contentful-paint-element",
  "total-blocking-time",
  "cumulative-layout-shift",
  "first-contentful-paint",
  "speed-index",
  "interactive",
];

/**
 * Llama a PageSpeed Insights y retorna scores + CWV + oportunidades.
 *
 * @throws si la API falla o el timeout se supera (60s)
 */
export async function runPageSpeed(
  url: string,
  strategy: "mobile" | "desktop" = "mobile"
): Promise<PageSpeedResult> {
  const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY;

  const params = new URLSearchParams({
    url,
    strategy,
    category: "performance",
    ...(apiKey ? { key: apiKey } : {}),
  });

  // Añadir categorías adicionales
  ["accessibility", "best-practices", "seo"].forEach((cat) => {
    params.append("category", cat);
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  let psi: PsiResponse;
  try {
    const res = await fetch(`${PSI_BASE}?${params.toString()}`, {
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`PageSpeed API HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    psi = (await res.json()) as PsiResponse;
  } finally {
    clearTimeout(timeout);
  }

  const lhr = psi.lighthouseResult;
  const audits = lhr.audits ?? {};

  // ── Scores ─────────────────────────────────────────────────────────────────

  const scores: PageSpeedScores = {
    performance: toScore(lhr.categories.performance?.score),
    accessibility: toScore(lhr.categories.accessibility?.score),
    bestPractices: toScore(lhr.categories["best-practices"]?.score),
    seo: toScore(lhr.categories.seo?.score),
  };

  // ── CWV from lighthouse audits ─────────────────────────────────────────────

  const cwv: PageSpeedCwv = {
    lcp: numericValue(audits["largest-contentful-paint"]),
    fcp: numericValue(audits["first-contentful-paint"]),
    cls: numericValue(audits["cumulative-layout-shift"]),
    tbt: numericValue(audits["total-blocking-time"]),
    si: numericValue(audits["speed-index"]),
    ttfb: numericValue(audits["server-response-time"]),
  };

  // Override CWV with field data if available (loadingExperience)
  const fieldMetrics = psi.loadingExperience?.metrics;
  if (fieldMetrics) {
    if (fieldMetrics["LARGEST_CONTENTFUL_PAINT_MS"]?.percentile !== undefined) {
      cwv.lcp = fieldMetrics["LARGEST_CONTENTFUL_PAINT_MS"].percentile;
    }
    if (fieldMetrics["INTERACTION_TO_NEXT_PAINT"]?.percentile !== undefined) {
      cwv.inp = fieldMetrics["INTERACTION_TO_NEXT_PAINT"].percentile;
    }
    if (fieldMetrics["CUMULATIVE_LAYOUT_SHIFT_SCORE"]?.percentile !== undefined) {
      // Field CLS is stored as percentile * 100
      cwv.cls = (fieldMetrics["CUMULATIVE_LAYOUT_SHIFT_SCORE"].percentile ?? 0) / 100;
    }
  }

  // ── Oportunidades ──────────────────────────────────────────────────────────

  const opportunities = OPPORTUNITY_AUDITS
    .map((id) => audits[id])
    .filter((a) => a !== undefined && (a.score ?? 1) < 0.9)
    .map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description.split(".")[0] + ".", // primera oración
      score: a.score,
      displayValue: a.displayValue,
    }))
    .slice(0, 10); // top 10

  return {
    url,
    strategy,
    scores,
    cwv,
    opportunities,
    fetchedAt: new Date(),
  };
}

function numericValue(
  audit: { displayValue?: string } | undefined
): number | undefined {
  if (!audit?.displayValue) return undefined;
  // displayValue suele ser "1.2 s" o "0.1"
  const match = audit.displayValue.match(/[\d.]+/);
  if (!match) return undefined;
  const val = parseFloat(match[0]);
  // Convertir segundos → ms si aplica
  if (audit.displayValue.includes(" s")) return Math.round(val * 1000);
  return val;
}
