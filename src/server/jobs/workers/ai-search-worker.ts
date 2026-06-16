/**
 * AI Search Visibility Worker — mide si los LLMs mencionan al cliente.
 *
 * Maneja el job "analysis:ai-search" en la queue "data-collection".
 * Frecuencia: viernes 6 AM (registrado en schedulers.ts).
 *
 * Lógica:
 *   1. Toma hasta 5 keywords prioritarias del cliente
 *   2. Genera queries naturales en español (simulando búsquedas en LLMs)
 *   3. Consulta Claude claude-haiku-4-5-20251001 con cada query
 *   4. Detecta si el cliente aparece en la respuesta y en qué posición
 *   5. Persiste en AiSearchVisibility
 *   6. Genera insight si la visibilidad es alta (oportunidad) o nula (warning)
 *
 * Costo estimado: ~$0.002–0.004 USD por cliente/semana (Haiku).
 * Concurrencia: 1 (para no saturar la API de Anthropic).
 */

import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL_HAIKU } from "@/lib/anthropic-config";
import { createWorker, logApiUsage, calculateClaudeCost } from "./base-worker";
import { prisma } from "@/lib/db";
import { InsightType } from "@prisma/client";

interface AiSearchJobData {
  clientId: string;
}

// Modelo Haiku para minimizar costo — las queries son simples
const MODEL = CLAUDE_MODEL_HAIKU;

// System prompt fijo — se beneficia del prompt caching automático de Anthropic
const SYSTEM_PROMPT =
  `Eres un asistente de búsqueda de información. Cuando el usuario te pregunte sobre empresas, ` +
  `marcas o proveedores de algún producto o servicio en México, responde con una lista numerada ` +
  `de máximo 5 opciones que conozcas, una por línea, con el nombre de la empresa o marca únicamente. ` +
  `Si no conoces opciones específicas, menciona las más conocidas a nivel nacional. ` +
  `Responde siempre en español. Solo incluye el nombre, sin descripción ni URLs.`;

export const aiSearchWorker = createWorker<AiSearchJobData>(
  "data-collection",
  async (job) => {
    if (job.name !== "analysis:ai-search") return;

    const { clientId } = job.data;

    const client = await prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { id: true, name: true, domain: true, services: true },
    });

    if (!client.services.includes("seo")) {
      console.log(`[ai-search] ${client.name} sin servicio SEO — skipping`);
      return;
    }

    // 1. Obtener keywords prioritarias (hasta 5)
    const keywords = await prisma.keyword.findMany({
      where: { clientId, isPriority: true, deletedAt: null },
      select: { term: true },
      take: 5,
      orderBy: { createdAt: "asc" },
    });

    if (keywords.length === 0) {
      console.log(`[ai-search] ${client.name}: sin keywords prioritarias — skipping`);
      return;
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const today = new Date();
    const brandTerms = extractBrandTerms(client.name, client.domain);

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCachedTokens = 0;
    let mentionedCount = 0;

    // 2. Por cada keyword, consultar Claude y detectar mención
    for (const { term } of keywords) {
      const query = buildQuery(term);

      try {
        const response = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 300,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: query }],
        });

        // Contabilizar tokens
        const usage = response.usage;
        totalInputTokens += usage.input_tokens;
        totalOutputTokens += usage.output_tokens;
        totalCachedTokens += (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;

        const responseText =
          response.content[0]?.type === "text" ? response.content[0].text : "";

        // 3. Detectar mención y posición
        const { mentioned, position, context } = detectMention(
          responseText,
          brandTerms
        );

        if (mentioned) mentionedCount++;

        // 4. Persistir
        await prisma.aiSearchVisibility.create({
          data: {
            clientId,
            date: today,
            llmSource: "claude",
            query,
            mentioned,
            position: position ?? null,
            context: context ?? null,
          },
        });

        console.log(
          `[ai-search] ${client.name} | "${term}" → ${mentioned ? `mencionado #${position}` : "no mencionado"}`
        );
      } catch (err) {
        console.error(`[ai-search] Error en query "${term}":`, err);
      }
    }

    // 5. Log ApiUsage
    const cost = calculateClaudeCost(
      "haiku-4-5",
      totalInputTokens,
      totalOutputTokens,
      totalCachedTokens
    );
    await logApiUsage({ provider: "anthropic", endpoint: "ai-search/haiku", cost, clientId });

    // 6. Generar insights
    const mentionRate = keywords.length > 0 ? mentionedCount / keywords.length : 0;
    await generateAiSearchInsights({ clientId, mentionedCount, totalQueries: keywords.length, mentionRate });

    console.log(
      `[ai-search] ${client.name}: ${mentionedCount}/${keywords.length} queries con mención (${Math.round(mentionRate * 100)}%)`
    );
  },
  { concurrency: 1 }
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extrae términos de marca desde el nombre y dominio del cliente.
 * Ejemplos:
 *   "Molino Azteca", "molinoazteca.com.mx" → ["molino azteca", "molinoazteca"]
 */
