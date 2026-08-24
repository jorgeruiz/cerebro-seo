import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "@/lib/anthropic-config";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { logApiUsage, calculateClaudeCost } from "@/server/jobs/workers/base-worker";
import { format, endOfMonth } from "date-fns";
import { checkPreconditions } from "./preconditions";
import { collectSignals } from "./signals";
import type { NextStep, AdvisorResult } from "./types";

// ---------------------------------------------------------------------------
// System prompt — se cachea en Claude automáticamente (es idéntico siempre).
// ---------------------------------------------------------------------------

const ADVISOR_SYSTEM_PROMPT = `Eres el consultor SEO estratégico de Click Society, agencia de marketing digital en Monterrey.

Tu trabajo: analizar el estado SEO de un cliente y proponer los PRÓXIMOS PASOS más impactantes — acciones concretas, priorizadas y respaldadas por datos específicos.

REGLAS DE CALIDAD:
- Cada paso debe citar un dato real (número, posición, porcentaje, fecha)
- Las acciones deben ser ejecutables esta semana, no vagas o genéricas
- Prioriza por impacto/esfuerzo: primero lo que mueve la aguja más rápido
- NO incluyas pasos de tipo "setup" — esos se generan automáticamente
- Máximo 5 pasos estratégicos

CATEGORÍAS:
- "urgente": problema activo que daña tráfico o posicionamiento ahora mismo
- "oportunidad": ganancia rápida posible en los próximos 30 días
- "mejora": optimización de mediano plazo (1–3 meses)

SECCIÓN DESTINO (campo seccionDestino — usa EXACTAMENTE uno de estos slugs):
keywords | audit | backlinks | competencia | oportunidades | terminos-busqueda | trafico-paginas | aeo-research | contenido | ai-search | analisis

Guía para elegir sección destino:
- CTR bajo de una QUERY específica → terminos-busqueda
- CTR bajo de una PÁGINA/URL específica (mejorar meta tags) → trafico-paginas
- Oportunidades de ranking generales → oportunidades

RESPONDE ÚNICAMENTE con un JSON array válido. Sin texto fuera del JSON. Si no hay señales suficientes, devuelve [].

Formato de cada item:
{
  "titulo": "string menor a 80 chars con al menos un número o dato específico",
  "descripcion": "string menor a 350 chars explicando contexto y por qué importa ahora",
  "categoria": "urgente|oportunidad|mejora",
  "prioridad": 2,
  "seccionDestino": "slug exacto de la sección más relevante",
  "evidencia": "string menor a 120 chars con el dato clave que justifica este paso"
}`;

// ---------------------------------------------------------------------------
// Helpers de contexto con caching Redis
// ---------------------------------------------------------------------------

async function buildProfileBlock(clientId: string): Promise<string> {
  const cacheKey = `advisor:profile:${clientId}:${format(new Date(), "yyyy-MM")}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    include: {
      cycles: {
        where: { status: { in: ["ACTIVE", "PLANNING"] } },
        orderBy: { yearMonth: "desc" },
        take: 1,
      },
      keywords: { where: { isPriority: true, deletedAt: null }, take: 10 },
      competitors: { where: { deletedAt: null }, take: 5 },
    },
  });

  const cycle = client.cycles[0];

  const text = [
    `# Cliente: ${client.name}`,
    `Dominio: ${client.domain}`,
    `Ciclo actual: ${cycle?.yearMonth ?? "sin ciclo activo"} (${cycle?.status ?? "-"})`,
    "",
    "## Objetivo del mes",
    cycle?.focus ? `Foco: ${cycle.focus}` : "No definido.",
    ...(cycle?.goals ?? []).map((g) => `- ${g}`),
    cycle?.strategySummary ? `Resumen: ${cycle.strategySummary}` : "",
    "",
    "## Keywords prioritarias (tracking diario)",
    client.keywords.length > 0
      ? client.keywords
          .map((k) => `- "${k.term}"${k.targetUrl ? ` → ${k.targetUrl}` : ""}`)
          .join("\n")
      : "Ninguna configurada.",
    "",
    "## Competidores monitoreados",
    client.competitors.length > 0
      ? client.competitors
          .map((c) => `- ${c.domain}${c.domainAuthority ? ` (DA ${c.domainAuthority})` : ""}`)
          .join("\n")
      : "Ninguno configurado.",
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  // TTL: hasta fin de mes + 2 días de margen
  const ttl = Math.floor((endOfMonth(new Date()).getTime() - Date.now()) / 1000) + 172_800;
  await redis.setex(cacheKey, Math.max(ttl, 3600), text);
  return text;
}

