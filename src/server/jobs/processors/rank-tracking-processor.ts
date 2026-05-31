/**
 * Rank Tracking Processor — persiste rankings diarios/semanales desde DataForSEO.
 *
 * Modos:
 *   - "priority": keywords con isPriority: true (diario 3AM, deltas >5 generan insights)
 *   - "bulk": keywords con isPriority: false (semanal lunes 4AM, deltas >10 generan insights)
 *
 * Idempotente: si ya existe un ranking para la keyword en la fecha actual, lo salta.
 * Caída total: si >50% keywords pierden posición → insight CRITICAL.
 */

import { prisma } from "@/lib/db";
import { dataForSeoProvider } from "@/server/providers/dataforseo";
import type { KeywordQuery } from "@/server/providers/seo-data";

export type TrackingMode = "priority" | "bulk";

export interface TrackingJobData {
  clientId: string;
  mode?: TrackingMode;
}

export interface TrackingResult {
  clientId: string;
  mode: TrackingMode;
  keywordsTracked: number;
  keywordsSkipped: number;  // ya tenían ranking hoy
  insightsGenerated: number;
  totalCost: number;
  durationMs: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Inicio del día en UTC (para agrupar rankings por día) */
function todayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Inicio del día siguiente en UTC (para query de rango de fecha) */
function tomorrowUtc(): Date {
  const d = todayUtc();
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

// ─── Insight generation ───────────────────────────────────────────────────────

async function maybeCreateRankingInsight(params: {
  clientId: string;
  keywordTerm: string;
  positionBefore: number | null;
  positionAfter: number | null;
  delta: number | null;
  mode: TrackingMode;
}): Promise<boolean> {
  const { clientId, keywordTerm, positionBefore, positionAfter, delta, mode } = params;

  if (delta === null || positionBefore === null || positionAfter === null) return false;

  const threshold = mode === "priority" ? 5 : 10;
  if (Math.abs(delta) < threshold) return false;

  // No generar insights si el keyword no tenía posición antes (primera vez tracked)
  if (positionBefore > 100 && positionAfter > 100) return false;

  let type: "WARNING" | "OPPORTUNITY" | "WIN";
  let severity: "critical" | "high" | "medium" | "low";
  let title: string;
  let suggestedAction: string;

  if (delta < -10) {
    // Caída grande
    type = "WARNING";
    severity = "high";
    title = `"${keywordTerm}" cayó ${Math.abs(delta)} posiciones (${positionBefore} → ${positionAfter})`;
    suggestedAction = positionAfter > 30
      ? "La keyword salió del top 30. Verificar si hubo cambio de algoritmo, penalización o canibalización."
      : "Revisar la página rankeando — posibles cambios en el contenido, velocidad o intención de búsqueda.";
  } else if (delta < -threshold) {
    // Caída moderada
    type = "WARNING";
    severity = "medium";
    title = `"${keywordTerm}" bajó ${Math.abs(delta)} posiciones (${positionBefore} → ${positionAfter})`;
    suggestedAction = "Monitorear la tendencia. Si continúa bajando, revisar cambios recientes en la página.";
  } else if (delta > threshold && positionAfter <= 10) {
    // Subida entrando a top 10
    type = "WIN";
    severity = "medium";
    title = `"${keywordTerm}" entró al top 10 (${positionBefore} → ${positionAfter})`;
    suggestedAction = "Optimizar meta description y title para mejorar CTR ahora que está en top 10.";
  } else if (delta > threshold) {
    // Subida fuera de top 10
    type = "OPPORTUNITY";
    severity = "low";
    title = `"${keywordTerm}" subió ${delta} posiciones (${positionBefore} → ${positionAfter})`;
    suggestedAction = "Buen momentum. Considerar reforzar la página con contenido adicional.";
  } else {
    return false;
  }

  // Verificar que no exista un insight similar reciente (últimas 24h)
  const recentExists = await prisma.insight.findFirst({
    where: {
      clientId,
      title: { contains: keywordTerm },
      generatedAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
    },
    select: { id: true },
  });
  if (recentExists) return false;

  await prisma.insight.create({
    data: {
      clientId,
      type,
      severity,
      title,
      description: `Cambio detectado por el sistema de tracking de rankings.`,
      suggestedAction,
      affectedKeywords: [keywordTerm],
      affectedUrls: [],
      dataPoints: { keyword: keywordTerm, before: positionBefore, after: positionAfter, delta },
    },
  });

  return true;
}

// ─── Main processor ───────────────────────────────────────────────────────────

export async function runRankTrackingProcessor(
  data: TrackingJobData
): Promise<TrackingResult> {
  const start = Date.now();
  const { clientId } = data;
  const mode: TrackingMode = (data.mode as TrackingMode) ?? "priority";

  // ── Cargar cliente + site + keywords ────────────────────────────────────────

  const [client, site] = await Promise.all([
    prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, domain: true },
    }),
    prisma.site.findFirst({
      where: { clientId },
      select: { id: true, url: true },
    }),
  ]);

  if (!client) throw new Error(`Client not found: ${clientId}`);

  const domain = site?.url
    ? new URL(site.url.startsWith("http") ? site.url : `https://${site.url}`).hostname.replace(/^www\./, "")
    : client.domain.replace(/^www\./, "");

  const keywords = await prisma.keyword.findMany({
    where: {
      clientId,
      isPriority: mode === "priority",
      deletedAt: null,
    },
    select: { id: true, term: true, country: true, language: true },
  });

  if (keywords.length === 0) {
    console.log(`[rank-tracking] client=${clientId} mode=${mode} → 0 keywords, skipping`);
    return {
      clientId,
      mode,
      keywordsTracked: 0,
      keywordsSkipped: 0,
      insightsGenerated: 0,
      totalCost: 0,
      durationMs: Date.now() - start,
    };
  }

  const today = todayUtc();
  const tomorrow = tomorrowUtc();

  // ── Verificar cuáles ya tienen ranking hoy (idempotencia) ─────────────────

  const existingToday = await prisma.keywordRanking.findMany({
    where: {
      keywordId: { in: keywords.map((k) => k.id) },
      date: { gte: today, lt: tomorrow },
    },
    select: { keywordId: true },
  });
  const alreadyTrackedIds = new Set(existingToday.map((r) => r.keywordId));

  const toTrack = keywords.filter((k) => !alreadyTrackedIds.has(k.id));
  const skipped = keywords.length - toTrack.length;

  if (toTrack.length === 0) {
    console.log(`[rank-tracking] client=${clientId} mode=${mode} → all ${keywords.length} already tracked today`);
    return {
      clientId,
      mode,
      keywordsTracked: 0,
      keywordsSkipped: skipped,
      insightsGenerated: 0,
      totalCost: 0,
      durationMs: Date.now() - start,
    };
  }

  // ── Llamar a DataForSEO Standard Queue ────────────────────────────────────

  const queries: KeywordQuery[] = toTrack.map((kw) => ({
    keyword: kw.term,
    domain,
    country: kw.country,
    language: kw.language,
  }));

  const rankingResults = await dataForSeoProvider.bulkGetRankings(queries, 30);

  // Estimar costo: ~$0.00195/query con depth:30 Standard Queue
  const estimatedCost = toTrack.length * 0.00195;

  // ── Persistir rankings + calcular deltas ─────────────────────────────────

  // Cargar último ranking anterior para calcular delta
  const previousRankings = await prisma.keywordRanking.findMany({
    where: {
      keywordId: { in: toTrack.map((k) => k.id) },
      date: { lt: today },
    },
    orderBy: { date: "desc" },
    distinct: ["keywordId"],
    select: { keywordId: true, position: true },
  });
  const prevByKeywordId = new Map(previousRankings.map((r) => [r.keywordId, r.position]));

  let insightsGenerated = 0;
  let positionDrops = 0; // para detección de caída masiva

  for (const result of rankingResults) {
    const kw = toTrack.find((k) => k.term === result.keyword);
    if (!kw) continue;

    const prevPosition = prevByKeywordId.get(kw.id) ?? null;
    const currPosition = result.position; // null = fuera del top 30

    // delta: negativo = bajó posiciones (peor), positivo = subió (mejor)
    const delta =
      prevPosition !== null && currPosition !== null
        ? prevPosition - currPosition // ej: prev=10, curr=15 → delta=-5 (bajó)
        : null;

    // Contar caídas para detección masiva
    if (delta !== null && delta < -5) positionDrops++;

    await prisma.keywordRanking.create({
      data: {
        keywordId: kw.id,
        date: today,
        position: currPosition,
        rankingUrl: result.rankingUrl,
        searchEngine: result.searchEngine,
        delta,
      },
    });

    const generated = await maybeCreateRankingInsight({
      clientId,
      keywordTerm: kw.term,
      positionBefore: prevPosition,
      positionAfter: currPosition,
      delta,
      mode,
    });
    if (generated) insightsGenerated++;
  }

  // ── Detección de caída masiva (>50% keywords con drops) ───────────────────

  if (toTrack.length >= 3 && positionDrops > 0 && positionDrops >= Math.ceil(toTrack.length * 0.5)) {
    const criticalExists = await prisma.insight.findFirst({
      where: {
        clientId,
        type: "WARNING",
        severity: "critical",
        generatedAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
      },
      select: { id: true },
    });

    if (!criticalExists) {
      await prisma.insight.create({
        data: {
          clientId,
          type: "WARNING",
          severity: "critical",
          title: `Caída masiva de rankings: ${positionDrops}/${toTrack.length} keywords perdieron posición`,
          description: `El sistema detectó que más del 50% de las keywords monitoreadas perdieron posición en el mismo día. Esto puede indicar un cambio de algoritmo, penalización manual, o un problema técnico en el sitio.`,
          suggestedAction: "Verificar Google Search Console para mensajes de penalización. Revisar si hubo cambios técnicos o de contenido recientes. Comparar con datos del sector.",
          affectedKeywords: [],
          affectedUrls: [],
          dataPoints: { dropsCount: positionDrops, totalTracked: toTrack.length, percentage: Math.round(positionDrops / toTrack.length * 100) },
        },
      });
      insightsGenerated++;
    }
  }

  const durationMs = Date.now() - start;
  console.log(
    `[rank-tracking] client=${clientId} mode=${mode} tracked=${rankingResults.length} ` +
    `skipped=${skipped} insights=${insightsGenerated} cost≈$${estimatedCost.toFixed(4)} ${durationMs}ms`
  );

  return {
    clientId,
    mode,
    keywordsTracked: rankingResults.length,
    keywordsSkipped: skipped,
    insightsGenerated,
    totalCost: estimatedCost,
    durationMs,
  };
}
