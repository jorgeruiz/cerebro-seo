import { redis } from "@/lib/redis";
import {
  SeoDataProvider,
  RankingResult,
  KeywordQuery,
  BacklinkOptions,
  BacklinkResult,
  BacklinksSummary,
  KeywordSuggestion,
  KeywordVolume,
  CompetitorData,
  SerpResult,
} from "./seo-data";

// ─── Config ───────────────────────────────────────────────────────────────────

const DFS_BASE_URL = "https://api.dataforseo.com/v3";

// Cache TTLs (seconds)
const TTL = {
  domainAuthority: 7 * 24 * 3600,   // 7 días
  backlinksSummary: 24 * 3600,       // 24 horas
  keywordVolume: 30 * 24 * 3600,     // 30 días
  // SERP tracking: NO cache (necesitamos histórico diario)
} as const;

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function getAuthHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error("DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set in environment");
  }
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

interface DfsResponse<T> {
  status_code: number;
  status_message: string;
  tasks?: Array<{
    id: string;
    status_code: number;
    status_message: string;
    cost: number;
    result_count: number;
    result: T[] | null;
  }>;
  cost?: number;
}

/**
 * Executes a DataForSEO POST request with exponential backoff (3 attempts).
 * Returns parsed JSON response and the time taken in ms.
 */
async function dfsPost<T>(
  path: string,
  body: unknown,
  attempt = 1
): Promise<{ data: DfsResponse<T>; durationMs: number; cost: number }> {
  const start = Date.now();
  try {
    const res = await fetch(`${DFS_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: getAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`DataForSEO HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as DfsResponse<T>;
    const durationMs = Date.now() - start;

    // Aggregate cost across tasks
    const cost =
      data.tasks?.reduce((sum, t) => sum + (t.cost ?? 0), 0) ??
      data.cost ??
      0;

    return { data, durationMs, cost };
  } catch (err) {
    if (attempt < 3) {
      const delayMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, delayMs));
      return dfsPost<T>(path, body, attempt + 1);
    }
    throw err;
  }
}

/**
 * Logs a DataForSEO API call to the ApiUsage table.
 * If the database is not available (e.g., during local dev before migration),
 * logs a warning to console and skips silently.
 */
async function logUsage(params: {
  endpoint: string;
  cost: number;
  clientId?: string;
}): Promise<void> {
  try {
    // Dynamic import to avoid crashing if Prisma client isn't generated yet
    const { prisma } = await import("@/lib/db");
    const { Decimal } = await import("@prisma/client/runtime/library");
    await prisma.apiUsage.create({
      data: {
        provider: "dataforseo",
        endpoint: params.endpoint,
        cost: new Decimal(params.cost.toFixed(6)),
        clientId: params.clientId ?? null,
      },
    });
  } catch {
    // DB not available (Docker not running, migration not applied, etc.)
    console.warn(
      `[ApiUsage] Could not log to DB — endpoint=${params.endpoint} cost=$${params.cost.toFixed(4)}`
    );
  }
}

// ─── DataForSeoProvider ───────────────────────────────────────────────────────

export class DataForSeoProvider implements SeoDataProvider {
  readonly name = "dataforseo";

  // ── getKeywordRanking ──────────────────────────────────────────────────────
  // SERP API, Live mode. Usado para verificaciones puntuales on-demand.
  // Costo: $0.002/req. NO se cachea — necesitamos histórico diario.

