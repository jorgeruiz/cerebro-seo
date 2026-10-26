/**
 * Data step executor — runs data-heavy AI steps inside Cerebro SEO.
 *
 * Unlike code steps (agent in terminal) or WP steps (plugin proxy),
 * data steps use Cerebro SEO's own integrations (DataForSEO, GSC, GA4)
 * and Claude for selection/prioritization.
 *
 * Actions:
 * - keyword_research: getKeywordIdeas + getKeywordVolume + GSC cross → Claude selection
 * - apply_keywords: upsert Keywords from approved stagedChange
 */

import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "@/lib/anthropic-config";
import { prisma } from "@/lib/db";
import { logApiUsage } from "@/server/jobs/workers/base-worker";
import { DataForSeoProvider } from "@/server/providers/dataforseo";
import { GoogleSearchConsoleProvider } from "@/server/providers/google-search-console";
import { getOAuth2Client } from "@/lib/google-oauth";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface KeywordResearchInput {
  action: "keyword_research";
  categories: Array<{ name: string; seeds: string[] }>;
  criteria: {
    minVolume?: number;
    maxKD?: number;
    total: number;
    distribution?: Record<string, number>; // category → count
  };
}

export interface KeywordResearchRow {
  keyword: string;
  category: string;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  cpc: number | null;
  intent: string | null;
  gscClicks: number;
  gscImpressions: number;
  gscPosition: number | null;
  targetUrl: string | null; // existing URL or "Pendiente crear"
  priority: number; // 1-10
}

export interface StagedKeywordResearch {
  type: "keyword_research";
  rows: KeywordResearchRow[];
  criteria: KeywordResearchInput["criteria"];
  costUsd: number;
  staged_at: string;
}

export interface ApplyKeywordsInput {
  action: "apply_keywords";
}

export interface DataStepResult {
  notes: string;
  stagedChange?: StagedKeywordResearch;
  costUsd: number;
}

// ─── Keyword Research ───────────────────────────────────────────────────────

export async function executeKeywordResearch(
  input: KeywordResearchInput,
  siteId: string,
  clientId: string,
): Promise<DataStepResult> {
  const site = await prisma.site.findUniqueOrThrow({
    where: { id: siteId },
    select: { url: true, gscProperty: true },
  });

  const dfs = new DataForSeoProvider();
  let totalCost = 0;

  // 1. Get keyword ideas from all category seeds
  const allSeeds = input.categories.flatMap((c) => c.seeds);
  const ideas = await dfs.getKeywordIdeas(allSeeds, { limit: 200 }, clientId);
  totalCost += 0.025 * Math.ceil(allSeeds.length / 5); // ~$0.025 per 5-seed batch

  // 2. Get volume + KD for all unique keywords
  const uniqueKeywords = Array.from(new Set(ideas.map((i) => i.keyword)));
  const volumes = await dfs.getKeywordVolume(uniqueKeywords, "MX", clientId);
  totalCost += 0.02 * Math.ceil(uniqueKeywords.length / 700);

  // Build volume lookup
  const volMap = new Map(volumes.map((v) => [v.keyword, v]));

  // Enrich ideas with volume data
  const enriched = ideas.map((idea) => {
    const vol = volMap.get(idea.keyword);
    return {
      ...idea,
      searchVolume: vol?.searchVolume ?? idea.searchVolume,
      keywordDifficulty: vol?.keywordDifficulty ?? idea.keywordDifficulty,
      cpc: vol?.cpc ?? idea.cpc,
    };
  });

  // 3. Cross with GSC queries (last 90 days)
  let gscQueries: Array<{ query: string; clicks: number; impressions: number; position: number }> = [];
  if (site.gscProperty) {
    try {
      const oauthClient = await getOAuth2Client(clientId);
      if (!oauthClient) throw new Error("No OAuth2 client for GSC");
      const gsc = new GoogleSearchConsoleProvider(oauthClient);
      const endDate = new Date().toISOString().slice(0, 10);
      const startDate = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      gscQueries = await gsc.getQueries({
        siteUrl: site.gscProperty,
        startDate,
        endDate,
        rowLimit: 5000,
      });
    } catch (err) {
      console.warn(`[data-step] GSC queries failed: ${(err as Error).message}`);
    }
  }

  const gscMap = new Map(gscQueries.map((q) => [q.query.toLowerCase(), q]));

  // 4. Get existing site URLs from sitemap (basic fetch)
  const siteUrls = await fetchSitemapUrls(site.url);

  // 5. Claude selection: pick top N keywords, assign categories and priorities
  const claudeResult = await claudeSelectKeywords(
    enriched,
    gscMap,
    siteUrls,
    input,
    clientId,
  );
  totalCost += claudeResult.costUsd;

  const staged: StagedKeywordResearch = {
    type: "keyword_research",
    rows: claudeResult.rows,
    criteria: input.criteria,
    costUsd: totalCost,
    staged_at: new Date().toISOString(),
  };

  return {
    notes: `Keyword research: ${claudeResult.rows.length} keywords seleccionadas de ${enriched.length} candidatas. Costo: $${totalCost.toFixed(4)}`,
    stagedChange: staged,
    costUsd: totalCost,
  };
}

// ─── Apply Keywords ─────────────────────────────────────────────────────────

