/**
 * AEO/GEO Research — clasificador de preguntas con Claude Sonnet 4.6.
 *
 * Agrupa preguntas en clusters temáticos y clasifica cada uno como candidato
 * para AEO (Answer Engine Optimization — featured snippets, PAA, voz) y/o
 * GEO (Generative Engine Optimization — citación por ChatGPT, Gemini, Perplexity).
 *
 * Costo estimado: ~$0.01–0.04 USD por análisis.
 */

import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "@/lib/anthropic-config";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { calculateClaudeCost, logApiUsage } from "@/server/jobs/workers/base-worker";
import { Decimal } from "@prisma/client/runtime/library";
import type { QuestionKeyword } from "@/server/providers/dataforseo";

// ─── Tipos ─────────────────────────────────────────────────────────────────

export type AeoIntent = "informational" | "navigational" | "transactional" | "commercial";

export interface AeoCluster {
  tema: string;
  preguntas: string[];
  intencion: AeoIntent;
  aeoCandidate: boolean;   // featured snippets / PAA / voz
  geoCandidate: boolean;   // citación por LLMs (ChatGPT, Gemini, Perplexity, Claude)
  recomendacion: string;
}

export interface AeoResearchResult {
  resumen: string;
  clusters: AeoCluster[];
  notaEstrategica: string;
}

// ─── System prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres el estratega de AEO/GEO senior de Click Society, agencia de marketing digital en Monterrey, México.

Definiciones:
- AEO (Answer Engine Optimization): optimizar para ser la respuesta directa en featured snippets de Google, cajas "People Also Ask", y respuestas de asistentes de voz.
- GEO (Generative Engine Optimization): optimizar para ser citado por motores de IA como ChatGPT, Gemini, Perplexity, Claude y Copilot cuando los usuarios preguntan sobre el tema.

Tu trabajo: analizar una lista de preguntas de búsqueda para un cliente y agruparlas en clusters temáticos accionables.

CRITERIOS DE CLASIFICACIÓN:
- aeoCandidate: true cuando la pregunta tiene respuesta directa y concisa que Google puede mostrar en un featured snippet o PAA. Señales: "cómo", "qué es", "cuánto cuesta", preguntas de definición o procedimiento.
- geoCandidate: true cuando el tema es del tipo que los LLMs citan frecuentemente: definiciones autoritativas, comparativas ("X vs Y"), "mejores X para Y", guías paso a paso, estadísticas o datos factuales, preguntas sobre una industria/mercado específico.

PRINCIPIOS:
- Un cluster puede ser ambos (aeoCandidate Y geoCandidate) — esto es la oportunidad de oro
- Agrupa por TEMA, no por keyword individual. Máximo 8 clusters, mínimo 3.
- La recomendación debe ser concreta: tipo de contenido, estructura, longitud aproximada, elementos que aumentan la probabilidad de ser featured/citado (tablas, listas numeradas, definiciones en H2, schema FAQ, etc.)

RESPONDE ÚNICAMENTE con un JSON válido con esta estructura exacta:
{
  "resumen": "2-3 oraciones describiendo el perfil de preguntas del cliente y la oportunidad AEO/GEO más grande",
  "clusters": [
    {
      "tema": "nombre descriptivo del cluster (máx 50 chars)",
      "preguntas": ["pregunta1 exacta del listado", "pregunta2 exacta del listado"],
      "intencion": "informational|navigational|transactional|commercial",
      "aeoCandidate": true,
      "geoCandidate": false,
      "recomendacion": "qué contenido crear, cómo estructurarlo, elementos específicos para AEO/GEO (máx 120 chars)"
    }
  ],
  "notaEstrategica": "1 párrafo priorizando los clusters según impacto potencial y esfuerzo"
}

