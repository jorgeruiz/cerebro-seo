import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const mockResolveSite = vi.hoisted(() => vi.fn());
const mockGetStrikingDistance = vi.hoisted(() => vi.fn());
const mockGetOrganicCompetitors = vi.hoisted(() => vi.fn());
const mockGetCompetitorPages = vi.hoisted(() => vi.fn());
const mockGetKeywordGaps = vi.hoisted(() => vi.fn());
const mockAnthropicCreate = vi.hoisted(() => vi.fn());
const mockCreateReport = vi.hoisted(() => vi.fn());

// ── vi.mock ─────────────────────────────────────────────────────────────────

vi.mock("@/server/sites/resolve-site", () => ({
  resolveSite: mockResolveSite,
}));

vi.mock("@/server/providers/dataforseo", () => ({
  dataForSeoProvider: {
    getStrikingDistanceKeywords: mockGetStrikingDistance,
    getOrganicCompetitors: mockGetOrganicCompetitors,
    getCompetitorPages: mockGetCompetitorPages,
    getKeywordGaps: mockGetKeywordGaps,
  },
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockAnthropicCreate };
  },
}));

vi.mock("@/lib/anthropic-config", () => ({
  CLAUDE_MODEL: "claude-sonnet-4-6",
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    researchReport: { create: mockCreateReport },
  },
}));

