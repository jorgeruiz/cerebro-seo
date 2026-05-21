import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock env
vi.stubEnv("SEO_INTERNAL_SECRET", "valid-seo-secret-xyz");

// Mock prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    client: {
      findFirst: vi.fn(),
    },
    monthlyCycle: {
      findFirst: vi.fn(),
    },
    insight: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

function makeRequest(authorization: string | null, yearMonth = "2026-05"): NextRequest {
  const url = `http://localhost/api/internal/cerebro/clients/test-id/monthly-summary?yearMonth=${yearMonth}`;
  const headers: HeadersInit = authorization ? { Authorization: authorization } : {};
  return new NextRequest(url, { headers });
}

describe("GET /api/internal/cerebro/clients/[id]/monthly-summary", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("header válido + cliente existe → 200 con JSON estructura correcta", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.client.findFirst).mockResolvedValue({
      id: "local-1", cerebroClientId: "test-id",
      sites: [{ gscProperty: null, ga4Property: null }],
    } as ReturnType<typeof prisma.client.findFirst> extends Promise<infer T> ? T : never);
    vi.mocked(prisma.monthlyCycle.findFirst).mockResolvedValue(null);

    const { GET } = await import("./route");
    const req = makeRequest("Bearer valid-seo-secret-xyz");
    const res = await GET(req, { params: { id: "test-id" } });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("yearMonth", "2026-05");
    expect(body).toHaveProperty("metrics");
    expect(body).toHaveProperty("hypothesesResults");
    expect(body).toHaveProperty("tasksCompleted");
    expect(body).toHaveProperty("criticalIssues");
  });

  it("header inválido → 401", async () => {
    const { GET } = await import("./route");
    const req = makeRequest("Bearer wrong-secret");
    const res = await GET(req, { params: { id: "test-id" } });

    expect(res.status).toBe(401);
  });

  it("sin header → 401", async () => {
    const { GET } = await import("./route");
    const req = makeRequest(null);
    const res = await GET(req, { params: { id: "test-id" } });

    expect(res.status).toBe(401);
  });

  it("clientId no existe → 404", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.client.findFirst).mockResolvedValue(null);

    const { GET } = await import("./route");
    const req = makeRequest("Bearer valid-seo-secret-xyz");
    const res = await GET(req, { params: { id: "nonexistent-id" } });

    expect(res.status).toBe(404);
  });
});
