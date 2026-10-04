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

// UUID hex válido de 32 chars para pasar validateNotionClientId
const VALID_NOTION_ID = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";

function makeRequest(authorization: string | null, yearMonth = "2026-05"): NextRequest {
  const url = `http://localhost/api/internal/cerebro/clients/${VALID_NOTION_ID}/monthly-summary?yearMonth=${yearMonth}`;
  const headers: HeadersInit = authorization ? { Authorization: authorization } : {};
  return new NextRequest(url, { headers });
}

describe("GET /api/internal/cerebro/clients/[id]/monthly-summary", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("header válido + cliente existe → 200 con JSON estructura correcta", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.client.findFirst).mockResolvedValue({
      id: "local-1", cerebroClientId: VALID_NOTION_ID,
      sites: [{ gscProperty: null, ga4Property: null }],
    } as ReturnType<typeof prisma.client.findFirst> extends Promise<infer T> ? T : never);
    vi.mocked(prisma.monthlyCycle.findFirst).mockResolvedValue(null);

    const { GET } = await import("./route");
    const req = makeRequest("Bearer valid-seo-secret-xyz");
    const res = await GET(req, { params: { id: VALID_NOTION_ID } });

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
    const res = await GET(req, { params: { id: VALID_NOTION_ID } });

    expect(res.status).toBe(401);
  });

  it("sin header → 401", async () => {
    const { GET } = await import("./route");
    const req = makeRequest(null);
    const res = await GET(req, { params: { id: VALID_NOTION_ID } });

    expect(res.status).toBe(401);
  });

  it("clientId no existe → 404", async () => {
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.client.findFirst).mockResolvedValue(null);

    const { GET } = await import("./route");
    const req = makeRequest("Bearer valid-seo-secret-xyz");
    // Usar un UUID hex válido (32 chars) que pase validateNotionClientId pero no exista en BD
    const res = await GET(req, { params: { id: "00000000000000000000000000000000" } });

    expect(res.status).toBe(404);
  });
});
