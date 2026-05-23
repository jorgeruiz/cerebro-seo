import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const mockQueueAdd = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "job-1" }));
const mockQueueGetJob = vi.hoisted(() => vi.fn().mockResolvedValue(null));

// ── vi.mock declarations ─────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: {
    client: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/redis", () => ({
  redisBullMQ: {},
  redis: {},
}));

// Mock queues directamente para evitar que BullMQ intente conectar a Redis
vi.mock("@/server/jobs/queues", () => ({
  dataCollectionQueue: { add: mockQueueAdd, getJob: mockQueueGetJob },
  aiAnalysisQueue: { add: mockQueueAdd, getJob: mockQueueGetJob },
  syncQueue: { add: mockQueueAdd, getJob: mockQueueGetJob },
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("schedulers — pilot filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueueAdd.mockResolvedValue({ id: "job-1" });
    mockQueueGetJob.mockResolvedValue(null);
  });

  it("sin INSIGHTS_PILOT_CLIENT_IDS → registra insights para todos los clientes SEO", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.client.findMany).mockResolvedValue([
      { id: "client-1", domain: "a.mx", services: ["seo"] },
      { id: "client-2", domain: "b.mx", services: ["seo"] },
    ] as never);

    delete process.env.INSIGHTS_PILOT_CLIENT_IDS;

    // Re-mock env con pilotIds undefined
    vi.doMock("@/env", () => ({
      env: {
        INSIGHTS_PILOT_CLIENT_IDS: undefined,
        NODE_ENV: "test",
      },
    }));

    const { initSchedulers } = await import("./schedulers");
    await initSchedulers();

    const insightsCalls = mockQueueAdd.mock.calls.filter(
      ([name]: [string]) => name === "insights:generate"
    );
    expect(insightsCalls).toHaveLength(2);
    const clientIds = insightsCalls.map(([, data]: [string, { clientId: string }]) => data.clientId);
    expect(clientIds).toContain("client-1");
    expect(clientIds).toContain("client-2");
  });

  it("con INSIGHTS_PILOT_CLIENT_IDS → solo registra insights para IDs del piloto", async () => {
    vi.resetModules();

    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.client.findMany).mockResolvedValue([
      { id: "client-1", domain: "a.mx", services: ["seo"] },
      { id: "client-2", domain: "b.mx", services: ["seo"] },
      { id: "client-3", domain: "c.mx", services: ["seo"] },
    ] as never);

    vi.doMock("@/env", () => ({
      env: {
        INSIGHTS_PILOT_CLIENT_IDS: "client-1,client-3",
        NODE_ENV: "test",
      },
    }));

    const { initSchedulers } = await import("./schedulers");
    await initSchedulers();

    const insightsCalls = mockQueueAdd.mock.calls.filter(
      ([name]: [string]) => name === "insights:generate"
    );
    expect(insightsCalls).toHaveLength(2);
    const clientIds = insightsCalls.map(([, data]: [string, { clientId: string }]) => data.clientId);
    expect(clientIds).toContain("client-1");
    expect(clientIds).toContain("client-3");
    expect(clientIds).not.toContain("client-2");
  });

  it("INSIGHTS_PILOT_CLIENT_IDS vacío → todos los clientes SEO reciben insights", async () => {
    vi.resetModules();

    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.client.findMany).mockResolvedValue([
      { id: "client-1", domain: "a.mx", services: ["seo"] },
      { id: "client-2", domain: "b.mx", services: ["seo"] },
    ] as never);

    vi.doMock("@/env", () => ({
      env: {
        INSIGHTS_PILOT_CLIENT_IDS: "",
        NODE_ENV: "test",
      },
    }));

    const { initSchedulers } = await import("./schedulers");
    await initSchedulers();

    const insightsCalls = mockQueueAdd.mock.calls.filter(
      ([name]: [string]) => name === "insights:generate"
    );
    expect(insightsCalls).toHaveLength(2);
  });

  it("jobId de insights es determinístico — formato insights:<clientId>", async () => {
    vi.resetModules();

    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.client.findMany).mockResolvedValue([
      { id: "client-xyz", domain: "xyz.mx", services: ["seo"] },
    ] as never);

    vi.doMock("@/env", () => ({
      env: {
        INSIGHTS_PILOT_CLIENT_IDS: undefined,
        NODE_ENV: "test",
      },
    }));

    const { initSchedulers } = await import("./schedulers");
    await initSchedulers();

    const insightsCall = mockQueueAdd.mock.calls.find(
      ([name]: [string]) => name === "insights:generate"
    );
    expect(insightsCall).toBeDefined();
    const opts = insightsCall![2] as { jobId?: string };
    expect(opts?.jobId).toBe("insights:client-xyz");
  });
});
