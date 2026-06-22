import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClientStatus } from "@prisma/client";

// Mock notion-direct
vi.mock("@/lib/notion-direct", () => ({
  getClientsFromNotion: vi.fn(),
}));

// Mock prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    client: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    jobLog: {
      create: vi.fn(),
    },
  },
}));

// Mock redis (para Worker de BullMQ)
vi.mock("@/lib/redis", () => ({
  redisBullMQ: { options: {} },
}));

// Mock bullmq Worker — no lo arrancamos realmente
vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
  })),
}));

describe("cerebro-sync-worker logic", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("cliente nuevo → se crea con Site asociado", async () => {
    const { getClientsFromNotion } = await import("@/lib/notion-direct");
    const { prisma } = await import("@/lib/db");

    vi.mocked(getClientsFromNotion).mockResolvedValue([
      { notionPageId: "abc123", name: "Nuevo Cliente", domain: "nuevo.mx", estado: "Activo", gscProperty: null, ga4PropertyId: null, services: ["seo"] },
    ]);
    vi.mocked(prisma.client.findUnique).mockResolvedValue(null);

    const clients = await getClientsFromNotion();
    expect(clients).toHaveLength(1);

    const nc = clients[0];
    const found = await prisma.client.findUnique({ where: { cerebroClientId: nc.notionPageId }, include: { sites: { take: 1 } } } as Parameters<typeof prisma.client.findUnique>[0]);
    expect(found).toBeNull();

    await prisma.client.create({
      data: {
        cerebroClientId: nc.notionPageId, name: nc.name, domain: nc.domain,
        plan: "BASIC", status: ClientStatus.ACTIVE, services: nc.services,
        sites: { create: { url: `https://${nc.domain}` } },
      },
    } as Parameters<typeof prisma.client.create>[0]);

    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cerebroClientId: "abc123" }) })
    );
  });

  it("cliente existente → actualiza name/status/services pero NO gscProperty/ga4Property", async () => {
    const { getClientsFromNotion } = await import("@/lib/notion-direct");
    const { prisma } = await import("@/lib/db");

    vi.mocked(getClientsFromNotion).mockResolvedValue([
      { notionPageId: "existing123", name: "Cliente Actualizado", domain: "cliente.mx", estado: "Activo", gscProperty: null, ga4PropertyId: null, services: ["seo", "google_ads"] },
    ]);
    vi.mocked(prisma.client.findUnique).mockResolvedValue({
      id: "local-id-1", cerebroClientId: "existing123",
      sites: [{ id: "site-1", gscProperty: "https://cliente.mx/", ga4Property: "properties/12345" }],
    } as ReturnType<typeof prisma.client.findUnique> extends Promise<infer T> ? T : never);

    const clients = await getClientsFromNotion();
    const nc = clients[0];
    await prisma.client.findUnique({ where: { cerebroClientId: nc.notionPageId } } as Parameters<typeof prisma.client.findUnique>[0]);

    await prisma.client.update({
      where: { cerebroClientId: nc.notionPageId },
      data: { name: nc.name, domain: nc.domain, status: ClientStatus.ACTIVE, services: nc.services },
    } as Parameters<typeof prisma.client.update>[0]);

    const updateCall = vi.mocked(prisma.client.update).mock.calls[0][0];
    expect((updateCall as { data: Record<string, unknown> }).data).not.toHaveProperty("gscProperty");
    expect((updateCall as { data: Record<string, unknown> }).data).not.toHaveProperty("ga4Property");
    expect((updateCall as { data: Record<string, unknown> }).data).toMatchObject({ name: "Cliente Actualizado", services: ["seo", "google_ads"] });
  });

  it("cliente En Pausa en Notion → status PAUSED en Cerebro SEO", async () => {
    const { getClientsFromNotion } = await import("@/lib/notion-direct");
    const { prisma } = await import("@/lib/db");

    vi.mocked(getClientsFromNotion).mockResolvedValue([
      { notionPageId: "paused456", name: "Cliente Pausado", domain: "pausado.mx", estado: "En Pausa", gscProperty: null, ga4PropertyId: null, services: ["seo"] },
    ]);
    vi.mocked(prisma.client.findUnique).mockResolvedValue(null);

    const clients = await getClientsFromNotion();
    const nc = clients[0];
    expect(nc.estado).toBe("En Pausa");

    await prisma.client.create({
      data: {
        cerebroClientId: nc.notionPageId, name: nc.name, domain: nc.domain,
        plan: "BASIC", status: ClientStatus.PAUSED, services: nc.services,
        sites: { create: { url: `https://${nc.domain}` } },
      },
    } as Parameters<typeof prisma.client.create>[0]);

    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: ClientStatus.PAUSED }) })
    );
  });

  it("array vacío recibido → NO marca nadie inactive (evitar borrado masivo por error)", async () => {
    const { getClientsFromNotion } = await import("@/lib/notion-direct");
    const { prisma } = await import("@/lib/db");

    vi.mocked(getClientsFromNotion).mockResolvedValue([]);

    const clients = await getClientsFromNotion();
    if (clients.length > 0) {
      await prisma.client.updateMany({ where: {}, data: { status: ClientStatus.PAUSED } } as Parameters<typeof prisma.client.updateMany>[0]);
    }

    expect(prisma.client.updateMany).not.toHaveBeenCalled();
  });
});
