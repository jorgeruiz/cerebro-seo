import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { logApiUsage, calculateClaudeCost } from "../workers/base-worker";
import { InsightsJobData } from "../queues";
import { subDays, format, startOfMonth, endOfMonth } from "date-fns";

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

interface RankingsSummary {
  totalKeywords: number;
  avgPosition: number | null;
  avgPositionPrev: number | null;
  inTop3: number;
  inTop10: number;
  significantMoves: {
    keyword: string;
    currentPosition: number;
    delta: number;
    direction: "improved" | "dropped";
  }[];
}

interface GeneratedInsight {
  type: "opportunity" | "warning" | "win" | "info";
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  action: string;
  affectedKeywords: string[];
  affectedUrls: string[];
}

// ---------------------------------------------------------------------------
// System prompt — se pasa como `system` en la llamada a Claude.
// Claude API cachea el system prompt automáticamente cuando es idéntico.
// ---------------------------------------------------------------------------

const INSIGHTS_SYSTEM_PROMPT = `Eres el analista SEO senior de Click Society, agencia de marketing digital en Monterrey.

Tu trabajo: analizar datos SEO de un cliente y generar insights accionables, específicos y priorizados.

REGLAS DE CALIDAD:
- Cada insight debe tener datos concretos (números, %, fechas, períodos)
- Cada insight debe sugerir UNA acción clara y específica
- No repitas insights que ya existen este mes (se listan en el contexto)
- Prioriza por impacto potencial en tráfico orgánico
- Evita insights genéricos sin datos que los soporten

TIPOS DE INSIGHT:
- "opportunity": algo que el cliente puede aprovechar para crecer
- "warning": algo que está deteriorándose y requiere atención
- "win": resultado positivo que merece reconocerse
- "info": información relevante sin acción urgente

RESPONDE ÚNICAMENTE con un JSON array válido. Sin texto fuera del JSON. Máximo 7 items.

Formato de cada item:
{
  "type": "opportunity|warning|win|info",
  "severity": "low|medium|high|critical",
  "title": "string menor a 80 chars — debe incluir al menos un número o porcentaje",
  "description": "string menor a 350 chars — debe mencionar período de tiempo",
  "action": "string menor a 150 chars — UNA acción específica y ejecutable",
  "affectedKeywords": ["máximo 3 keywords"],
  "affectedUrls": ["máximo 2 URLs"]
}`;

// ---------------------------------------------------------------------------
// Helpers de contexto
// ---------------------------------------------------------------------------

/**
 * Construye el bloque estático del cliente (perfil + objetivos del ciclo).
 * Se cachea en Redis por todo el mes — es idéntico para todas las llamadas.
 */
async function buildClientProfileBlock(clientId: string): Promise<string> {
  const cacheKey = `insights:ctx:${clientId}:${format(new Date(), "yyyy-MM")}:profile`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    include: {
      cycles: {
        where: { status: { in: ["ACTIVE", "PLANNING"] } },
        orderBy: { yearMonth: "desc" },
        take: 1,
        include: {
          hypotheses: { where: { validation: "PENDING" } },
          tasks: { where: { status: { not: "DONE" } }, take: 10 },
        },
      },
      keywords: { where: { isPriority: true }, take: 15 },
      competitors: { take: 5 },
      insights: {
        where: {
          generatedAt: { gte: startOfMonth(new Date()) },
          dismissed: false,
        },
        select: { title: true, type: true },
        take: 20,
      },
    },
  });

  const cycle = client.cycles[0];

  const profile = `# Cliente: ${client.name}
Dominio: ${client.domain}
Ciclo actual: ${cycle?.yearMonth ?? "sin ciclo activo"} (${cycle?.status ?? "-"})

## Objetivo del mes
${cycle?.strategySummary ?? "No definido aún."}

## Keywords prioritarias (trackeo diario)
${client.keywords.map((k) => `- "${k.term}"${k.targetUrl ? ` → ${k.targetUrl}` : ""}`).join("\n") || "Ninguna configurada."}

## Competidores monitoreados
${client.competitors.map((c) => `- ${c.domain}${c.domainAuthority ? ` (DA ${c.domainAuthority})` : ""}`).join("\n") || "Ninguno configurado."}

## Hipótesis activas este mes
${
  cycle?.hypotheses
    .map(
      (h) =>
        `- "${h.statement}" → espera +${h.expectedDelta} en ${h.expectedMetric} en ${h.timeframeDays} días`
    )
    .join("\n") || "Ninguna."
}

## Insights ya generados este mes (NO repetir estos temas)
${client.insights.map((i) => `- [${i.type}] ${i.title}`).join("\n") || "Ninguno todavía."}`;

  // TTL: resto del mes actual + 2 días de margen
  const endOfCurrentMonth = endOfMonth(new Date());
  const ttlSeconds =
    Math.floor((endOfCurrentMonth.getTime() - Date.now()) / 1000) + 172_800;

  await redis.setex(cacheKey, ttlSeconds, profile);
  return profile;
}