async function buildSignalsBlock(clientId: string): Promise<string> {
  const cacheKey = `advisor:signals:${clientId}:${format(new Date(), "yyyy-MM-dd")}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const { text } = await collectSignals(clientId);
  await redis.setex(cacheKey, 25 * 3600, text);
  return text;
}

// ---------------------------------------------------------------------------
// Función principal
// ---------------------------------------------------------------------------

export async function runAdvisorProcessor(params: {
  clientId: string;
  triggeredBy?: string;
  scheduled?: boolean; // true = skip si ya corrió hoy
}): Promise<AdvisorResult> {
  const { clientId, triggeredBy, scheduled = false } = params;

  // 1. Idempotencia diaria — solo para runs programados
  const ranKey = `advisor:ran:${clientId}:${format(new Date(), "yyyy-MM-dd")}`;
  if (scheduled && (await redis.exists(ranKey))) {
    const existing = await prisma.nextStepPlan.findFirst({
      where: { clientId },
      orderBy: { generatedAt: "desc" },
    });
    if (existing) {
      return {
        steps: existing.steps as unknown as NextStep[],
        planId: existing.id,
        tokensUsed: {
          input: existing.inputTokens,
          output: existing.outputTokens,
          cached: 0,
        },
        cost: Number(existing.cost),
      };
    }
  }

  // 2. Preconditions determinísticas
  const preconditions = await checkPreconditions(clientId);
  const { setupSteps } = preconditions;

  // 3. Sin datos suficientes — solo setup steps, sin Claude
  if (!preconditions.isDataSufficient) {
    const plan = await prisma.nextStepPlan.create({
      data: {
        clientId,
        steps: setupSteps as unknown as import("@prisma/client").Prisma.InputJsonValue,
        model: "deterministic",
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        triggeredBy: triggeredBy ?? null,
      },
    });

    if (scheduled) await redis.setex(ranKey, 25 * 3600, "1");

    return {
      steps: setupSteps,
      planId: plan.id,
      tokensUsed: { input: 0, output: 0, cached: 0 },
      cost: 0,
    };
  }

  // 4. Construir contexto con caching estratégico
  const [profileBlock, signalsBlock] = await Promise.all([
    buildProfileBlock(clientId),
    buildSignalsBlock(clientId),
  ]);

  // 5. Llamar a Claude Sonnet 4.6 con prompt caching (3 bloques)
  const anthropic = new Anthropic();

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    system: ADVISOR_SYSTEM_PROMPT,
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
            text: signalsBlock,
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: "Genera los próximos pasos estratégicos más importantes para este cliente basándote en las señales detectadas. Recuerda: NO incluyas pasos de tipo setup — esos se gestionan automáticamente por separado.",
          },
        ],
      },
    ],
  });

  // 6. Parsear respuesta JSON
  const rawText =
    response.content[0].type === "text" ? response.content[0].text.trim() : "[]";

  let strategicSteps: NextStep[] = [];
  try {
    const match = rawText.match(/\[[\s\S]*\]/);
    strategicSteps = match ? (JSON.parse(match[0]) as NextStep[]) : [];
  } catch {
    console.error(
      "[advisor-processor] Failed to parse Claude response:",
      rawText.slice(0, 200)
    );
  }

  // 7. Merge setup + estratégicos, ordenar por prioridad
  const allSteps: NextStep[] = [...setupSteps, ...strategicSteps].sort(
    (a, b) => a.prioridad - b.prioridad
  );

  // 8. Calcular costo
  const usage = response.usage;
  const cachedTokens =
    (usage as unknown as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
  const cost = calculateClaudeCost(
    "sonnet-4-6",
    usage.input_tokens,
    usage.output_tokens,
    cachedTokens
  );

  // 9. Persistir en BD
  const plan = await prisma.nextStepPlan.create({
    data: {
      clientId,
      steps: allSteps as unknown as import("@prisma/client").Prisma.InputJsonValue,
      model: CLAUDE_MODEL,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cost,
      triggeredBy: triggeredBy ?? null,
    },
  });

  // 10. Registrar costo
  await logApiUsage({
    provider: "claude",
    endpoint: "messages/seo-advisor",
    cost,
    clientId,
  });

  // 11. Marcar como corrido hoy (idempotencia scheduled)
  if (scheduled) await redis.setex(ranKey, 25 * 3600, "1");

  return {
    steps: allSteps,
    planId: plan.id,
    tokensUsed: {
      input: usage.input_tokens,
      output: usage.output_tokens,
      cached: cachedTokens,
    },
    cost,
  };
}
