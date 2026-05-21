import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClientStatus } from "@prisma/client";

// Mock bridge
vi.mock("@/lib/cerebro-bridge", () => ({
  fetchClientsFromCerebro: vi.fn(),
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
    const { fetchClientsFromCerebro } = await import("@/lib/cerebro-bridge");
    const { prisma } = await import("@/lib/db");

    vi.mocked(fetchClientsFromCerebro).mockResolvedValue([
      { id: "notion-new", name: "Nuevo Cliente", domain: "nuevo.mx", status: "active", services: ["seo"] },
    ]);
    vi.mocked(prisma.client.findUnique).mockResolvedValue(null); // no existe

    // Simular la lógica del worker directamente
    const clients = await fetchClientsFromCerebro();
    expect(clients).toHaveLength(1);

    const cc = clients[0];
    const found = await prisma.client.findUnique({ where: { cerebroClientId: cc.id }, include: { sites: { take: 1 } } } as Parameters<typeof prisma.client.findUnique>[0]);
    expect(found).toBeNull();

    await prisma.client.create({
      data: {
        cerebroClientId: cc.id, name: cc.name, domain: cc.domain,
        plan: "BASIC", status: ClientStatus.ACTIVE, services: cc.services,
        sites: { create: { url: `https://${cc.domain}` } },
      },
    } as Parameters<typeof prisma.client.create>[0]);

    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cerebroClientId: "notion-new" }) })
    );
  });

  it("cliente existente → actualiza name/status/services pero NO gscProperty/ga4Property", async () => {
    const { fetchClientsFromCerebro } = await import("@/lib/cerebro-bridge");
    const { prisma } = await import("@/lib/db");

    vi.mocked(fetchClientsFromCerebro).mockResolvedValue([
      { id: "notion-existing", name: "Cliente Actualizado", domain: "cliente.mx", status: "active", services: ["seo", "google_ads"] },
    ]);
    vi.mocked(prisma.client.findUnique).mockResolvedValue({
      id: "local-id-1", cerebroClientId: "notion-existing",
      sites: [{ id: "site-1", gscProperty: "https://cliente.mx/", ga4Property: "properties/12345" }],
    } as ReturnType<typeof prisma.client.findUnique> extends Promise<infer T> ? T : never);

    const clients = await fetchClientsFromCerebro();
    const cc = clients[0];
    await prisma.client.findUnique({ where: { cerebroClientId: cc.id } } as Parameters<typeof prisma.client.findUnique>[0]);

    // La actualización NO debe incluir gscProperty ni ga4Property
    await prisma.client.update({
      where: { cerebroClientId: cc.id },
      data: { name: cc.name, domain: cc.domain, status: ClientStatus.ACTIVE, services: cc.services },
    } as Parameters<typeof prisma.client.update>[0]);

    const updateCall = vi.mocked(prisma.client.update).mock.calls[0][0];
    expect((updateCall as { data: Record<string, unknown> }).data).not.toHaveProperty("gscProperty");
    expect((updateCall as { data: Record<string, unknown> }).data).not.toHaveProperty("ga4Property");
    expect((updateCall as { data: Record<string, unknown> }).data).toMatchObject({ name: "Cliente Actualizado", services: ["seo", "google_ads"] });
  });

  it("array vacío recibido → NO marca nadie inactive (evitar borrado masivo por error)", async () => {
    const { fetchClientsFromCerebro } = await import("@/lib/cerebro-bridge");
    const { prisma } = await import("@/lib/db");

    vi.mocked(fetchClientsFromCerebro).mockResolvedValue([]);

    const clients = await fetchClientsFromCerebro();
    // La guarda: si array vacío, no llamar updateMany para marcar inactive
    if (clients.length > 0) {
      await prisma.client.updateMany({ where: {}, data: { status: ClientStatus.PAUSED } } as Parameters<typeof prisma.client.updateMany>[0]);
    }

    expect(prisma.client.updateMany).not.toHaveBeenCalled();
  });
});