export async function executeApplyKeywords(
  rows: KeywordResearchRow[],
  clientId: string,
): Promise<DataStepResult> {
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const existing = await prisma.keyword.findFirst({
      where: {
        clientId,
        term: row.keyword,
        deletedAt: null,
      },
    });

    if (existing) {
      await prisma.keyword.update({
        where: { id: existing.id },
        data: {
          isPriority: true,
          targetUrl: row.targetUrl !== "Pendiente crear" ? row.targetUrl : existing.targetUrl,
          category: row.category,
        },
      });
      updated++;
    } else {
      await prisma.keyword.create({
        data: {
          clientId,
          term: row.keyword,
          isPriority: true,
          targetUrl: row.targetUrl !== "Pendiente crear" ? row.targetUrl : null,
          category: row.category,
          country: "MX",
          language: "es",
        },
      });
      created++;
    }
  }

  return {
    notes: `Keywords aplicadas: ${created} nuevas, ${updated} actualizadas. Total: ${rows.length} prioritarias.`,
    costUsd: 0,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function fetchSitemapUrls(siteUrl: string): Promise<string[]> {
  const base = siteUrl.startsWith("http") ? siteUrl.replace(/\/$/, "") : `https://${siteUrl}`;
  try {
    const res = await fetch(`${base}/sitemap.xml`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const text = await res.text();
    // Extract <loc> entries
    const urls: string[] = [];
    const regex = /<loc>([^<]+)<\/loc>/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      urls.push(match[1]);
    }
    return urls;
  } catch {
    return [];
  }
}

async function claudeSelectKeywords(
  enriched: Array<{
    keyword: string;
    searchVolume: number | null;
    keywordDifficulty: number | null;
    cpc: number | null;
    intent: string | null;
  }>,
  gscMap: Map<string, { clicks: number; impressions: number; position: number }>,
  siteUrls: string[],
  input: KeywordResearchInput,
  clientId: string,
): Promise<{ rows: KeywordResearchRow[]; costUsd: number }> {
  const client = new Anthropic();

  // Build candidate list for Claude (top 300 by volume to keep prompt manageable)
  const candidates = enriched
    .filter((k) => k.searchVolume !== null)
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
    .slice(0, 300)
    .map((k) => {
      const gsc = gscMap.get(k.keyword.toLowerCase());
      return {
        keyword: k.keyword,
        vol: k.searchVolume,
        kd: k.keywordDifficulty,
        cpc: k.cpc,
        intent: k.intent,
        gsc_clicks: gsc?.clicks ?? 0,
        gsc_impr: gsc?.impressions ?? 0,
        gsc_pos: gsc?.position ?? null,
      };
    });

  const categories = input.categories.map((c) => c.name);
  const dist = input.criteria.distribution
    ? Object.entries(input.criteria.distribution).map(([cat, n]) => `${cat}: ${n}`).join(", ")
    : "distribuir equitativamente";

  const prompt = `Selecciona las ${input.criteria.total} keywords más valiosas de esta lista para una estrategia SEO.

CATEGORÍAS disponibles: ${categories.join(", ")}
DISTRIBUCIÓN deseada: ${dist}
${input.criteria.minVolume ? `VOLUMEN MÍNIMO: ${input.criteria.minVolume}` : ""}
${input.criteria.maxKD ? `KD MÁXIMO: ${input.criteria.maxKD}` : ""}

CANDIDATAS (${candidates.length}):
${JSON.stringify(candidates, null, 0)}

URLs existentes del sitio (para asignar targetUrl):
${siteUrls.slice(0, 100).join("\n")}

Para cada keyword seleccionada, responde con JSON array:
[{
  "keyword": "...",
  "category": "una de las categorías",
  "targetUrl": "URL existente que mejor matchea, o 'Pendiente crear'",
  "priority": 1-10 (1=máxima)
}]

Criterios de selección:
- Prioriza keywords con datos GSC (ya tienen tráfico real)
- Mezcla intenciones: informational para blog, transactional para servicios
- Evita keywords demasiado genéricas (1-2 palabras sin calificador)
- Si hay volumen y KD, prioriza alto volumen + bajo KD
- Respeta la distribución por categoría`;

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => ("text" in b ? b.text : ""))
    .join("");

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("KEYWORD_SELECT_FAILED: Claude no devolvió JSON array");
  }

  const selected = JSON.parse(jsonMatch[0]) as Array<{
    keyword: string;
    category: string;
    targetUrl: string;
    priority: number;
  }>;

  // Enrich with volume data
  const rows: KeywordResearchRow[] = selected.map((sel) => {
    const candidate = candidates.find((c) => c.keyword === sel.keyword);
    const gsc = gscMap.get(sel.keyword.toLowerCase());
    return {
      keyword: sel.keyword,
      category: sel.category,
      searchVolume: candidate?.vol ?? null,
      keywordDifficulty: candidate?.kd ?? null,
      cpc: candidate?.cpc ?? null,
      intent: candidate?.intent ?? null,
      gscClicks: gsc?.clicks ?? 0,
      gscImpressions: gsc?.impressions ?? 0,
      gscPosition: gsc?.position ?? null,
      targetUrl: sel.targetUrl,
      priority: sel.priority,
    };
  });

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000;

  void logApiUsage({
    provider: "anthropic",
    endpoint: "keyword-research-select",
    cost: costUsd,
    clientId,
  });

  return { rows, costUsd };
}
