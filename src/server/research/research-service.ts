import Anthropic from "@anthropic-ai/sdk";
import { Decimal } from "@prisma/client/runtime/library";
import { CLAUDE_MODEL } from "@/lib/anthropic-config";
import { prisma } from "@/lib/db";
import { resolveSite } from "@/server/sites/resolve-site";
import { dataForSeoProvider } from "@/server/providers/dataforseo";
import { logApiUsage, calculateClaudeCost } from "@/server/jobs/workers/base-worker";
import type {
  ResearchData,
  ResearchSuggestion,
  CompetitorWithPages,
  CostBreakdown,
  ResearchEstimate,
} from "./types";

// ── Cost estimation ─────────────────────────────────────────────────────────

const COST_STRIKING = 0.05;
const COST_COMPETITORS = 0.05;
const COST_PAGES = 0.05;
const COST_SUGGESTIONS = 0.03; // Claude Sonnet avg

export function estimateResearchCost(
  competitorCount = 5,
  pagesPerCompetitor = 10,
): ResearchEstimate {
  const competitorPages = competitorCount * COST_PAGES;
  const total = COST_STRIKING + COST_COMPETITORS + competitorPages + COST_SUGGESTIONS;

  return {
    competitorCount,
    pagesPerCompetitor,
    estimatedCost: Math.round(total * 100) / 100,
    breakdown: {
      strikingDistance: `$${COST_STRIKING.toFixed(2)} (ranked keywords pos 4-20)`,
      competitors: `$${COST_COMPETITORS.toFixed(2)} (top ${competitorCount} orgánicos)`,
      competitorPages: `$${competitorPages.toFixed(2)} (${competitorCount} × $${COST_PAGES.toFixed(2)} relevant pages)`,
      suggestions: `~$${COST_SUGGESTIONS.toFixed(2)} (Claude Sonnet)`,
    },
  };
}

// ── Main research runner ────────────────────────────────────────────────────

export async function runResearch(params: {
  clientId: string;
  siteId?: string;
  maxCompetitors?: number;
  maxPagesPerCompetitor?: number;
  includeSuggestions?: boolean;
  triggeredBy?: string;
}): Promise<{ reportId: string; data: ResearchData }> {
  const {
    clientId,
    maxCompetitors = 5,
    maxPagesPerCompetitor = 10,
    includeSuggestions = true,
    triggeredBy,
  } = params;

  const site = await resolveSite(clientId, params.siteId);
  const domain = new URL(
    site.url.startsWith("http") ? site.url : `https://${site.url}`
  ).hostname.replace(/^www\./, "");

  const costBreakdown: CostBreakdown = {
    strikingDistance: 0,
    competitors: 0,
    competitorPages: 0,
    suggestions: 0,
    total: 0,
  };

  // 1. Striking distance keywords (pos 4-20) in parallel with competitors
  const [strikingDistance, rawCompetitors] = await Promise.all([
    dataForSeoProvider.getStrikingDistanceKeywords(domain, {
      limit: 50,
      maxPosition: 20,
      clientId,
    }),
    dataForSeoProvider.getOrganicCompetitors(domain, {
      limit: maxCompetitors,
      clientId,
    }),
  ]);

  costBreakdown.strikingDistance = COST_STRIKING;
  costBreakdown.competitors = COST_COMPETITORS;

  // 2. Low difficulty from striking distance (no extra API call)
  const lowDifficulty = strikingDistance
    .filter((kw) => (kw.keywordDifficulty ?? 100) <= 30 && (kw.searchVolume ?? 0) >= 10)
    .slice(0, 20);

  // 3. Competitor pages — parallel, capped
  const competitorPageResults = await Promise.all(
    rawCompetitors.map((comp) =>
      dataForSeoProvider
        .getCompetitorPages(comp.domain, { limit: maxPagesPerCompetitor, clientId })
        .catch(() => [] as import("@/server/providers/dataforseo").CompetitorPage[])
    )
  );

  costBreakdown.competitorPages = rawCompetitors.length * COST_PAGES;

  const competitors: CompetitorWithPages[] = rawCompetitors.map((comp, i) => ({
    ...comp,
    topPages: competitorPageResults[i],
  }));

  // 4. Claude suggestions (optional)
  let suggestions: ResearchSuggestion[] | null = null;
  let inputTokens = 0;
  let outputTokens = 0;

  if (includeSuggestions) {
    const suggestionResult = await generateSuggestions(
      domain,
      strikingDistance.slice(0, 20),
      lowDifficulty,
      competitors,
      clientId,
    );
    suggestions = suggestionResult.suggestions;
    inputTokens = suggestionResult.inputTokens;
    outputTokens = suggestionResult.outputTokens;
    costBreakdown.suggestions = suggestionResult.cost;
  }

  costBreakdown.total =
    costBreakdown.strikingDistance +
    costBreakdown.competitors +
    costBreakdown.competitorPages +
    costBreakdown.suggestions;

  const researchData: ResearchData = {
    domain,
    strikingDistance,
    lowDifficulty,
    competitors,
    suggestions,
    costBreakdown,
  };

  // 5. Persist
  const report = await prisma.researchReport.create({
    data: {
      clientId,
      siteId: site.id,
      domain,
      data: researchData as unknown as import("@prisma/client").Prisma.InputJsonValue,
      model: includeSuggestions ? CLAUDE_MODEL : null,
      inputTokens,
      outputTokens,
      apiCost: new Decimal(
        (costBreakdown.total - costBreakdown.suggestions).toFixed(6)
      ),
      claudeCost: new Decimal(costBreakdown.suggestions.toFixed(6)),
      triggeredBy: triggeredBy ?? null,
    },
  });

  // 6. Log costs
  await logApiUsage({
    provider: "dataforseo",
    endpoint: "research/multi",
    cost: costBreakdown.total - costBreakdown.suggestions,
    clientId,
  });

  if (costBreakdown.suggestions > 0) {
    await logApiUsage({
      provider: "claude",
      endpoint: "research/suggestions",
      cost: costBreakdown.suggestions,
      clientId,
    });
  }

  return { reportId: report.id, data: researchData };
}

