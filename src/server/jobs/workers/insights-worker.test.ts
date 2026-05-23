import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks (deben definirse antes de vi.mock) ─────────────────────────

const mockRedis = vi.hoisted(() => ({
  get: vi.fn(),
  exists: vi.fn(),
  setex: vi.fn(),
}));

const mockAnthropicCreate = vi.hoisted(() => vi.fn());

// ── vi.mock declarations ─────────────────────────────────────────────────────

vi.mock("@/lib/redis", () => ({
  redis: mockRedis,
  redisBullMQ: {},
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    client: { findUniqueOrThrow: vi.fn() },
    site: { findFirst: vi.fn() },
    audit: { findFirst: vi.fn() },
    keyword: { findMany: vi.fn() },
    insight: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      createMany: vi.fn(),
      create: vi.fn(),
    },
    apiUsage: { create: vi.fn() },
  },
}));

vi.mock("bullmq", () => ({
  Worker: class {
    on() { return this; }
  },
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockAnthropicCreate };
  },
}));

// ── Tests ────────────────────────────────────────────────────────────────────

describe("insights-processor — runInsightsProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: llama a Claude y persiste insights generados", async () => {
    const { prisma } = await import("@/lib/db");

    mockRedis.exists.mockResolvedValue(0);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue("OK");

    vi.mocked(prisma.client.findUniqueOrThrow).mockResolvedValue({
      id: "client-1",
      name: "Molino Azteca",
      domain: "molinoazteca.mx",
      cycles: [
        {
          yearMonth: "2026-05",
          status: "ACTIVE",
          strategySummary: "Posicionar top 5 en harinas industriales",
          focus: "SEO técnico + contenidos",
          goals: ["Incrementar tráfico orgánico 20%"],
          hypotheses: [],
          tasks: [],
        },
      ],
      keywords: [{ term: "harina industrial", targetUrl: "/productos/harina" }],
      competitors: [],
      insights: [],
    } as never);

    vi.mocked(prisma.site.findFirst).mockResolvedValue({ id: "site-1" } as never);
    vi.mocked(prisma.audit.findFirst).mockResolvedValue({
      scoreOverall: 78,
      scoreTechnical: 70,
      scorePerformance: 82,
      date: new Date(),
    } as never);
    vi.mocked(prisma.keyword.findMany).mockResolvedValue([
      {
        term: "harina industrial",
        rankings: [{ date: new Date(), position: 5 }],
      },
    ] as never);
    vi.mocked(prisma.insight.findMany).mockResolvedValue([]);
    vi.mocked(prisma.insight.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.insight.createMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.apiUsage.create).mockResolvedValue({} as never);

    mockAnthropicCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify([
            {
              type: "opportunity",
              severity: "medium",
              title: "Keyword 'harina industrial' puede subir a top 3",
              description: "La keyword está en posición 5, con oportunidad de CTR mayor.",
              action: "Optimizar el H1 y meta description de /productos/harina",
              affectedKeywords: ["harina industrial"],
              affectedUrls: ["/productos/harina"],
            },
          ]),
        },
      ],
      usage: { input_tokens: 500, output_tokens: 150, cache_read_input_tokens: 400 },
    });

    const { runInsightsProcessor } = await import("../processors/insights-processor");
    const result = await runInsightsProcessor({ clientId: "client-1", trigger: "scheduled" });

    expect(result.insightsGenerated).toBe(1);
    expect(result.skippedDuplicate).toBe(0);
    expect(result.cost).toBeGreaterThan(0);
    expect(result.tokensUsed.cached).toBe(400);
    expect(prisma.insight.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ clientId: "client-1", type: "OPPORTUNITY" }),
        ]),
      })
    );
  });

  it("Claude devuelve JSON inválido → 0 insights, no crashea", async () => {
    const { prisma } = await import("@/lib/db");

    mockRedis.exists.mockResolvedValue(0);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue("OK");

    vi.mocked(prisma.client.findUniqueOrThrow).mockResolvedValue({
      id: "client-2",
      name: "Test",
      domain: "test.mx",
      cycles: [],
      keywords: [{ term: "keyword-a", targetUrl: null }],
      competitors: [],
      insights: [],
    } as never);

    vi.mocked(prisma.site.findFirst).mockResolvedValue({ id: "site-2" } as never);
    vi.mocked(prisma.audit.findFirst).mockResolvedValue({
      scoreOverall: 80,
      scoreTechnical: 75,
      scorePerformance: 85,
      date: new Date(),
    } as never);
    vi.mocked(prisma.keyword.findMany).mockResolvedValue([
      { term: "keyword-a", rankings: [{ date: new Date(), position: 10 }] },
    ] as never);
    vi.mocked(prisma.insight.findMany).mockResolvedValue([]);
    vi.mocked(prisma.insight.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.insight.createMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.apiUsage.create).mockResolvedValue({} as never);

    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "No puedo generar insights en este momento." }],
      usage: { input_tokens: 200, output_tokens: 10, cache_read_input_tokens: 0 },
    });

    const { runInsightsProcessor } = await import("../processors/insights-processor");
    const result = await runInsightsProcessor({ clientId: "client-2", trigger: "scheduled" });

    expect(result.insightsGenerated).toBe(0);
    expect(result.cost).toBeGreaterThanOrEqual(0);
    // No debe haber creado insights
    expect(prisma.insight.createMany).not.toHaveBeenCalled();
  });

  it("0 keywords y sin audit → crea insight INFO sin llamar a Claude (costo $0)", async () => {
    const { prisma } = await import("@/lib/db");

    mockRedis.exists.mockResolvedValue(0);
    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue("OK");

    vi.mocked(prisma.client.findUniqueOrThrow).mockResolvedValue({
      id: "client-3",
      name: "Sin datos",
      domain: "sindatos.mx",
      cycles: [],
      keywords: [],
      competitors: [],
      insights: [],
    } as never);

    vi.mocked(prisma.site.findFirst).mockResolvedValue({ id: "site-3" } as never);
    vi.mocked(prisma.audit.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.keyword.findMany).mockResolvedValue([]);
    vi.mocked(prisma.insight.findMany).mockResolvedValue([]);
    vi.mocked(prisma.insight.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.insight.create).mockResolvedValue({} as never);
    vi.mocked(prisma.apiUsage.create).mockResolvedValue({} as never);

    const { runInsightsProcessor } = await import("../processors/insights-processor");
    const result = await runInsightsProcessor({ clientId: "client-3", trigger: "scheduled" });

    // No debe llamar a Claude
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    // Crea 1 insight informativo sin costo
    expect(result.insightsGenerated).toBe(1);
    expect(result.cost).toBe(0);
    expect(result.tokensUsed.input).toBe(0);
  });
});
