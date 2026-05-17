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
  // Costo: $0.0006/req. 3.3x más barato que Live.
  // Envía las tasks y luego hace polling hasta que completan.

  async bulkGetRankings(keywords: KeywordQuery[]): Promise<RankingResult[]> {
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
          depth: 100,
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

  // ── getBacklinks (summary) ─────────────────────────────────────────────────
  // Backlinks API — Summary endpoint.
  // Costo: ~$0.05/req. Cache: 24 horas.

  async getBacklinks(_domain: string, _options?: BacklinkOptions): Promise<BacklinkResult[]> {
    // For the summary endpoint, return an array with the summary data
    // Full backlink list (Live endpoint) is a separate higher-cost call — stub for now
    throw new Error("getBacklinks (full list): use getBacklinksSummary for overview. Full list not implemented yet.");
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
