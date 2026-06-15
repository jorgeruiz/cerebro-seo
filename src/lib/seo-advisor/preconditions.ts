import { prisma } from "@/lib/db";
import type { NextStep } from "./types";

export interface PreconditionResult {
  setupSteps: NextStep[];
  hasKeywords: boolean;
  hasCompetitors: boolean;
  hasRankingData: boolean;
  hasSiteAudit: boolean;
  isDataSufficient: boolean; // true si Claude debe ejecutarse
}

/**
 * Capa determinística: verifica precondiciones de configuración SEO.
 * Cada precondición faltante genera un NextStep de categoría "setup"
 * sin llamar a Claude.
 */
export async function checkPreconditions(clientId: string): Promise<PreconditionResult> {
  const [
    keywordCount,
    priorityKeywordCount,
    competitorCount,
    latestRanking,
    latestAudit,
    site,
  ] = await Promise.all([
    prisma.keyword.count({ where: { clientId, deletedAt: null } }),
    prisma.keyword.count({ where: { clientId, isPriority: true, deletedAt: null } }),
    prisma.competitor.count({ where: { clientId, deletedAt: null } }),
    prisma.keywordRanking.findFirst({
      where: { keyword: { clientId } },
      orderBy: { date: "desc" },
      select: { id: true },
    }),
    prisma.audit.findFirst({
      where: { clientId, status: "completed" },
      orderBy: { date: "desc" },
      select: { id: true },
    }),
    prisma.site.findFirst({
      where: { clientId },
      select: { gscProperty: true },
    }),
  ]);

  const hasKeywords = priorityKeywordCount > 0;
  const hasCompetitors = competitorCount >= 2;
  const hasRankingData = latestRanking !== null;
  const hasSiteAudit = latestAudit !== null;

  const setupSteps: NextStep[] = [];

  if (!hasKeywords) {
    setupSteps.push({
      titulo: "Configura keywords prioritarias para activar el tracking diario",
      descripcion:
        keywordCount === 0
          ? "No hay keywords configuradas. El tracking de posicionamiento, la detección de caídas y el análisis de gaps requieren keywords activas."
          : `Tienes ${keywordCount} keyword${keywordCount === 1 ? "" : "s"} pero ninguna marcada como prioritaria. Marca al menos 5 para activar el tracking diario.`,
      categoria: "setup",
      prioridad: 1,
      seccionDestino: "keywords",
      evidencia: `Keywords totales: ${keywordCount} | Prioritarias: ${priorityKeywordCount}`,
    });
  }

  if (!hasCompetitors) {
    setupSteps.push({
      titulo: `Agrega ${competitorCount === 0 ? "al menos 2" : "1 más"} competidor${competitorCount === 1 ? "" : "es"} para el análisis comparativo`,
      descripcion:
        competitorCount === 0
          ? "Sin competidores configurados no es posible detectar keyword gaps, comparar share of voice ni identificar oportunidades de contenido."
          : "Con 1 solo competidor el análisis de gaps es limitado. Agrega al menos uno más para resultados confiables.",
      categoria: "setup",
      prioridad: 2,
      seccionDestino: "competencia",
      evidencia: `Competidores configurados: ${competitorCount} (mínimo recomendado: 2)`,
    });
  }

  if (!site?.gscProperty) {
    setupSteps.push({
      titulo: "Conecta Google Search Console para datos reales de clics y CTR",
      descripcion:
        "Sin GSC no se pueden ver clics, impresiones, CTR real ni las consultas de búsqueda que traen tráfico. Es la fuente de datos SEO más importante.",
      categoria: "setup",
      prioridad: 2,
      seccionDestino: "configuracion",
      evidencia: "Propiedad GSC: no configurada",
    });
  }

  if (!hasSiteAudit && hasKeywords) {
    setupSteps.push({
      titulo: "Ejecuta el primer audit técnico del sitio",
      descripcion:
        "El audit identifica problemas técnicos que pueden estar limitando el posicionamiento. Se ejecuta automáticamente cada miércoles, pero puedes iniciarlo en la sección Audit.",
      categoria: "setup",
      prioridad: 3,
      seccionDestino: "audit",
      evidencia: "Audits completados: 0",
    });
  }

  // Claude se ejecuta si hay al menos keywords configuradas o un audit disponible
  const isDataSufficient = hasKeywords || hasSiteAudit;

  return {
    setupSteps,
    hasKeywords,
    hasCompetitors,
    hasRankingData,
    hasSiteAudit,
    isDataSufficient,
  };
}
