import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks -------------------------------------------------------------------

const mockGetSession = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  client: { findUnique: vi.fn() },
  clientUser: { findFirst: vi.fn() },
  monthlyPlan: { findFirst: vi.fn() },
  agentConversation: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  agentMessage: { create: vi.fn(), findMany: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ getSession: mockGetSession }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

// --- Helpers -----------------------------------------------------------------

function makeSession(role: "ADMIN" | "EDITOR", email = "test@clicksociety.mx") {
  return { user: { id: "user-1", email, role } };
}

function makeClient(platform = "NEXTJS", githubRepo = "org/repo") {
  return {
    id: "client-1",
    cerebroClientId: "abc123def456abc123def456abc123de",
    name: "Test Client",
    domain: "test.com",
    sites: [{ platform, githubRepo, url: "https://test.com" }],
  };
}

// --- Tests -------------------------------------------------------------------

describe("POST /api/agent-chat/conversations", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../conversations/route");
    POST = mod.POST;
  });

  it("returns 401 if not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const req = new Request("http://localhost/api/agent-chat/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: "client-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 for EDITOR without ClientUser access", async () => {
    mockGetSession.mockResolvedValue(makeSession("EDITOR"));
    mockPrisma.client.findUnique.mockResolvedValue(makeClient());
    mockPrisma.clientUser.findFirst.mockResolvedValue(null);

    const req = new Request("http://localhost/api/agent-chat/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: "client-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("ADMIN passes without ClientUser", async () => {
    mockGetSession.mockResolvedValue(makeSession("ADMIN"));
    mockPrisma.client.findUnique.mockResolvedValue(makeClient());
    mockPrisma.monthlyPlan.findFirst.mockResolvedValue({ id: "plan-1" });
    mockPrisma.agentConversation.create.mockResolvedValue({
      id: "conv-1",
      clientId: "client-1",
      status: "OPEN",
      createdAt: new Date(),
    });

    const req = new Request("http://localhost/api/agent-chat/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: "client-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe("conv-1");
  });

  it("returns 403 for WordPress client", async () => {
    mockGetSession.mockResolvedValue(makeSession("ADMIN"));
    mockPrisma.client.findUnique.mockResolvedValue(makeClient("WORDPRESS", "org/repo"));

    const req = new Request("http://localhost/api/agent-chat/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: "client-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("Next.js");
  });

  it("returns 403 for MIGRACION client", async () => {
    mockGetSession.mockResolvedValue(makeSession("ADMIN"));
    mockPrisma.client.findUnique.mockResolvedValue(makeClient("MIGRACION", "org/repo"));

    const req = new Request("http://localhost/api/agent-chat/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: "client-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 403 if no githubRepo", async () => {
    mockGetSession.mockResolvedValue(makeSession("ADMIN"));
    mockPrisma.client.findUnique.mockResolvedValue(makeClient("NEXTJS", null as unknown as string));

    const req = new Request("http://localhost/api/agent-chat/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: "client-1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("repositorio");
  });
});

describe("submit_change_request tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves constructorCrId/Code and updates status on submit", async () => {
    // Mock fetch for Constructor
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "cr-123", request_code: "SOL-2026-11-001" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    // Set env
    vi.stubEnv("CONSTRUCTOR_URL", "https://constructor.test");
    vi.stubEnv("CONSTRUCTOR_INTERNAL_SECRET", "test-secret");

    mockPrisma.agentConversation.update.mockResolvedValue({});

    const { executeTool } = await import("@/lib/agent-chat/tools");

    const ctx = {
      notionClientId: "abc123",
      clientId: "client-1",
      clientName: "Test",
      conversationId: "conv-1",
      pendingSummary: {
        items: [
          { section: "Hero", change_type: "text_update", description: "Change title" },
        ],
        version: 1,
      },
    };

    const result = await executeTool("submit_change_request", { confirmed: true }, ctx);
    const parsed = JSON.parse(result);

    expect(parsed.type).toBe("change_request_created");
    expect(parsed.request_code).toBe("SOL-2026-11-001");

    // Verify Prisma update was called
    expect(mockPrisma.agentConversation.update).toHaveBeenCalledWith({
      where: { id: "conv-1" },
      data: {
        constructorCrId: "cr-123",
        constructorCrCode: "SOL-2026-11-001",
        status: "SUBMITTED",
      },
    });

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