function extractBrandTerms(clientName: string, domain: string): string[] {
  const terms: string[] = [];

  // Nombre del cliente (lowercase, sin espacios extras)
  const nameLower = clientName.toLowerCase().trim();
  if (nameLower) terms.push(nameLower);

  // Dominio sin TLD: "molinoazteca.com.mx" → "molinoazteca"
  const domainBase = domain
    .replace(/^www\./, "")
    .split(".")[0]
    .toLowerCase();
  if (domainBase && !terms.includes(domainBase)) terms.push(domainBase);

  return terms.filter((t) => t.length >= 3);
}

/**
 * Construye una query natural en español para una keyword dada.
 */
function buildQuery(keyword: string): string {
  const templates = [
    `¿Cuáles son las mejores empresas de ${keyword} en México?`,
    `¿Quiénes son los mejores proveedores de ${keyword} en México?`,
    `¿Qué marcas de ${keyword} recomiendas en México?`,
    `Recomiéndame empresas de ${keyword} en México`,
    `¿A qué empresa contratar para ${keyword} en México?`,
  ];
  // Seleccionar template de forma determinística según la keyword para reproducibilidad
  const idx = keyword.charCodeAt(0) % templates.length;
  return templates[idx];
}

/**
 * Detecta si algún término de marca aparece en el texto de respuesta.
 * Retorna si fue mencionado, en qué posición de la lista y el contexto (línea donde aparece).
 */
function detectMention(
  responseText: string,
  brandTerms: string[]
): { mentioned: boolean; position: number | null; context: string | null } {
  const lines = responseText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Buscar por posición en lista numerada (ej: "1. Molino Azteca")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    for (const term of brandTerms) {
      if (line.includes(term)) {
        // Intentar extraer número de posición del inicio de la línea (ej: "3.")
        const numMatch = lines[i].match(/^(\d+)[.\)]/);
        const pos = numMatch ? parseInt(numMatch[1], 10) : i + 1;
        return {
          mentioned: true,
          position: pos,
          context: lines[i],
        };
      }
    }
  }

  return { mentioned: false, position: null, context: null };
}

// ─── Insights algorítmicos ──────────────────────────────────────────────────

async function generateAiSearchInsights({
  clientId,
  mentionedCount,
  totalQueries,
  mentionRate,
}: {
  clientId: string;
  mentionedCount: number;
  totalQueries: number;
  mentionRate: number;
}) {
  const week = new Date().toISOString().slice(0, 10);

  // Alta visibilidad — WIN
  if (mentionRate >= 0.6 && mentionedCount >= 3) {
    await prisma.insight.create({
      data: {
        clientId,
        type: InsightType.WIN,
        severity: mentionRate >= 0.8 ? "HIGH" : "MEDIUM",
        title: `Alta visibilidad en LLMs (${Math.round(mentionRate * 100)}%)`,
        description:
          `Claude mencionó al cliente en ${mentionedCount} de ${totalQueries} búsquedas simuladas. ` +
          `La marca tiene buena presencia en el conocimiento de los modelos de IA.`,
        suggestedAction:
          "Mantén la presencia digital actualizada: sitio, reseñas y menciones en medios — los LLMs aprenden de contenido web indexado.",
        dataPoints: { mentionedCount, totalQueries, mentionRate, week },
      },
    });
  }

  // Visibilidad nula — OPPORTUNITY
  if (mentionRate === 0 && totalQueries >= 3) {
    await prisma.insight.create({
      data: {
        clientId,
        type: InsightType.OPPORTUNITY,
        severity: "MEDIUM",
        title: "Sin presencia en búsquedas por IA",
        description:
          `El cliente no apareció en ninguna de las ${totalQueries} búsquedas realizadas en Claude esta semana. ` +
          `Los LLMs están recomendando a competidores en lugar del cliente.`,
        suggestedAction:
          "Aumentar presencia en fuentes que los LLMs indexan: Wikipedia, directorios de industria, notas de prensa, reseñas de Google y contenido editorial que cite la marca.",
        dataPoints: { mentionedCount, totalQueries, mentionRate, week },
      },
    });
  }
}
