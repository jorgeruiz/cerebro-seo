import { prisma } from "@/lib/db";
import { subDays, format } from "date-fns";

export interface SignalsResult {
  text: string;
  hasSignals: boolean;
}

/**
 * Recopila señales SEO determinísticas desde la BD para pasarlas a Claude.
 * El resultado se cachea 25h via Redis en advisor-processor.ts.
 */
export async function collectSignals(clientId: string): Promise<SignalsResult> {
  const now = new Date();
  const thirtyDaysAgo = subDays(now, 30);
  const sevenDaysAgo = subDays(now, 7);
  const fourteenDaysAgo = subDays(now, 14);
  const twentyEightDaysAgo = subDays(now, 28);

  const [
    lostHighAuthorityBacklinks,
    priorityKeywordsWithRankings,
    easyGaps,
    lowCtrPages,
    criticalAuditIssues,
    latestAeoResearch,
    latestAudit,
  ] = await Promise.all([
    // Backlinks perdidos DA > 30 en últimos 30 días
    prisma.backlink.findMany({
      where: {
        clientId,
        status: "LOST",
        lostAt: { gte: thirtyDaysAgo },
        domainAuthority: { gte: 30 },
      },
      orderBy: { domainAuthority: "desc" },
      take: 5,
      select: { sourceDomain: true, domainAuthority: true, lostAt: true },
    }),

    // Keywords prioritarias con rankings de los últimos 14 días
    prisma.keyword.findMany({
      where: { clientId, isPriority: true, deletedAt: null },
      include: {
        rankings: {
          where: { date: { gte: fourteenDaysAgo } },
          orderBy: { date: "desc" },
          take: 2,
        },
      },
    }),

    // Keyword gaps fáciles: competidor top 5, KD ≤ 30
    prisma.competitorKeywordGap.findMany({
      where: {
        clientId,
        competitorPosition: { lte: 5 },
        keywordDifficulty: { lte: 30 },
        capturedAt: { gte: thirtyDaysAgo },
      },
      orderBy: [{ searchVolume: "desc" }, { keywordDifficulty: "asc" }],
      take: 10,
      select: {
        keyword: true,
        competitorPosition: true,
        searchVolume: true,
        keywordDifficulty: true,
      },
    }),

    // Páginas con posición ≤ 10 y CTR < 3% y ≥ 100 impresiones
    prisma.pageMetric.findMany({
      where: {
        site: { clientId },
        date: { gte: twentyEightDaysAgo },
        position: { lte: 10 },
        ctr: { lt: 0.03 },
        impressions: { gte: 100 },
      },
      orderBy: { impressions: "desc" },
      take: 5,
      select: { url: true, position: true, ctr: true, impressions: true },
    }),

    // Issues críticos del último audit
    prisma.auditIssue.findMany({
      where: {
        audit: {
          clientId,
          date: { gte: subDays(now, 35) },
          status: "completed",
        },
        severity: "critical",
      },
      orderBy: { count: "desc" },
      take: 5,
      select: { type: true, title: true, count: true },
    }),

    // Último AEO research
    prisma.aeoResearch.findFirst({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      select: { clusters: true, questionCount: true, createdAt: true },
    }),

    // Último audit score
    prisma.audit.findFirst({
      where: { clientId, status: "completed" },
      orderBy: { date: "desc" },
      select: { scoreOverall: true, scoreTechnical: true, date: true },
    }),
  ]);

  // --- Procesar caídas y near-top ---
  const dropped: { term: string; currentPos: number; delta: number }[] = [];
  const nearTop: { term: string; position: number }[] = [];

  for (const kw of priorityKeywordsWithRankings) {
    const recent = kw.rankings[0];
    const prev = kw.rankings[1];

    if (recent?.position) {
      // Near-top: posiciones 4–10
      if (recent.position >= 4 && recent.position <= 10) {
        nearTop.push({ term: kw.term, position: recent.position });
      }

      // Caída significativa: ≥5 posiciones vs semana anterior
      if (prev?.position && recent.date >= sevenDaysAgo) {
        const delta = prev.position - recent.position; // negativo = cayó
        if (delta <= -5) {
          dropped.push({ term: kw.term, currentPos: recent.position, delta });
        }
      }
    }
  }

  // --- Construir texto de señales ---
  const lines: string[] = ["## Señales SEO detectadas"];
  let hasSignals = false;

  if (lostHighAuthorityBacklinks.length > 0) {
    hasSignals = true;
    lines.push("\n### Backlinks de alta autoridad perdidos (últimos 30 días)");
    for (const bl of lostHighAuthorityBacklinks) {
      lines.push(
        `- ${bl.sourceDomain} (DA ${bl.domainAuthority}) — perdido el ${format(bl.lostAt!, "dd/MM/yyyy")}`
      );
    }
  }

  if (dropped.length > 0) {
    hasSignals = true;
    lines.push("\n### Keywords con caída significativa (≥5 posiciones en 7 días)");
    for (const d of dropped) {
      lines.push(
        `- "${d.term}": cayó ${Math.abs(d.delta)} posiciones, ahora en #${d.currentPos}`
      );
    }
  }

  if (nearTop.length > 0) {
    hasSignals = true;
    lines.push("\n### Keywords near-top (posiciones 4–10) — alta oportunidad");
    for (const n of nearTop.slice(0, 8)) {
      lines.push(`- "${n.term}": posición #${n.position}`);
    }
  }

  if (easyGaps.length > 0) {
    hasSignals = true;
    lines.push("\n### Keyword gaps fáciles (KD ≤ 30, competidor top 5)");
    for (const g of easyGaps) {
      lines.push(
        `- "${g.keyword}": KD ${g.keywordDifficulty ?? "N/D"}, ${g.searchVolume ?? "N/D"} búsquedas/mes — competidor en #${g.competitorPosition}`
      );
    }
  }

  if (lowCtrPages.length > 0) {
    hasSignals = true;
    lines.push("\n### Páginas con buen posicionamiento pero CTR bajo (últimos 28 días)");
    for (const p of lowCtrPages) {
      const ctrPct = ((p.ctr ?? 0) * 100).toFixed(1);
      lines.push(
        `- ${p.url}: pos #${p.position?.toFixed(1)}, CTR ${ctrPct}%, ${p.impressions?.toLocaleString("es-MX")} impresiones`
      );
    }
  }

  if (criticalAuditIssues.length > 0) {
    hasSignals = true;
    lines.push("\n### Issues críticos en el último audit");
    for (const i of criticalAuditIssues) {
      lines.push(`- ${i.title} (${i.count} ocurrencias)`);
    }
  }

  if (latestAudit) {
    lines.push("\n### Score del sitio (último audit)");
    lines.push(
      `- Score general: ${latestAudit.scoreOverall}/100 | Técnico: ${latestAudit.scoreTechnical}/100 | Fecha: ${format(latestAudit.date, "dd/MM/yyyy")}`
    );
  }

  if (latestAeoResearch) {
    type ClusterItem = { aeoCandidate?: boolean; geoCandidate?: boolean };
    const clusters = Array.isArray(latestAeoResearch.clusters)
      ? (latestAeoResearch.clusters as unknown as ClusterItem[])
      : [];
    const aeoCnt = clusters.filter((c) => c.aeoCandidate).length;
    const geoCnt = clusters.filter((c) => c.geoCandidate).length;
    if (aeoCnt > 0 || geoCnt > 0) {
      lines.push("\n### AEO/GEO Research");
      lines.push(
        `- ${aeoCnt} clusters AEO candidatos | ${geoCnt} clusters GEO candidatos (basado en ${latestAeoResearch.questionCount} preguntas)`
      );
    }
  }

  if (lines.length === 1) {
    lines.push("\nSin señales de alerta ni oportunidades detectadas en este momento.");
  }

  return {
    text: lines.join("\n"),
    hasSignals,
  };
}