vi.mock("@/server/jobs/workers/base-worker", () => ({
  logApiUsage: vi.fn(),
  calculateClaudeCost: vi.fn().mockReturnValue(0.025),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

const SITE = {
  id: "site-1",
  clientId: "client-1",
  url: "https://www.example.com",
  gscProperty: "sc-domain:example.com",
  ga4Property: null,
};

const STRIKING = [
  { keyword: "cctv monterrey", position: 5, searchVolume: 1200, keywordDifficulty: 22, url: "/servicios/cctv", intent: null },
  { keyword: "camaras seguridad", position: 12, searchVolume: 800, keywordDifficulty: 45, url: "/productos", intent: null },
  { keyword: "alarmas hogar", position: 8, searchVolume: 500, keywordDifficulty: 18, url: "/alarmas", intent: null },
];

const COMPETITORS = [
  { domain: "rival.mx", avgPosition: 8, serpCount: 120, intersections: 45, estimatedTraffic: 3200, rankedKeywords: 120 },
  { domain: "otro.com", avgPosition: 15, serpCount: 80, intersections: 20, estimatedTraffic: 1100, rankedKeywords: 80 },
];

const PAGES = [
  { url: "https://rival.mx/servicios", mainKeyword: "cctv monterrey", position: 3, estimatedTraffic: 500, keywordCount: 12 },
  { url: "https://rival.mx/blog/guia", mainKeyword: "camaras ip", position: 7, estimatedTraffic: 200, keywordCount: 5 },
];

const CLAUDE_RESPONSE = {
  content: [{ type: "text", text: JSON.stringify([
    { tipo: "quick-win", titulo: "Optimizar /servicios/cctv", descripcion: "...", targetUrl: "/servicios/cctv", keywords: ["cctv monterrey"], prioridad: 1, razon: "pos 5, vol 1200" },
  ]) }],
  usage: { input_tokens: 500, output_tokens: 200 },
};

// ── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSite.mockResolvedValue(SITE);
  mockGetStrikingDistance.mockResolvedValue(STRIKING);
  mockGetOrganicCompetitors.mockResolvedValue(COMPETITORS);
  mockGetCompetitorPages.mockResolvedValue(PAGES);
  mockGetKeywordGaps.mockResolvedValue({
    competitorOnly: [
      { keyword: "seguridad industrial", competitorPosition: 4, searchVolume: 600, keywordDifficulty: 25, intent: "commercial" },
    ],
    both: [],
    clientOnly: [],
  });
  mockAnthropicCreate.mockResolvedValue(CLAUDE_RESPONSE);
  mockCreateReport.mockResolvedValue({ id: "report-1" });
});

describe("estimateResearchCost", () => {
  it("returns correct estimate for default params (5 competitors)", async () => {
    const { estimateResearchCost } = await import("../research-service");
    const est = estimateResearchCost(5, 10);

    expect(est.competitorCount).toBe(5);
    expect(est.pagesPerCompetitor).toBe(10);
    // $0.05 striking + $0.05 competitors + 5*$0.05 pages + 5*$0.02 gaps + $0.03 suggestions = $0.48
    expect(est.estimatedCost).toBe(0.48);
    expect(est.breakdown).toHaveProperty("strikingDistance");
    expect(est.breakdown).toHaveProperty("competitors");
    expect(est.breakdown).toHaveProperty("competitorPages");
    expect(est.breakdown).toHaveProperty("suggestions");
  });

  it("scales with competitor count", async () => {
    const { estimateResearchCost } = await import("../research-service");
    const est3 = estimateResearchCost(3, 10);
    const est5 = estimateResearchCost(5, 10);

    expect(est3.estimatedCost).toBeLessThan(est5.estimatedCost);
  });
});

describe("runResearch", () => {
  it("calls resolveSite, DataForSEO providers, Claude, and persists report", async () => {
    const { runResearch } = await import("../research-service");

    const result = await runResearch({
      clientId: "client-1",
      triggeredBy: "test@test.com",
    });

    // resolveSite called
    expect(mockResolveSite).toHaveBeenCalledWith("client-1", undefined);

    // DataForSEO called
    expect(mockGetStrikingDistance).toHaveBeenCalledWith("example.com", expect.objectContaining({ limit: 50 }));
    expect(mockGetOrganicCompetitors).toHaveBeenCalledWith("example.com", expect.objectContaining({ limit: 5 }));
    expect(mockGetCompetitorPages).toHaveBeenCalledTimes(2); // 2 competitors
    expect(mockGetKeywordGaps).toHaveBeenCalledTimes(2); // 2 competitors

    // Claude called for suggestions
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);

    // Report persisted
    expect(mockCreateReport).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: "client-1",
        siteId: "site-1",
        domain: "example.com",
        triggeredBy: "test@test.com",
      }),
    });

    // Result structure
    expect(result.reportId).toBe("report-1");
    expect(result.data.domain).toBe("example.com");
    expect(result.data.strikingDistance).toHaveLength(3);
    expect(result.data.competitors).toHaveLength(2);
    expect(result.data.competitors[0].topPages).toHaveLength(2);
    expect(result.data.keywordGaps.length).toBeGreaterThanOrEqual(1);
    expect(result.data.suggestions).toBeDefined();
    expect(result.data.costBreakdown.total).toBeGreaterThan(0);
    expect(result.data.costBreakdown.keywordGaps).toBeGreaterThan(0);
  });

  it("skips suggestions when includeSuggestions=false", async () => {
    const { runResearch } = await import("../research-service");

    const result = await runResearch({
      clientId: "client-1",
      includeSuggestions: false,
    });

    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    expect(result.data.suggestions).toBeNull();
    expect(result.data.costBreakdown.suggestions).toBe(0);
  });

  it("filters low-difficulty keywords from striking distance (no extra API call)", async () => {
    const { runResearch } = await import("../research-service");

    const result = await runResearch({ clientId: "client-1" });

    // STRIKING has 2 keywords with KD ≤ 30: "cctv monterrey" (KD 22) and "alarmas hogar" (KD 18)
    expect(result.data.lowDifficulty).toHaveLength(2);
    expect(result.data.lowDifficulty.map((k) => k.keyword)).toContain("cctv monterrey");
    expect(result.data.lowDifficulty.map((k) => k.keyword)).toContain("alarmas hogar");
  });

  it("handles competitor pages failure gracefully", async () => {
    mockGetCompetitorPages
      .mockResolvedValueOnce(PAGES)
      .mockRejectedValueOnce(new Error("API timeout"));
    // Gaps can also fail gracefully
    mockGetKeywordGaps
      .mockResolvedValueOnce({ competitorOnly: [], both: [], clientOnly: [] })
      .mockRejectedValueOnce(new Error("API timeout"));

    const { runResearch } = await import("../research-service");
    const result = await runResearch({ clientId: "client-1" });

    // First competitor has pages, second has empty array (caught)
    expect(result.data.competitors[0].topPages).toHaveLength(2);
    expect(result.data.competitors[1].topPages).toHaveLength(0);
  });

  it("respects maxCompetitors parameter", async () => {
    const { runResearch } = await import("../research-service");

    await runResearch({ clientId: "client-1", maxCompetitors: 3 });

    expect(mockGetOrganicCompetitors).toHaveBeenCalledWith(
      "example.com",
      expect.objectContaining({ limit: 3 })
    );
  });
});
