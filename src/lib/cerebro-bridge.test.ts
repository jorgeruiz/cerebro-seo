import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock process.env
const originalEnv = process.env;

beforeEach(() => {
  vi.resetAllMocks();
  process.env = {
    ...originalEnv,
    CEREBRO_API_URL: "http://cerebro.test",
    CEREBRO_INTERNAL_SECRET: "test-secret-abc",
  };
});

afterEach(() => {
  process.env = originalEnv;
});

describe("cerebro-bridge", () => {
  it("fetchClientsFromCerebro: happy path devuelve clientes del array", async () => {
    const clients = [
      { id: "notion-1", name: "Molino Azteca", domain: "molinoazteca.com", status: "active", services: ["seo"] },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => clients,
    });

    const { fetchClientsFromCerebro } = await import("./cerebro-bridge");
    const result = await fetchClientsFromCerebro();

    expect(result).toEqual(clients);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://cerebro.test/api/internal/seo/clients",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-secret-abc",
        }),
      })
    );
  });

  it("5xx con retry exitoso: reintenta una vez y devuelve en el segundo intento", async () => {
    const clients = [{ id: "n2", name: "RFN", domain: "rfn.mx", status: "active", services: [] }];
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => clients });

    const { fetchClientsFromCerebro } = await import("./cerebro-bridge");
    const result = await fetchClientsFromCerebro();

    expect(result).toEqual(clients);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("404 (endpoint no existe todavía) → devuelve array vacío sin crashear", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });

    const { fetchClientsFromCerebro } = await import("./cerebro-bridge");
    const result = await fetchClientsFromCerebro();

    expect(result).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("network error (Cerebro caído) → devuelve array vacío sin crashear", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const { fetchClientsFromCerebro } = await import("./cerebro-bridge");
    const result = await fetchClientsFromCerebro();

    expect(result).toEqual([]);
  });

  it("fetchCurrentStrategy: 404 → devuelve null", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });

    const { fetchCurrentStrategy } = await import("./cerebro-bridge");
    const result = await fetchCurrentStrategy("notion-client-1");

    expect(result).toBeNull();
  });
});
