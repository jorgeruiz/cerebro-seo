/**
 * SEO Opportunities — detección algorítmica de oportunidades de mejora.
 *
 * Cruza datos de GSC (queries + pages) con rankings y keywords de la BD
 * para identificar 5 tipos de oportunidades accionables:
 *
 *   1. Quick wins       — pos 4-10 con buenas impresiones (a un paso del top 3)
 *   2. CTR bajo         — pos 1-3 pero CTR << esperado (problema de título/meta)
 *   3. Sin cobertura    — keywords prioritarias sin visibilidad en GSC
 *   4. Posición pobre   — muchas impresiones pero posición > 20 (página 2+)
 *   5. CTR bajo por URL — páginas con muchas impresiones pero CTR < 2%
 *
 * No hace llamadas a APIs externas — usa datos que ya vienen del caller.
 */

import type { GscQueryRow, GscPageRow } from "@/server/providers/google-search-console";

// ─── Tipos públicos ────────────────────────────────────────────────────────

export type OpportunityType =
  | "quick-win"
  | "ctr-issue-query"
  | "no-coverage"
  | "poor-position"
  | "ctr-issue-page";

export type OpportunityPriority = "alta" | "media" | "baja";

export interface SeoOpportunity {
  type: OpportunityType;
  priority: OpportunityPriority;
  // Para query-level
  keyword?: string;
  position?: number;
  impressions?: number;
  clicks?: number;
  ctr?: number;
  // Para page-level
  url?: string;
  // Descripción y acción
  label: string;       // texto corto del problema (ej: "Posición #6 con 890 impresiones")
  action: string;      // acción concreta a tomar
  // Score para ordenar (mayor = más prioritario)
  score: number;
}

// ─── CTR esperado por posición (benchmarks promedio de industria) ──────────

const EXPECTED_CTR: Record<number, number> = {
  1: 28.5,
  2: 15.7,
  3: 11.0,
};

function expectedCtrForPosition(pos: number): number {
  if (pos <= 1) return EXPECTED_CTR[1];
  if (pos <= 2) return EXPECTED_CTR[2];
  if (pos <= 3) return EXPECTED_CTR[3];
  return 0;
}

// ─── Formatters ────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  return n.toLocaleString("es-MX");
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

// ─── Detección de oportunidades ────────────────────────────────────────────

/**
 * 1. Quick wins — keywords en posición 4-10 con ≥50 impresiones.
 *    Subir al top 3 puede 2-3x los clics.
 */