  async getKeywordRanking(params: {
    keyword: string;
    domain: string;
    country: string;
    language: string;
  }): Promise<RankingResult> {
    const { keyword, domain, country, language } = params;

    const { data, cost } = await dfsPost<DfsSerpItem>(
      "/serp/google/organic/live/regular",
      [
        {
          keyword,
          location_code: locationCode(country),
          language_code: language,
          depth: 100,
        },
      ]
    );

    void logUsage({ endpoint: "serp/organic/live", cost });

    const task = data.tasks?.[0];
    if (!task?.result) {
      return { keyword, domain, position: null, rankingUrl: null, searchEngine: "google", country, language, checkedAt: new Date() };
    }

    // Find the domain in the SERP results
    for (const item of task.result) {
      const items = (item as unknown as DfsSerpResult).items ?? [];
      for (const entry of items) {
        if (entry.type !== "organic") continue;
        const url: string = entry.url ?? "";
        if (domainMatches(url, domain)) {
          return {
            keyword,
            domain,
            position: entry.rank_absolute ?? null,
            rankingUrl: url,
            searchEngine: "google",
            country,
            language,
            checkedAt: new Date(),
          };
        }
      }
    }

    return { keyword, domain, position: null, rankingUrl: null, searchEngine: "google", country, language, checkedAt: new Date() };
  }

  // ── bulkGetRankings ────────────────────────────────────────────────────────
  // SERP API, Standard Queue. Usado para tracking masivo programado.
  // Costo por depth: base $0.0006 (depth:10) + $0.0015 × (depth-10)/10
  //   depth:30 ≈ $0.00195/req  ← default para tracking
  //   depth:100 ≈ $0.0051/req  ← evitar en bulk
  // Envía las tasks y luego hace polling hasta que completan.

  async bulkGetRankings(keywords: KeywordQuery[], depth = 30): Promise<RankingResult[]> {
    if (keywords.length === 0) return [];

    // 1. Post tasks in batches of 100
    const BATCH_SIZE = 100;
    const taskIds: string[] = [];

    for (let i = 0; i < keywords.length; i += BATCH_SIZE) {
      const batch = keywords.slice(i, i + BATCH_SIZE);
      const { data, cost } = await dfsPost<{ id: string }>(
        "/serp/google/organic/task_post",
        batch.map((kw) => ({
          keyword: kw.keyword,
          location_code: locationCode(kw.country),
          language_code: kw.language,
          depth,
        }))
      );

      void logUsage({ endpoint: "serp/organic/task_post", cost });

      const ids = data.tasks?.map((t) => t.id).filter(Boolean) ?? [];
      taskIds.push(...ids);
    }

    // 2. Poll for results (max 10 min, checking every 15s)
    const results: RankingResult[] = [];
    const remaining = new Set(taskIds);
    const deadline = Date.now() + 10 * 60 * 1000;

    while (remaining.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 15_000));

      const { data, cost } = await dfsPost<DfsSerpResult>(
        "/serp/google/organic/tasks_ready",
        [{}]
      );

      void logUsage({ endpoint: "serp/organic/tasks_ready", cost });

      const readyIds =
        data.tasks?.flatMap((t) =>
          (t.result ?? []).map((r) => r.id)
        ) ?? [];