/**
 * Construye el bloque de tendencias diarias (rankings + métricas GSC resumidas).
 * Se cachea 25 horas — se regenera una vez al día.
 */
async function buildTrendsBlock(clientId: string): Promise<string> {
  const cacheKey = `insights:ctx:${clientId}:${format(new Date(), "yyyy-MM-dd")}:trends`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  // Intentar leer el resumen que dejó RankTrackingAgent en Redis
  const rankingSummaryKey = `agent:rankings:${clientId}:summary:${format(subDays(new Date(), 0), "yyyy-'W'II")}`;
  const rankingSummaryRaw = await redis.get(rankingSummaryKey);
  const rankingSummary: RankingsSummary | null = rankingSummaryRaw
    ? (JSON.parse(rankingSummaryRaw) as RankingsSummary)
    : await computeRankingsSummary(clientId);

  // Último audit disponible
  const site = await prisma.site.findFirst({ where: { client: { id: clientId } } });
  const lastAudit = site
    ? await prisma.audit.findFirst({
        where: { siteId: site.id },
        orderBy: { date: "desc" },
        select: { scoreOverall: true, scoreTechnical: true, scorePerformance: true, date: true },
      })
    : null;

  const trends = `## Datos de tendencias (últimos 7-30 días)

### Rankings
- Total keywords trackeadas: ${rankingSummary?.totalKeywords ?? "N/D"}
- Posición promedio esta semana: ${rankingSummary?.avgPosition?.toFixed(1) ?? "N/D"}
- Posición promedio semana anterior: ${rankingSummary?.avgPositionPrev?.toFixed(1) ?? "N/D"}
- Keywords en top 3: ${rankingSummary?.inTop3 ?? "N/D"}
- Keywords en top 10: ${rankingSummary?.inTop10 ?? "N/D"}

### Movimientos significativos (±3 posiciones o más)
${
  rankingSummary?.significantMoves.length
    ? rankingSummary.significantMoves
        .slice(0, 12)
        .map(
          (m) =>
            `- "${m.keyword}": ${m.direction === "improved" ? "▲" : "▼"} ${Math.abs(m.delta)} posiciones → ahora en #${m.currentPosition}`
        )
        .join("\n")
    : "Sin movimientos significativos esta semana."
}

