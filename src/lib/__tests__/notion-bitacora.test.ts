import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendBitacoraEntry } from "../notion-bitacora";

describe("sendBitacoraEntry", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      CEREBRO_API_URL: "https://cerebro.test",
      CEREBRO_INTERNAL_SECRET: "test-secret",
    };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("sends POST to Cerebro web with correct auth and body", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ ok: true, data: { id: "abc" } }), { status: 200 });
    }));

    const result = await sendBitacoraEntry({
      clienteId: "12345678-1234-1234-1234-123456789abc",
      clienteNombre: "Quicsa",
      actividad: "Plan 2026-10: Blog publicado",
      area: "Contenido",
      resultadoObtenido: "Artículo en /blog/cctv-empresas",
      impacto: "Alto",
    });

    expect(result).toBe(true);
    expect(capturedUrl).toBe("https://cerebro.test/api/internal/bitacora");
    expect(capturedInit?.method).toBe("POST");

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-secret");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(capturedInit?.body as string);
    expect(body.clienteId).toBe("12345678-1234-1234-1234-123456789abc");
    expect(body.clienteNombre).toBe("Quicsa");
    expect(body.actividad).toBe("Plan 2026-10: Blog publicado");
    expect(body.area).toBe("Contenido");
    expect(body.impacto).toBe("Alto");
  });

  it("returns false on HTTP error without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      return new Response("Internal error", { status: 500 });
    }));

    const result = await sendBitacoraEntry({
      clienteId: "id",
      clienteNombre: "Test",
      actividad: "Test",
      area: "SEO",
    });

    expect(result).toBe(false);
  });

  it("returns false on network error without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }));

    const result = await sendBitacoraEntry({
      clienteId: "id",
      clienteNombre: "Test",
      actividad: "Test",
      area: "SEO",
    });

    expect(result).toBe(false);
  });

  it("sends without auth header when CEREBRO_INTERNAL_SECRET not set", async () => {
    delete process.env.CEREBRO_INTERNAL_SECRET;
    let capturedHeaders: Record<string, string> = {};

    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));

    await sendBitacoraEntry({
      clienteId: "id",
      clienteNombre: "Test",
      actividad: "Test",
      area: "SEO",
    });

    expect(capturedHeaders["Authorization"]).toBeUndefined();
  });
});

describe("toNotionUuid", () => {
  // Test the UUID conversion logic (inline since it's private)
  function toNotionUuid(id: string): string {
    if (id.includes("-")) return id;
    return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
  }

  it("converts 32-char ID to UUID format", () => {
    expect(toNotionUuid("e489c63e4edf4820aa731e59f6f99944")).toBe(
      "e489c63e-4edf-4820-aa73-1e59f6f99944"
    );
  });

  it("passes through already-formatted UUID", () => {
    expect(toNotionUuid("e489c63e-4edf-4820-aa73-1e59f6f99944")).toBe(
      "e489c63e-4edf-4820-aa73-1e59f6f99944"
    );
  });
});