export function detectQuickWins(queries: GscQueryRow[]): SeoOpportunity[] {
  return queries
    .filter((q) => q.position >= 4 && q.position <= 10 && q.impressions >= 50)
    .map((q) => {
      const gap = 10 - q.position; // más alto = más cerca del top3
      const score = (gap * 2 + 1) * q.impressions;
      const estimatedGain = Math.round(q.impressions * 0.1); // ~10% CTR en pos3
      return {
        type: "quick-win" as const,
        priority: (q.impressions >= 500 ? "alta" : q.impressions >= 150 ? "media" : "baja") as OpportunityPriority,
        keyword: q.query,
        position: q.position,
        impressions: q.impressions,
        clicks: q.clicks,
        ctr: q.ctr,
        label: `Posición #${Math.round(q.position)} · ${fmtNum(q.impressions)} impresiones · ${fmtPct(q.ctr)} CTR`,
        action: `Optimiza el H1, meta title y contenido de la página que rankea para capturar ~${fmtNum(estimatedGain)} clics adicionales/mes si llegas a top 3.`,
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
}

/**
 * 2. CTR bajo en posición 1-3 — el título o meta description no convence.
 *    Criterio: CTR < 60% del benchmark de esa posición.
 */
export function detectLowCtrQueries(queries: GscQueryRow[]): SeoOpportunity[] {
  return queries
    .filter((q) => {
      const posInt = Math.round(q.position);
      if (posInt > 3 || q.impressions < 30) return false;
      const expected = expectedCtrForPosition(posInt);
      return q.ctr < expected * 0.6;
    })
    .map((q) => {
      const posInt = Math.round(q.position);
      const expected = expectedCtrForPosition(posInt);
      const gap = expected - q.ctr;
      const potentialClicks = Math.round((gap / 100) * q.impressions);
      return {
        type: "ctr-issue-query" as const,
        priority: (q.impressions >= 200 ? "alta" : "media") as OpportunityPriority,
        keyword: q.query,
        position: q.position,
        impressions: q.impressions,
        clicks: q.clicks,
        ctr: q.ctr,
        label: `Posición #${posInt} pero CTR de ${fmtPct(q.ctr)} (esperado ~${fmtPct(expected)})`,
        action: `Reescribe el meta title y meta description para esta keyword. Un CTR normal generaría ~${fmtNum(potentialClicks)} clics adicionales/mes.`,
        score: gap * q.impressions,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

/**
 * 3. Sin cobertura — keywords prioritarias que no aparecen en GSC
 *    o tienen posición > 50.
 */
export function detectNoCoverage(
  priorityKeywords: string[],
  queries: GscQueryRow[]
): SeoOpportunity[] {
  // Construir mapa rápido de queries GSC (lowercase)
  const gscMap = new Map<string, GscQueryRow>();
  for (const q of queries) {
    gscMap.set(q.query.toLowerCase(), q);
  }

  const results: SeoOpportunity[] = [];

  for (const kw of priorityKeywords) {
    const kwLower = kw.toLowerCase();
    const gscRow = gscMap.get(kwLower);

    // No aparece en GSC O aparece pero muy abajo
    if (!gscRow || gscRow.position > 50) {
      const hasWeakPresence = gscRow && gscRow.position > 50;
      results.push({
        type: "no-coverage" as const,
        priority: "alta",
        keyword: kw,
        position: gscRow?.position,
        impressions: gscRow?.impressions ?? 0,
        label: hasWeakPresence
          ? `Keyword prioritaria en posición #${Math.round(gscRow!.position)} — fuera de top 50`
          : "Keyword prioritaria sin visibilidad en Google",
        action: `Crea o refuerza una landing page dedicada a "${kw}". Sin contenido relevante no habrá posicionamiento.`,
        score: 1000, // siempre alta prioridad
      });
    }
  }

  return results.slice(0, 10);
}

/**
 * 4. Posición pobre con muchas impresiones — Google muestra la página
 *    pero está demasiado abajo para generar tráfico.
 */
export function detectPoorPosition(queries: GscQueryRow[]): SeoOpportunity[] {
  return queries
    .filter((q) => q.position >= 21 && q.impressions >= 200)
    .map((q) => ({
      type: "poor-position" as const,
      priority: (q.impressions >= 1000 ? "alta" : q.impressions >= 500 ? "media" : "baja") as OpportunityPriority,
      keyword: q.query,
      position: q.position,
      impressions: q.impressions,
      clicks: q.clicks,
      ctr: q.ctr,
      label: `${fmtNum(q.impressions)} impresiones/mes pero en posición #${Math.round(q.position)}`,
      action: `Crea una landing page dedicada con contenido más profundo sobre "${q.query}" para competir en esta keyword de alto potencial.`,
      score: q.impressions / q.position,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

/**
 * 5. CTR bajo por URL — páginas con muchas impresiones pero CTR < 2%.
 *    Indica que el título/meta description de esa URL no es atractivo.
 */
export function detectLowCtrPages(pages: GscPageRow[]): SeoOpportunity[] {
  return pages
    .filter((p) => p.impressions >= 100 && p.ctr < 2)
    .map((p) => {
      // Extraer path de la URL para mostrar algo legible
      let path = p.page;
      try {
        path = new URL(p.page).pathname;
      } catch { /* URL malformada */ }

      const potentialClicks = Math.round((0.03 - p.ctr / 100) * p.impressions);
      return {
        type: "ctr-issue-page" as const,
        priority: (p.impressions >= 500 ? "alta" : "media") as OpportunityPriority,
        url: p.page,
        impressions: p.impressions,
        clicks: p.clicks,
        ctr: p.ctr,
        position: p.position,
        label: `${path} · ${fmtNum(p.impressions)} impresiones · CTR ${fmtPct(p.ctr)}`,
        action: `Optimiza el meta title y meta description de esta página. Llevar el CTR a 3% significaría ~${fmtNum(Math.max(0, potentialClicks))} clics adicionales/mes.`,
        score: p.impressions * (2 - p.ctr),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

// ─── Función principal ─────────────────────────────────────────────────────

export interface OpportunitiesReport {
  quickWins: SeoOpportunity[];
  ctrIssuesQuery: SeoOpportunity[];
  noCoverage: SeoOpportunity[];
  poorPosition: SeoOpportunity[];
  ctrIssuesPage: SeoOpportunity[];
  totalCount: number;
  highPriorityCount: number;
}

/**
 * Enriquece oportunidades query-level con la URL que rankea para ese keyword.
 */
function enrichWithUrls(opps: SeoOpportunity[], queryPageMap?: Map<string, string>): SeoOpportunity[] {
  if (!queryPageMap) return opps;
  return opps.map((opp) => {
    if (opp.url || !opp.keyword) return opp;
    const page = queryPageMap.get(opp.keyword);
    return page ? { ...opp, url: page } : opp;
  });
}

export function buildOpportunitiesReport(
  queries: GscQueryRow[],
  pages: GscPageRow[],
  priorityKeywords: string[],
  queryPageMap?: Map<string, string>,
): OpportunitiesReport {
  const quickWins = enrichWithUrls(detectQuickWins(queries), queryPageMap);
  const ctrIssuesQuery = enrichWithUrls(detectLowCtrQueries(queries), queryPageMap);
  const noCoverage = detectNoCoverage(priorityKeywords, queries);
  const poorPosition = enrichWithUrls(detectPoorPosition(queries), queryPageMap);
  const ctrIssuesPage = detectLowCtrPages(pages);

  const all = [...quickWins, ...ctrIssuesQuery, ...noCoverage, ...poorPosition, ...ctrIssuesPage];
  const highPriorityCount = all.filter((o) => o.priority === "alta").length;

  return {
    quickWins,
    ctrIssuesQuery,
    noCoverage,
    poorPosition,
    ctrIssuesPage,
    totalCount: all.length,
    highPriorityCount,
  };
}