Incluye TODAS las preguntas recibidas en al menos un cluster. Sin texto fuera del JSON.`;

// ─── Función principal ──────────────────────────────────────────────────────

/**
 * Versión efímera: clasifica preguntas sin persistir en BD.
 * Usada por /research (sin cliente). Loggea costo en ApiUsage con clientId: null.
 */
export async function classifyAeoResearchEphemeral(
  questions: QuestionKeyword[],
  clientInfo: { name: string; domain: string },
  seeds: string[]
): Promise<{ result: AeoResearchResult; cost: number }> {
  if (questions.length === 0) {
    return { result: { resumen: "", clusters: [], notaEstrategica: "" }, cost: 0 };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const questionList = questions
    .slice(0, 150)
    .map((q, i) => {
      const meta = [
        q.volume ? `vol:${q.volume}` : null,
        q.kd !== null ? `kd:${q.kd}` : null,
        q.source === "serp_paa" ? "PAA" : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `${i + 1}. ${q.keyword}${meta ? ` (${meta})` : ""}`;
    })
    .join("\n");

  const userMessage = [
    `# Análisis AEO/GEO — ${clientInfo.name}`,
    clientInfo.domain ? `Contexto: ${clientInfo.domain}` : "",
    `Seeds de búsqueda: ${seeds.join(", ")}`,
    "",
    `## Preguntas recopiladas (${questions.length} total):`,
    questionList,
    "",
    "Agrupa estas preguntas en clusters temáticos y clasifica el potencial AEO y GEO de cada uno.",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const rawText =
    response.content[0]?.type === "text" ? response.content[0].text : "{}";

  let result: AeoResearchResult;
  try {
    const jsonStr = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    result = JSON.parse(jsonStr) as AeoResearchResult;
  } catch {
    result = { resumen: rawText.slice(0, 300), clusters: [], notaEstrategica: "" };
  }

  const usage = response.usage;
  const cachedTokens =
    (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
  const cost = calculateClaudeCost(
    "sonnet-4-6",
    usage.input_tokens,
    usage.output_tokens,
    cachedTokens
  );

  // Log sin clientId → se persiste con clientId null en ApiUsage
  await logApiUsage({
    provider: "anthropic",
    endpoint: "research/aeo-classify/sonnet",
    cost,
  });

  return { result, cost };
}

export async function classifyAeoResearchForClient(
  clientId: string,
  questions: QuestionKeyword[],
  seeds: string[],
  triggeredBy?: string
): Promise<{ result: AeoResearchResult; researchId: string }> {
  if (questions.length === 0) {
    throw new Error("No hay preguntas para clasificar. Verifica que las seeds tengan keywords de pregunta asociadas.");
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const questionList = questions
    .slice(0, 150)
    .map((q, i) => {
      const meta = [
        q.volume ? `vol:${q.volume}` : null,
        q.kd !== null ? `kd:${q.kd}` : null,
        q.source === "serp_paa" ? "PAA" : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `${i + 1}. ${q.keyword}${meta ? ` (${meta})` : ""}`;
    })
    .join("\n");

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    select: { name: true, domain: true },
  });

  const userMessage = [
    `# Análisis AEO/GEO — ${client.name}`,
    `Dominio: ${client.domain}`,
    `Seeds de búsqueda: ${seeds.join(", ")}`,
    "",
    `## Preguntas recopiladas (${questions.length} total):`,
    questionList,
    "",
    "Agrupa estas preguntas en clusters temáticos y clasifica el potencial AEO y GEO de cada uno.",
  ].join("\n");

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const rawText =
    response.content[0]?.type === "text" ? response.content[0].text : "{}";

  let result: AeoResearchResult;
  try {
    const jsonStr = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    result = JSON.parse(jsonStr) as AeoResearchResult;
  } catch {
    result = {
      resumen: rawText.slice(0, 300),
      clusters: [],
      notaEstrategica: "",
    };
  }

  const usage = response.usage;
  const cachedTokens =
    (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
  const cost = calculateClaudeCost(
    "sonnet-4-6",
    usage.input_tokens,
    usage.output_tokens,
    cachedTokens
  );

  const record = await prisma.aeoResearch.create({
    data: {
      clientId,
      seeds,
      clusters: result as unknown as Prisma.InputJsonValue,
      model: CLAUDE_MODEL,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cost: new Decimal(cost.toFixed(6)),
      questionCount: questions.length,
      triggeredBy: triggeredBy ?? null,
    },
  });

  await logApiUsage({
    provider: "anthropic",
    endpoint: "aeo-research/sonnet",
    cost,
    clientId,
  });

  return { result, researchId: record.id };
}