### Último audit del sitio
${
  lastAudit
    ? `- Fecha: ${format(lastAudit.date, "dd/MM/yyyy")}
- Score general: ${lastAudit.scoreOverall}/100
- Score técnico: ${lastAudit.scoreTechnical}/100
- Score performance: ${lastAudit.scorePerformance}/100`
    : "Sin audit disponible aún."
}`;

  await redis.setex(cacheKey, 25 * 3600, trends);
  return trends;
}

/**
 * Computa el resumen de rankings directamente desde PostgreSQL
 * cuando el RankTrackingAgent no dejó resumen en Redis.
 */
async function computeRankingsSummary(clientId: string): Promise<RankingsSummary> {
  const today = new Date();
  const sevenDaysAgo = subDays(today, 7);
  const fourteenDaysAgo = subDays(today, 14);

  const keywords = await prisma.keyword.findMany({
    where: { clientId },
    include: {
      rankings: {
        where: { date: { gte: fourteenDaysAgo } },
        orderBy: { date: "desc" },
      },
    },
  });

  const recentPositions: number[] = [];
  const prevPositions: number[] = [];
  const moves: RankingsSummary["significantMoves"] = [];

  for (const kw of keywords) {
    const recent = kw.rankings.find((r) => r.date >= sevenDaysAgo && r.position !== null);
    const prev = kw.rankings.find(
      (r) => r.date < sevenDaysAgo && r.date >= fourteenDaysAgo && r.position !== null
    );

    if (recent?.position) recentPositions.push(recent.position);
    if (prev?.position) prevPositions.push(prev.position);

    if (recent?.position && prev?.position) {
      const delta = prev.position - recent.position; // positivo = mejoró (bajó el número)
      if (Math.abs(delta) >= 3) {
        moves.push({
          keyword: kw.term,
          currentPosition: recent.position,
          delta,
          direction: delta > 0 ? "improved" : "dropped",
        });
      }
    }
  }

  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  return {
    totalKeywords: keywords.length,
    avgPosition: avg(recentPositions),
    avgPositionPrev: avg(prevPositions),
    inTop3: recentPositions.filter((p) => p <= 3).length,
    inTop10: recentPositions.filter((p) => p <= 10).length,
    significantMoves: moves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 15),
  };
}

/**
 * Construye el bloque dinámico según el trigger que disparó el job.
 * Este bloque NO se cachea.
 */
function buildTriggerBlock(
  trigger: InsightsJobData["trigger"],
  context?: Record<string, unknown>
): string {
  switch (trigger) {
    case "audit_complete":
      return `## Trigger: Audit completado
Se acaba de completar un site audit. Prioriza insights relacionados con issues técnicos críticos detectados en el audit.`;

    case "backlink_alert":
      return `## Trigger: Alerta de backlinks
Se detectó pérdida de backlinks de alta autoridad (DA > 30).
${context?.lostHighAuthorityBacklinks ? `Backlinks perdidos: ${context.lostHighAuthorityBacklinks}` : ""}
Prioriza un insight de tipo "warning" sobre este tema.`;

    case "ranking_drop":
      return `## Trigger: Caída de ranking detectada
${context?.keyword ? `Keyword afectada: "${context.keyword}"` : ""}
${context?.dropPositions ? `Caída: ${context.dropPositions} posiciones` : ""}
Prioriza un insight de tipo "warning" sobre esta caída.`;

    case "scheduled":
    default:
      return `## Análisis programado diario
