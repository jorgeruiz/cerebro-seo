/**
 * Competitor Worker — analiza competidores vía DataForSEO Labs.
 *
 * Maneja el job "analysis:competitors" en la queue "data-collection".
 * Frecuencia: días 1 y 15 del mes, 7 AM (registrado en schedulers.ts).
 *
 * Lógica por competidor:
 *   1. Domain Rank Overview → métricas de autoridad del competidor
 *   2. Domain Intersection → keyword gaps (competitorOnly, both, clientOnly)
 *   3. Calcula Share of Voice, sharedKeywordsCount, gapsCount
 *   4. Persiste CompetitorSnapshot + CompetitorKeywordGap (reemplaza ciclo anterior)
 *   5. Genera insights algorítmicos sin Claude
 *
 * Concurrencia: 1 cliente a la vez (para no reventar cuota DataForSEO).
 */

import { createWorker } from "./base-worker";
import { prisma } from "@/lib/db";
import { DataForSeoProvider } from "@/server/providers/dataforseo";
import { InsightType } from "@prisma/client";

interface CompetitorJobData {
  clientId: string;
}

export const competitorWorker = createWorker<CompetitorJobData>(
  "data-collection",
  async (job) => {
    if (job.name !== "analysis:competitors") return;

    const { clientId } = job.data;

    const client = await prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { id: true, name: true, domain: true, services: true },
    });

    if (!client.services.includes("seo")) {
      console.log(`[competitors] ${client.name} no tiene servicio SEO — skipping`);
      return;
    }

    const competitors = await prisma.competitor.findMany({
      where: { clientId, deletedAt: null },
      select: { id: true, domain: true },
    });

    if (competitors.length === 0) {
      console.log(`[competitors] ${client.name}: sin competidores configurados`);
      return;
    }

    const provider = new DataForSeoProvider();
    const now = new Date();

    for (const competitor of competitors) {
      try {
        console.log(`[competitors] ${client.name} ↔ ${competitor.domain}`);

        // 1. Domain Rank Overview del competidor
        const overview = await provider.getDomainRankOverview(competitor.domain, clientId);

        // 2. Keyword gaps (cliente vs competidor)
        const gaps = await provider.getKeywordGaps(
          client.domain,
          competitor.domain,
          { limit: 200, minSearchVolume: 10 },
          clientId
        );

        // 3. Métricas derivadas
        const sharedKeywordsCount = gaps.both.length;
        const gapsCount = gaps.competitorOnly.length;
        const totalPool = sharedKeywordsCount + gapsCount + gaps.clientOnly.length;

        // Share of Voice: qué % del pool total rankea el competidor
        const shareOfVoicePct =
          totalPool > 0
            ? Math.round(((sharedKeywordsCount + gapsCount) / totalPool) * 100)
            : null;

        // 4a. Guardar CompetitorSnapshot
        await prisma.competitorSnapshot.create({
          data: {
            clientId,
            competitorId: competitor.id,
            domainRank: overview.domainRank,
            rankedKeywords: overview.rankedKeywords,
            estimatedTraffic: overview.estimatedTraffic,
            shareOfVoicePct: shareOfVoicePct !== null ? shareOfVoicePct : null,
            sharedKeywordsCount,
            gapsCount,
            capturedAt: now,
          },
        });

        // 4b. Reemplazar CompetitorKeywordGap del ciclo anterior
        //     (borrar los que tienen >30 días o directamente los existentes del competidor)
        await prisma.competitorKeywordGap.deleteMany({
          where: { clientId, competitorId: competitor.id },
        });

        if (gaps.competitorOnly.length > 0) {
          await prisma.competitorKeywordGap.createMany({
            data: gaps.competitorOnly.map((g) => ({
              clientId,
              competitorId: competitor.id,
              keyword: g.keyword,
              competitorPosition: g.competitorPosition,
              searchVolume: g.searchVolume,
              keywordDifficulty: g.keywordDifficulty,
              intent: g.intent,
              capturedAt: now,
            })),
          });
        }

        // 5. Actualizar lastAnalyzed en el Competitor
        await prisma.competitor.update({
          where: { id: competitor.id },
          data: { lastAnalyzed: now },
        });

        console.log(
          `[competitors] ${competitor.domain}: DR=${overview.domainRank ?? "?"} ` +
            `SoV=${shareOfVoicePct ?? "?"}% gaps=${gapsCount}`
        );
      } catch (err) {
        console.error(`[competitors] Error analizando ${competitor.domain}:`, err);
        // Continuar con el siguiente competidor
      }
    }

    // 6. Generar insights algorítmicos
    await generateCompetitorInsights({ clientId, competitors });

    console.log(`[competitors] ${client.name}: análisis completo (${competitors.length} competidores)`);
  },
  { concurrency: 1 }
);

