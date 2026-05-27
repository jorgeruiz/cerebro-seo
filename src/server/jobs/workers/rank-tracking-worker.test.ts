import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockBulkGetRankings = vi.hoisted(() => vi.fn());

// ─── vi.mock ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: {
    client: { findUnique: vi.fn() },
    site: { findFirst: vi.fn() },
    keyword: { findMany: vi.fn(), count: vi.fn() },
    keywordRanking: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    insight: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/server/providers/dataforseo", () => ({
  dataForSeoProvider: {
    bulkGetRankings: mockBulkGetRankings,
  },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runRankTrackingProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path priority: 5 keywords trackeadas, delta calculado", async () => {
    const { prisma } = await import("@/lib/db");

    vi.mocked(prisma.client.findUnique).mockResolvedValue({
      id: "client-1",
      domain: "molinoazteca.mx",
    } as never);
    vi.mocked(prisma.site.findFirst).mockResolvedValue({ id: "site-1", url: "https://molinoazteca.mx" } as never);

    const keywords = [
      { id: "kw-1", term: "harina industrial", country: "MX", language: "es" },
      { id: "kw-2", term: "harina para tamales", country: "MX", language: "es" },
      { id: "kw-3", term: "distribuidora de harina", country: "MX", language: "es" },
      { id: "kw-4", term: "harina de maíz", country: "MX", language: "es" },
      { id: "kw-5", term: "molino azteca", country: "MX", language: "es" },
    ];
    vi.mocked(prisma.keyword.findMany).mockResolvedValue(keywords as never);

    // Ninguna tiene ranking hoy (primera ejecución del día)
    vi.mocked(prisma.keywordRanking.findMany)
      .mockResolvedValueOnce([]) // existingToday
      .mockResolvedValueOnce([  // previousRankings
        { keywordId: "kw-1", position: 8 },
        { keywordId: "kw-2", position: 12 },
        { keywordId: "kw-3", position: 25 },
        { keywordId: "kw-4", position: 5 },
        { keywordId: "kw-5", position: 3 },
      ] as never);

    vi.mocked(prisma.keywordRanking.create).mockResolvedValue({} as never);
    vi.mocked(prisma.insight.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.insight.create).mockResolvedValue({} as never);

    mockBulkGetRankings.mockResolvedValue([
      { keyword: "harina industrial", domain: "molinoazteca.mx", position: 6, rankingUrl: "https://molinoazteca.mx/harina", searchEngine: "google", country: "MX", language: "es", checkedAt: new Date() },
      { keyword: "harina para tamales", domain: "molinoazteca.mx", position: 10, rankingUrl: null, searchEngine: "google", country: "MX", language: "es", checkedAt: new Date() },
      { keyword: "distribuidora de harina", domain: "molinoazteca.mx", position: 20, rankingUrl: null, searchEngine: "google", country: "MX", language: "es", checkedAt: new Date() },
      { keyword: "harina de maíz", domain: "molinoazteca.mx", position: 4, rankingUrl: null, searchEngine: "google", country: "MX", language: "es", checkedAt: new Date() },
      { keyword: "molino azteca", domain: "molinoazteca.mx", position: 2, rankingUrl: null, searchEngine: "google", country: "MX", language: "es", checkedAt: new Date() },
    ]);

    const { runRankTrackingProcessor } = await import("../processors/rank-tracking-processor");
    const result = await runRankTrackingProcessor({ clientId: "client-1", mode: "priority" });

    expect(result.keywordsTracked).toBe(5);
    expect(result.keywordsSkipped).toBe(0);
    expect(mockBulkGetRankings).toHaveBeenCalledWith(expect.any(Array), 30);

    // Verificar que se crearon 5 KeywordRankings
    expect(prisma.keywordRanking.create).toHaveBeenCalledTimes(5);

    // kw-1: 8→6, delta=+2 (subió) — menor que threshold 5, no genera insight
    const kw1Call = vi.mocked(prisma.keywordRanking.create).mock.calls.find(
      (c) => (c[0] as { data: { keywordId: string } }).data.keywordId === "kw-1"
    );
    expect((kw1Call?.[0] as { data: { delta: number } }).data.delta).toBe(2); // prev(8) - curr(6) = 2 (positivo = subió)
  });

  it("0 keywords priority → skip sin llamar a DataForSEO", async () => {
    const { prisma } = await import("@/lib/db");

    vi.mocked(prisma.client.findUnique).mockResolvedValue({ id: "client-2", domain: "test.mx" } as never);
    vi.mocked(prisma.site.findFirst).mockResolvedValue({ id: "site-2", url: "https://test.mx" } as never);
    vi.mocked(prisma.keyword.findMany).mockResolvedValue([]);

    const { runRankTrackingProcessor } = await import("../processors/rank-tracking-processor");
    const result = await runRankTrackingProcessor({ clientId: "client-2", mode: "priority" });

    expect(result.keywordsTracked).toBe(0);
    expect(result.totalCost).toBe(0);
    expect(mockBulkGetRankings).not.toHaveBeenCalled();
  });

  it("delta > 10 negativo → genera insight WARNING HIGH", async () => {
    const { prisma } = await import("@/lib/db");

    vi.mocked(prisma.client.findUnique).mockResolvedValue({ id: "client-3", domain: "caida.mx" } as never);
    vi.mocked(prisma.site.findFirst).mockResolvedValue(null); // usa client.domain como fallback
    vi.mocked(prisma.keyword.findMany).mockResolvedValue([
      { id: "kw-a", term: "keyword caída", country: "MX", language: "es" },
    ] as never);

    vi.mocked(prisma.keywordRanking.findMany)
      .mockResolvedValueOnce([]) // sin ranking hoy
      .mockResolvedValueOnce([{ keywordId: "kw-a", position: 5 }] as never); // prev = posición 5

    vi.mocked(prisma.keywordRanking.create).mockResolvedValue({} as never);
    vi.mocked(prisma.insight.findFirst).mockResolvedValue(null); // no existe insight reciente
    vi.mocked(prisma.insight.create).mockResolvedValue({} as never);

    mockBulkGetRankings.mockResolvedValue([
      { keyword: "keyword caída", domain: "caida.mx", position: 18, rankingUrl: null, searchEngine: "google", country: "MX", language: "es", checkedAt: new Date() },
    ]);

    const { runRankTrackingProcessor } = await import("../processors/rank-tracking-processor");
    const result = await runRankTrackingProcessor({ clientId: "client-3", mode: "priority" });

    expect(result.insightsGenerated).toBe(1);

    // Verificar que el insight es WARNING HIGH
    const insightCall = vi.mocked(prisma.insight.create).mock.calls[0];
    const insightData = (insightCall?.[0] as { data: { type: string; severity: string } }).data;
    expect(insightData.type).toBe("WARNING");
    expect(insightData.severity).toBe("high");
  });

  it("modo bulk con delta 8 (menor que threshold 10) → NO genera insight", async () => {
    const { prisma } = await import("@/lib/db");

    vi.mocked(prisma.client.findUnique).mockResolvedValue({ id: "client-4", domain: "bulk.mx" } as never);
    vi.mocked(prisma.site.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.keyword.findMany).mockResolvedValue([
      { id: "kw-b", term: "keyword bulk", country: "MX", language: "es" },
    ] as never);

    vi.mocked(prisma.keywordRanking.findMany)
      .mockResolvedValueOnce([]) // sin ranking hoy
      .mockResolvedValueOnce([{ keywordId: "kw-b", position: 10 }] as never); // prev = 10

    vi.mocked(prisma.keywordRanking.create).mockResolvedValue({} as never);
    vi.mocked(prisma.insight.findFirst).mockResolvedValue(null);

    mockBulkGetRankings.mockResolvedValue([
      { keyword: "keyword bulk", domain: "bulk.mx", position: 18, rankingUrl: null, searchEngine: "google", country: "MX", language: "es", checkedAt: new Date() },
    ]);

    const { runRankTrackingProcessor } = await import("../processors/rank-tracking-processor");
    // delta = 10 - 18 = -8 — threshold bulk es 10, no alcanza
    const result = await runRankTrackingProcessor({ clientId: "client-4", mode: "bulk" });

    expect(result.insightsGenerated).toBe(0);
    expect(prisma.insight.create).not.toHaveBeenCalled();
  });

  it("keywords ya trackeadas hoy → se saltean (idempotencia)", async () => {
    const { prisma } = await import("@/lib/db");

    vi.mocked(prisma.client.findUnique).mockResolvedValue({ id: "client-5", domain: "idem.mx" } as never);
    vi.mocked(prisma.site.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.keyword.findMany).mockResolvedValue([
      { id: "kw-c", term: "keyword idem", country: "MX", language: "es" },
    ] as never);

    // Ya existe ranking hoy
    vi.mocked(prisma.keywordRanking.findMany).mockResolvedValueOnce([
      { keywordId: "kw-c" },
    ] as never);

    const { runRankTrackingProcessor } = await import("../processors/rank-tracking-processor");
    const result = await runRankTrackingProcessor({ clientId: "client-5", mode: "priority" });

    expect(result.keywordsTracked).toBe(0);
    expect(result.keywordsSkipped).toBe(1);
    expect(mockBulkGetRankings).not.toHaveBeenCalled();
  });
});