Analiza todos los datos disponibles y genera los insights más relevantes del día.`;
  }
}

/**
 * Deduplica insights nuevos contra los ya existentes en el mes.
 * Usa similitud de cadenas simple (lowercased + overlap de palabras).
 */
function deduplicateInsights(
  newInsights: GeneratedInsight[],
  existingTitles: string[]
): GeneratedInsight[] {
  return newInsights.filter((insight) => {
    const newWords = new Set(insight.title.toLowerCase().split(/\s+/));
    return !existingTitles.some((title) => {
      const existingWords = title.toLowerCase().split(/\s+/);
      const overlap = existingWords.filter((w) => newWords.has(w)).length;
      // Si más del 60% de las palabras se solapan, es duplicado
      return overlap / Math.max(newWords.size, existingWords.length) > 0.6;
    });
  });
}

// ---------------------------------------------------------------------------
// Función principal
// ---------------------------------------------------------------------------

export interface InsightsResult {
  insightsGenerated: number;
  skippedDuplicate: number;
  tokensUsed: { input: number; output: number; cached: number };
  cost: number;
}

export async function runInsightsProcessor(
  jobData: InsightsJobData
): Promise<InsightsResult> {
  const { clientId, trigger, context } = jobData;

  // 1. Verificar idempotencia — no correr dos veces el análisis scheduled del mismo día
  if (trigger === "scheduled") {
    const ranKey = `insights:ran:${clientId}:${format(new Date(), "yyyy-MM-dd")}:scheduled`;
    if (await redis.exists(ranKey)) {
      return { insightsGenerated: 0, skippedDuplicate: 0, tokensUsed: { input: 0, output: 0, cached: 0 }, cost: 0 };
    }
  }

  // 2. Construir contexto con caching estratégico
  const [profileBlock, trendsBlock] = await Promise.all([
    buildClientProfileBlock(clientId),
    buildTrendsBlock(clientId),
  ]);
  const triggerBlock = buildTriggerBlock(trigger, context);

  // 3. Llamar a Claude Sonnet con prompt caching
  const anthropic = new Anthropic();

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: INSIGHTS_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: profileBlock,
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: trendsBlock,
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: triggerBlock,
          },
        ],
      },
    ],
  });

  // 4. Parsear respuesta
  const rawText =
    response.content[0].type === "text" ? response.content[0].text.trim() : "[]";

  let parsedInsights: GeneratedInsight[] = [];
  try {
    // Extraer JSON aunque Claude añada texto envolvente accidentalmente
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    parsedInsights = jsonMatch ? (JSON.parse(jsonMatch[0]) as GeneratedInsight[]) : [];
  } catch {
    console.error("[insights-processor] Failed to parse Claude response:", rawText.slice(0, 200));
    parsedInsights = [];
  }

  // 5. Deduplicar contra insights existentes del mes
  const existingInsights = await prisma.insight.findMany({
    where: {
      clientId,
      generatedAt: { gte: startOfMonth(new Date()) },
      dismissed: false,
    },
    select: { title: true },
  });

  const deduped = deduplicateInsights(
    parsedInsights,
    existingInsights.map((i) => i.title)
  );

  // 6. Persistir en PostgreSQL
  if (deduped.length > 0) {
    await prisma.insight.createMany({
      data: deduped.map((i) => ({
        clientId,
        type: i.type.toUpperCase() as "OPPORTUNITY" | "WARNING" | "WIN" | "INFO",
        severity: i.severity,
        title: i.title,
        description: i.description,
        suggestedAction: i.action,
        affectedUrls: i.affectedUrls ?? [],
        affectedKeywords: i.affectedKeywords ?? [],
      })),
    });
  }

  // 7. Calcular costo y registrar ApiUsage
  const usage = response.usage;
  const cachedTokens =
    (usage as unknown as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;

  const cost = calculateClaudeCost(
    "sonnet-4-6",
    usage.input_tokens,
    usage.output_tokens,
    cachedTokens
  );

  await logApiUsage({
    provider: "claude",
    endpoint: "messages/insights",
    cost,
    clientId,
  });

  // 8. Notificar a Cerebro si hay insights críticos
  const criticalInsights = deduped.filter((i) => i.severity === "critical");
  if (criticalInsights.length > 0) {
    const cerebro = process.env.CEREBRO_API_URL;
    const secret = process.env.CEREBRO_INTERNAL_SECRET;
    if (cerebro && secret) {
      fetch(`${cerebro}/api/webhooks/seo-alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": secret },
        body: JSON.stringify({
          type: "critical_insights",
          clientId,
          insights: criticalInsights.map((i) => ({ title: i.title, severity: i.severity })),
          ts: new Date().toISOString(),
        }),
      }).catch(console.error);
    }
  }

  // 9. Marcar como completado (idempotencia para scheduled)
  if (trigger === "scheduled") {
    const ranKey = `insights:ran:${clientId}:${format(new Date(), "yyyy-MM-dd")}:scheduled`;
    await redis.setex(ranKey, 25 * 3600, "1");
  }

  return {
    insightsGenerated: deduped.length,
    skippedDuplicate: parsedInsights.length - deduped.length,
    tokensUsed: {
      input: usage.input_tokens,
      output: usage.output_tokens,
      cached: cachedTokens,
    },
    cost,
  };
}