// ─── Insights algorítmicos ──────────────────────────────────────────────────

async function generateCompetitorInsights({
  clientId,
  competitors,
}: {
  clientId: string;
  competitors: { id: string; domain: string }[];
}) {
  // Traer los últimos 2 snapshots por competidor para detectar tendencias
  for (const competitor of competitors) {
    try {
      const snapshots = await prisma.competitorSnapshot.findMany({
        where: { clientId, competitorId: competitor.id },
        orderBy: { capturedAt: "desc" },
        take: 2,
      });

      if (snapshots.length < 2) continue;

      const [latest, prev] = snapshots;
      const gapsDelta = (latest.gapsCount ?? 0) - (prev.gapsCount ?? 0);
      const sovDelta = (latest.shareOfVoicePct ?? 0) - (prev.shareOfVoicePct ?? 0);

      // Brecha de keywords creciendo significativamente
      if (gapsDelta >= 20) {
        await prisma.insight.create({
          data: {
            clientId,
            type: InsightType.WARNING,
            severity: gapsDelta >= 50 ? "HIGH" : "MEDIUM",
            title: `${competitor.domain} amplió su ventaja de keywords`,
            description:
              `La brecha de keywords con ${competitor.domain} creció +${gapsDelta} palabras ` +
              `en el último período. Ahora rankea en ${latest.gapsCount} keywords que tú no.`,
            suggestedAction:
              "Revisa las keywords de alto volumen en la tabla de brechas y considera crear contenido dirigido a esas oportunidades.",
            dataPoints: { competitorDomain: competitor.domain, gapsDelta, gapsCount: latest.gapsCount },
          },
        });
      }

      // Share of Voice del competidor cayendo — oportunidad
      if (sovDelta <= -10) {
        await prisma.insight.create({
          data: {
            clientId,
            type: InsightType.OPPORTUNITY,
            severity: "MEDIUM",
            title: `${competitor.domain} perdió Share of Voice`,
            description:
              `El Share of Voice de ${competitor.domain} cayó ${Math.abs(sovDelta)} puntos ` +
              `(de ${prev.shareOfVoicePct ?? "?"}% a ${latest.shareOfVoicePct ?? "?"}%).`,
            suggestedAction:
              "Es un buen momento para atacar keywords compartidas donde el competidor está perdiendo posición.",
            dataPoints: { competitorDomain: competitor.domain, sovDelta, sovCurrent: latest.shareOfVoicePct },
          },
        });
      }
    } catch (err) {
      console.error(`[competitors/insights] Error generando insights para ${competitor.domain}:`, err);
    }
  }

  // Detectar si hay gaps de alto volumen (>500 búsquedas) sin cubrir
  try {
    const highVolGaps = await prisma.competitorKeywordGap.findMany({
      where: {
        clientId,
        searchVolume: { gte: 500 },
        capturedAt: { gte: new Date(Date.now() - 2 * 24 * 3600 * 1000) },
      },
      orderBy: { searchVolume: "desc" },
      take: 10,
      include: { competitor: { select: { domain: true } } },
    });

    if (highVolGaps.length >= 5) {
      const sample = highVolGaps
        .slice(0, 3)
        .map((g) => `"${g.keyword}" (${g.searchVolume?.toLocaleString("es-MX")} búsquedas)`)
        .join(", ");

      await prisma.insight.create({
        data: {
          clientId,
          type: InsightType.OPPORTUNITY,
          severity: "HIGH",
          title: `${highVolGaps.length} keywords de alto volumen sin cubrir`,
          description:
            `Tus competidores rankean en ${highVolGaps.length} keywords con más de 500 búsquedas/mes donde no tienes presencia. Top: ${sample}.`,
          suggestedAction:
            "Prioriza estas keywords en el plan de contenido del próximo ciclo.",
          dataPoints: {
            count: highVolGaps.length,
            topKeywords: highVolGaps.slice(0, 5).map((g) => ({
              keyword: g.keyword,
              volume: g.searchVolume,
              competitor: g.competitor.domain,
            })),
          },
          affectedKeywords: highVolGaps.slice(0, 10).map((g) => g.keyword),
        },
      });
    }
  } catch (err) {
    console.error("[competitors/insights] Error generando insight de alto volumen:", err);
  }
}