      for (const id of readyIds) {
        if (!remaining.has(id)) continue;

        const { data: taskData, cost: taskCost } = await dfsPost<DfsSerpResult>(
          "/serp/google/organic/task_get/regular/" + id,
          [{}]
        );

        void logUsage({ endpoint: "serp/organic/task_get", cost: taskCost });

        const task = taskData.tasks?.[0];
        if (!task?.result) {
          remaining.delete(id);
          continue;
        }

        for (const item of task.result) {
          const serpItems = item.items ?? [];
          const kw = item.keyword ?? "";
          const domain = keywords.find((k) => k.keyword === kw)?.domain ?? "";

          let found = false;
          for (const entry of serpItems) {
            if (entry.type !== "organic") continue;
            const url: string = entry.url ?? "";
            if (domain && domainMatches(url, domain)) {
              results.push({
                keyword: kw,
                domain,
                position: entry.rank_absolute ?? null,
                rankingUrl: url,
                searchEngine: "google",
                country: keywords.find((k) => k.keyword === kw)?.country ?? "MX",
                language: keywords.find((k) => k.keyword === kw)?.language ?? "es",
                checkedAt: new Date(),
              });
              found = true;
              break;
            }
          }

          if (!found) {
            results.push({
              keyword: kw,
              domain,
              position: null,
              rankingUrl: null,
              searchEngine: "google",
              country: keywords.find((k) => k.keyword === kw)?.country ?? "MX",
              language: keywords.find((k) => k.keyword === kw)?.language ?? "es",
              checkedAt: new Date(),
            });
          }
        }

        remaining.delete(id);
      }
    }

    return results;
  }

  // ── getDomainAuthority ─────────────────────────────────────────────────────
  // DataForSEO Labs Domain Rank Overview.
  // Costo: ~$0.02/req. Cache: 7 días.

  async getDomainAuthority(domain: string): Promise<number | null> {
    const cacheKey = `cache:dataforseo:domain:${domain}:rank`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) return parseInt(cached, 10);
    } catch { /* Redis caído — continuar sin caché */ }

    const { data, cost } = await dfsPost<DfsDomainRankResult>(
      "/dataforseo_labs/google/domain_rank_overview/live",
      [{ target: domain, location_code: 2484, language_code: "es" }]
    );

    void logUsage({ endpoint: "labs/domain_rank_overview", cost });

    const rank =
      data.tasks?.[0]?.result?.[0]?.items?.[0]?.rank_group ?? null;

    if (rank !== null) {
      try {
        await redis.setex(cacheKey, TTL.domainAuthority, String(rank));
      } catch { /* Redis caído — devolver datos sin cachear */ }
    }

    return rank;
  }

  // ── getBacklinks (full list) ───────────────────────────────────────────────
  // Backlinks API — Live list endpoint.
  // Costo: ~$0.10/req. Cache: 24 horas.

  async getBacklinks(domain: string, options?: BacklinkOptions): Promise<BacklinkResult[]> {
    const limit = options?.limit ?? 100;
    const cacheKey = `cache:dataforseo:backlinks:${domain}:list:${limit}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) return JSON.parse(cached) as BacklinkResult[];
    } catch { /* Redis caído — continuar sin caché */ }

    const { data, cost } = await dfsPost<DfsBacklinksLiveResult>(
      "/backlinks/backlinks/live",
      [{ target: domain, limit, mode: "as_is", order_by: ["domain_from_rank,desc"] }]
    );

    void logUsage({ endpoint: "backlinks/live", cost: cost || 0.10 });

    const items: DfsBacklinkItem[] = data.tasks?.[0]?.result?.[0]?.items ?? [];

    const results: BacklinkResult[] = items.map((item) => ({
      sourceDomain: item.domain_from ?? "",
      sourceUrl: item.url_from ?? "",
      targetUrl: item.url_to ?? "",
      anchorText: item.anchor ?? null,
      followType: item.dofollow ? "follow" : "nofollow",
      domainAuthority: item.domain_from_rank ?? null,
      firstSeen: item.first_seen ? new Date(item.first_seen) : new Date(),
      lastSeen: item.last_seen ? new Date(item.last_seen) : new Date(),
    }));

    try {
      await redis.setex(cacheKey, 24 * 3600, JSON.stringify(results));
    } catch { /* Redis caído — devolver datos sin cachear */ }

    return results;
  }

  async getBacklinksSummary(domain: string): Promise<BacklinksSummary> {
    const cacheKey = `cache:dataforseo:backlinks:${domain}:summary`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) return JSON.parse(cached) as BacklinksSummary;
    } catch { /* Redis caído — continuar sin caché */ }

    const { data, cost } = await dfsPost<DfsBacklinkSummaryResult>(
      "/backlinks/summary/live",
      [{ target: domain, include_subdomains: true }]
    );

    void logUsage({ endpoint: "backlinks/summary", cost });

    const result = data.tasks?.[0]?.result?.[0];
    const summary: BacklinksSummary = {
      domain,
      totalBacklinks: result?.backlinks ?? 0,
      referringDomains: result?.referring_domains ?? 0,
      domainAuthority: result?.rank ?? null,
      spamScore: result?.spam_score ?? null,
      checkedAt: new Date(),
    };

    try {
      await redis.setex(cacheKey, TTL.backlinksSummary, JSON.stringify(summary));
    } catch { /* Redis caído — devolver datos sin cachear */ }

    return summary;
  }

  // ── getDomainRankOverview ──────────────────────────────────────────────────
  // DataForSEO Labs — Domain Rank Overview (para análisis de competidores).
  // Costo: ~$0.02/req. Cache: 7 días.

  async getDomainRankOverview(
    domain: string,
    clientId?: string
  ): Promise<DomainRankOverview> {
    const cacheKey = `cache:dataforseo:domain:${domain}:overview`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) return JSON.parse(cached) as DomainRankOverview;
    } catch { /* Redis caído */ }

    const { data, cost } = await dfsPost<DfsDomainRankOverviewResult>(
      "/dataforseo_labs/google/domain_rank_overview/live",
      [{ target: domain, location_name: "Mexico", language_name: "Spanish" }]
    );

    void logUsage({ endpoint: "labs/domain_rank_overview", cost: cost || 0.02, clientId });

    const item = data.tasks?.[0]?.result?.[0]?.items?.[0];
    const overview: DomainRankOverview = {
      domain,
      domainRank: item?.rank_group ?? null,
      rankedKeywords: item?.metrics?.organic?.count ?? 0,
      estimatedTraffic: item?.metrics?.organic?.etv ?? 0,
    };

    try {
      await redis.setex(cacheKey, 7 * 24 * 3600, JSON.stringify(overview));
    } catch { /* Redis caído */ }

    return overview;
  }

  // ── getKeywordGaps ─────────────────────────────────────────────────────────
  // DataForSEO Labs — Domain Intersection (keyword gaps entre cliente y competidor).
  // Costo: ~$0.02/req. Cache: 7 días.

  async getKeywordGaps(
    clientDomain: string,
    competitorDomain: string,
    options?: {
      limit?: number;
      minSearchVolume?: number;
    },
    clientId?: string
  ): Promise<KeywordGapResult> {
    const limit = options?.limit ?? 100;
    const minVol = options?.minSearchVolume ?? 10;
    const cacheKey = `cache:dataforseo:gaps:${clientDomain}:${competitorDomain}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) return JSON.parse(cached) as KeywordGapResult;
    } catch { /* Redis caído */ }

    const { data, cost } = await dfsPost<DfsDomainIntersectionResult>(
      "/dataforseo_labs/google/domain_intersection/live",
      [{
        target1: clientDomain,
        target2: competitorDomain,
        location_name: "Mexico",
        language_name: "Spanish",
        limit,
        intersections: true,
        include_intersections: true,
      }]
    );

    void logUsage({ endpoint: "labs/domain_intersection", cost: cost || 0.02, clientId });

    const items: DfsDomainIntersectionItem[] = data.tasks?.[0]?.result?.[0]?.items ?? [];

    const competitorOnly: KeywordGapResult["competitorOnly"] = [];
    const both: KeywordGapResult["both"] = [];
    const clientOnly: KeywordGapResult["clientOnly"] = [];

    for (const item of items) {
      const vol = item.keyword_data?.search_volume ?? null;
      const kd = item.keyword_data?.keyword_difficulty ?? null;
      const intent = item.keyword_data?.search_intent ?? null;
      const kw = item.keyword ?? "";

      const t1Pos = item.first_position ?? null;   // cliente
      const t2Pos = item.second_position ?? null;  // competidor

      if (t2Pos !== null && t1Pos === null) {
        // competidor rankea, cliente no → gap
        if ((vol ?? 0) >= minVol) {
          competitorOnly.push({
            keyword: kw,
            competitorPosition: t2Pos,
            searchVolume: vol,
            keywordDifficulty: kd,
            intent,
          });
        }
      } else if (t1Pos !== null && t2Pos !== null) {
        both.push({
          keyword: kw,
          clientPosition: t1Pos,
          competitorPosition: t2Pos,
          searchVolume: vol,
        });
      } else if (t1Pos !== null && t2Pos === null) {
        clientOnly.push({
          keyword: kw,
          clientPosition: t1Pos,
          searchVolume: vol,
        });
      }
    }

    const result: KeywordGapResult = { competitorOnly, both, clientOnly };

    try {
      await redis.setex(cacheKey, 7 * 24 * 3600, JSON.stringify(result));
    } catch { /* Redis caído */ }

    return result;
  }

  // ── Stubs ──────────────────────────────────────────────────────────────────

  async getKeywordSuggestions(_seed: string, _country: string): Promise<KeywordSuggestion[]> {
    throw new Error("getKeywordSuggestions: not implemented yet — Fase 2");
  }

  async getKeywordVolume(_keywords: string[], _country: string): Promise<KeywordVolume[]> {
    throw new Error("getKeywordVolume: not implemented yet — Fase 2");
  }

  async getCompetitorOverview(_domain: string, _referenceKeywords: string[]): Promise<CompetitorData> {
    throw new Error("getCompetitorOverview: not implemented yet — Fase 3");
  }

  async getOrganicCompetitors(_domain: string): Promise<string[]> {
    throw new Error("getOrganicCompetitors: not implemented yet — Fase 3");
  }

  async getSerp(_keyword: string, _country: string): Promise<SerpResult> {
    throw new Error("getSerp: not implemented yet — Fase 2");
  }

  // ── getKeywordIdeas ────────────────────────────────────────────────────────
  // DataForSEO Labs — Keyword Suggestions. Dado un seed keyword, retorna ideas
  // relacionadas con volumen, KD, CPC e intención de búsqueda.
  // Costo: ~$0.025/req (Standard Queue). Cache: 7 días.

  async getKeywordIdeas(
    seeds: string[],
    options?: { limit?: number; locationName?: string; languageName?: string },
    clientId?: string
  ): Promise<KeywordIdea[]> {
    const limit = options?.limit ?? 100;
    const location = options?.locationName ?? "Mexico";
    const language = options?.languageName ?? "Spanish";
    const cacheKey = `cache:dataforseo:keyword-ideas:${seeds.join(",").slice(0, 80)}:${location}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) return JSON.parse(cached) as KeywordIdea[];
    } catch { /* Redis caído */ }

    const { data, cost } = await dfsPost<DfsKeywordSuggestionsResult>(
      "/dataforseo_labs/google/keyword_suggestions/live",
      seeds.slice(0, 5).map((seed) => ({
        keyword: seed,
        location_name: location,
        language_name: language,
        limit,
        include_serp_info: false,
        include_seed_keyword: false,
      }))
    );

    void logUsage({ endpoint: "labs/keyword_suggestions", cost: cost || 0.025, clientId });

    const seen = new Set<string>();
    const ideas: KeywordIdea[] = [];

    for (const task of data.tasks ?? []) {
      for (const result of task.result ?? []) {
        for (const item of (result as DfsKeywordSuggestionsResult).items ?? []) {
          const kw = item.keyword ?? "";
          if (!kw || seen.has(kw)) continue;
          seen.add(kw);

          const monthly = item.keyword_info?.monthly_searches ?? null;
          const trend = monthly
            ? monthly.slice(-12).map((m) => m.search_volume ?? 0)
            : null;

          ideas.push({
            keyword: kw,
            searchVolume: item.keyword_info?.search_volume ?? null,
            cpc: item.keyword_info?.cpc ?? null,
            competition: item.keyword_info?.competition ?? null,
            keywordDifficulty: item.keyword_properties?.keyword_difficulty ?? null,
            intent: item.search_intent_info?.main_intent ?? null,
            trend,
          });
        }
      }
    }

    // Ordenar por volumen descendente
    ideas.sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0));

    try {
      await redis.set(cacheKey, JSON.stringify(ideas), "EX", 7 * 24 * 3600);
    } catch { /* Redis caído */ }

    return ideas;
  }
}

// ─── Singleton export ──────────────────────────────────────────────────────

export const dataForSeoProvider = new DataForSeoProvider();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function locationCode(country: string): number {
  const codes: Record<string, number> = {
    MX: 2484,
    US: 2840,
    ES: 2724,
    AR: 2032,
    CO: 2170,
    CL: 2152,
  };
  return codes[country.toUpperCase()] ?? 2484;
}

function domainMatches(url: string, domain: string): boolean {
  try {
    const hostname = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
    const clean = domain.replace(/^www\./, "").toLowerCase();
    return hostname.replace(/^www\./, "").toLowerCase() === clean;
  } catch {
    return false;
  }
}

// ─── DataForSEO response types (partial) ──────────────────────────────────────

interface DfsSerpItem {
  type: string;
  rank_absolute: number | null;
  url?: string;
}

interface DfsSerpResult {
  id: string;
  keyword?: string;
  items?: DfsSerpItem[];
}

interface DfsDomainRankItem {
  rank_group: number;
}

interface DfsDomainRankResult {
  items?: DfsDomainRankItem[];
}

interface DfsBacklinkSummaryResult {
  backlinks?: number;
  referring_domains?: number;
  rank?: number;
  spam_score?: number;
}

interface DfsBacklinkItem {
  domain_from?: string;
  url_from?: string;
  url_to?: string;
  anchor?: string | null;
  dofollow?: boolean;
  domain_from_rank?: number | null;
  first_seen?: string | null;
  last_seen?: string | null;
}

interface DfsBacklinksLiveResult {
  items?: DfsBacklinkItem[];
}

// ─── Competitor analysis types ─────────────────────────────────────────────

export interface DomainRankOverview {
  domain: string;
  domainRank: number | null;
  rankedKeywords: number;
  estimatedTraffic: number;
}

export interface KeywordGapResult {
  competitorOnly: {
    keyword: string;
    competitorPosition: number;
    searchVolume: number | null;
    keywordDifficulty: number | null;
    intent: string | null;
  }[];
  both: {
    keyword: string;
    clientPosition: number;
    competitorPosition: number;
    searchVolume: number | null;
  }[];
  clientOnly: {
    keyword: string;
    clientPosition: number;
    searchVolume: number | null;
  }[];
}

interface DfsDomainRankOverviewItem {
  rank_group?: number;
  metrics?: {
    organic?: {
      count?: number;
      etv?: number;
    };
  };
}

interface DfsDomainRankOverviewResult {
  items?: DfsDomainRankOverviewItem[];
}

interface DfsDomainIntersectionKeywordData {
  search_volume?: number | null;
  keyword_difficulty?: number | null;
  search_intent?: string | null;
}

interface DfsDomainIntersectionItem {
  keyword?: string;
  first_position?: number | null;
  second_position?: number | null;
  keyword_data?: DfsDomainIntersectionKeywordData;
}

interface DfsDomainIntersectionResult {
  items?: DfsDomainIntersectionItem[];
}

// ─── Keyword Ideas types ────────────────────────────────────────────────────

export interface KeywordIdea {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;      // 0-1
  keywordDifficulty: number | null; // 0-100
  intent: string | null;
  trend: number[] | null;           // últimos 12 meses
}

interface DfsKeywordSuggestionsItem {
  keyword?: string;
  keyword_info?: {
    search_volume?: number | null;
    cpc?: number | null;
    competition?: number | null;
    monthly_searches?: Array<{ search_volume?: number }> | null;
  };
  keyword_properties?: {
    keyword_difficulty?: number | null;
  };
  search_intent_info?: {
    main_intent?: string | null;
  };
}

interface DfsKeywordSuggestionsResult {
  items?: DfsKeywordSuggestionsItem[];
}
