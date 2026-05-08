// ─── Types ───────────────────────────────────────────────────────────────────

export interface RankingResult {
  keyword: string;
  domain: string;
  position: number | null;        // null = no rankea en top 100
  rankingUrl: string | null;
  searchEngine: string;
  country: string;
  language: string;
  checkedAt: Date;
}

export interface KeywordQuery {
  keyword: string;
  domain: string;
  country: string;
  language: string;
}

export interface BacklinkOptions {
  limit?: number;                 // default 1000
  includeInternal?: boolean;
}

export interface BacklinkResult {
  sourceDomain: string;
  sourceUrl: string;
  targetUrl: string;
  anchorText: string | null;
  followType: "follow" | "nofollow" | "ugc" | "sponsored";
  domainAuthority: number | null;
  firstSeen: Date;
  lastSeen: Date;
}

export interface BacklinksSummary {
  domain: string;
  totalBacklinks: number;
  referringDomains: number;
  domainAuthority: number | null;
  spamScore: number | null;
  checkedAt: Date;
}

export interface KeywordSuggestion {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;     // 0–1
  intent: "informational" | "navigational" | "transactional" | "commercial" | null;
}

export interface KeywordVolume {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
}

export interface CompetitorData {
  domain: string;
  organicKeywords: number;
  estimatedTraffic: number | null;
  domainAuthority: number | null;
  sharedKeywords: number;
  keywordGaps: string[];           // keywords donde el competidor rankea y el cliente no
}

export interface SerpEntry {
  position: number;
  url: string;
  title: string;
  description: string | null;
}

export interface SerpResult {
  keyword: string;
  country: string;
  entries: SerpEntry[];
  checkedAt: Date;
}

// ─── Interface ────────────────────────────────────────────────────────────────

export interface SeoDataProvider {
  readonly name: string;

  // Rankings
  getKeywordRanking(params: {
    keyword: string;
    domain: string;
    country: string;
    language: string;
  }): Promise<RankingResult>;

  bulkGetRankings(keywords: KeywordQuery[]): Promise<RankingResult[]>;

  // Backlinks
  getBacklinks(domain: string, options?: BacklinkOptions): Promise<BacklinkResult[]>;
  getBacklinksSummary(domain: string): Promise<BacklinksSummary>;
  getDomainAuthority(domain: string): Promise<number | null>;

  // Keyword research
  getKeywordSuggestions(seed: string, country: string): Promise<KeywordSuggestion[]>;
  getKeywordVolume(keywords: string[], country: string): Promise<KeywordVolume[]>;

  // Competitor analysis
  getCompetitorOverview(domain: string, referenceKeywords: string[]): Promise<CompetitorData>;
  getOrganicCompetitors(domain: string): Promise<string[]>;

  // SERP
  getSerp(keyword: string, country: string): Promise<SerpResult>;
}