// ── Claude suggestions ──────────────────────────────────────────────────────

const SUGGESTIONS_SYSTEM_PROMPT = `Eres el consultor SEO estratégico de Click Society, agencia de marketing digital en Monterrey.

Te proporcionan datos ya agregados de un dominio: keywords en striking distance, keywords de baja dificultad, y las páginas top de sus competidores orgánicos.

Tu trabajo: generar recomendaciones accionables priorizadas por impacto.

TIPOS de sugerencia (campo "tipo"):
- "quick-win": keyword ya en pos 4-20 que puede subir a top 3 con optimización on-page
- "contenido-nuevo": crear página/blog para cubrir gap vs competencia
- "optimizar-existente": mejorar página propia que ya rankea pero puede mejorar

REGLAS:
- Máximo 10 sugerencias, mínimo 3
- Cada sugerencia debe citar datos específicos (posición, volumen, KD, competidor)
- targetUrl: la URL propia que ya rankea (para quick-win/optimizar) o slug sugerido (para contenido-nuevo)
- keywords: array con 1-5 keywords target reales de los datos
- prioridad: 1 (más urgente) a 5 (puede esperar)
- razon: por qué esta acción y no otra, con dato de soporte

RESPONDE ÚNICAMENTE con un JSON array válido. Sin texto fuera del JSON.`;

async function generateSuggestions(
  domain: string,
  strikingDistance: import("@/server/providers/dataforseo").StrikingDistanceKeyword[],
  lowDifficulty: import("@/server/providers/dataforseo").TopKeywordResult[],
  competitors: CompetitorWithPages[],
  clientId: string,
): Promise<{
  suggestions: ResearchSuggestion[];
  inputTokens: number;
  outputTokens: number;
  cost: number;
}> {
  const context = [
    `## Dominio: ${domain}`,
    "",
    "## Keywords en striking distance (pos 4-20, por volumen)",
    ...strikingDistance.map(
      (kw) =>
        `- "${kw.keyword}" pos #${kw.position} vol ${kw.searchVolume ?? "?"} KD ${kw.keywordDifficulty ?? "?"} ${kw.url ? `→ ${kw.url}` : ""}`
    ),
    "",
    "## Keywords baja dificultad (KD ≤ 30)",
    ...lowDifficulty.map(
      (kw) =>
        `- "${kw.keyword}" pos #${kw.position ?? "?"} vol ${kw.searchVolume ?? "?"}`
    ),
    "",
    "## Competidores orgánicos",
    ...competitors.flatMap((comp) => [
      `### ${comp.domain} (${comp.intersections} keywords comunes, tráfico est. ${comp.estimatedTraffic})`,
      "Top páginas:",
      ...comp.topPages.map(
        (p) =>
          `  - ${p.url} | kw: "${p.mainKeyword ?? "?"}" pos #${p.position ?? "?"} | tráfico: ${p.estimatedTraffic} | ${p.keywordCount} keywords`
      ),
    ]),
  ].join("\n");

  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    system: SUGGESTIONS_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: context, cache_control: { type: "ephemeral" } },
          { type: "text", text: "Genera las recomendaciones priorizadas basándote en estos datos." },
        ],
      },
    ],
  });

  const rawText =
    response.content[0]?.type === "text" ? response.content[0].text.trim() : "[]";

  let suggestions: ResearchSuggestion[] = [];
  try {
    const match = rawText.match(/\[[\s\S]*\]/);
    suggestions = match ? (JSON.parse(match[0]) as ResearchSuggestion[]) : [];
  } catch {
    console.error("[research-service] Claude JSON parse fail:", rawText.slice(0, 200));
  }

  const usage = response.usage;
  const cached = (usage as unknown as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
  const cost = calculateClaudeCost("sonnet-4-6", usage.input_tokens, usage.output_tokens, cached);

  return {
    suggestions,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cost,
  };
}
