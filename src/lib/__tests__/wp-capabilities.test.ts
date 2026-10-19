/**
 * Contract tests for getWpCapabilities normalization.
 * Verifies that both v1.5.0 and v1.6.0 plugin response formats are handled
 * correctly without crashing, and that the cache re-normalizes stale entries.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Set env vars and mock redis BEFORE module import ─────────────────────────
const { mockRedisGet, mockRedisSetex } = vi.hoisted(() => {
  process.env.CEREBRO_API_URL = "http://cerebro.test";
  process.env.WP_PROXY_SECRET = "test-secret";
  return {
    mockRedisGet: vi.fn(),
    mockRedisSetex: vi.fn(),
  };
});

vi.mock("@/lib/redis", () => ({
  redis: {
    get: mockRedisGet,
    setex: mockRedisSetex,
  },
}));

// ── Mock fetch (proxyCall) ────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Import subject under test ─────────────────────────────────────────────────
import { getWpCapabilities } from "@/lib/wp-proxy-client";

// Helper: make fetch return a proxy-style success response
function mockProxyResponse(data: unknown) {
  mockFetch.mockResolvedValueOnce({
    status: 200,
    json: async () => ({ ok: true, status: 200, data }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRedisGet.mockResolvedValue(null); // no cache by default
  mockRedisSetex.mockResolvedValue("OK");
});

// ─────────────────────────────────────────────────────────────────────────────

describe("getWpCapabilities — v1.6.0 format", () => {
  const v16Response = {
    ok: true,
    version: "1.6.1",
    endpoints: ["publish", "seo", "media", "update", "elementor/duplicate", "elementor/apply"],
    write_require_task_id: true,
    elementor_active: true,
    elementor_pro_active: false,
  };

  it("parses endpoints array correctly", async () => {
    mockProxyResponse(v16Response);
    const result = await getWpCapabilities("client-abc");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.endpoints).toEqual([
      "publish", "seo", "media", "update", "elementor/duplicate", "elementor/apply",
    ]);
    expect(result.data.write_require_task_id).toBe(true);
    expect(result.data.elementor_active).toBe(true);
  });

  it("caches normalized value", async () => {
    mockProxyResponse(v16Response);
    await getWpCapabilities("client-abc");
    expect(mockRedisSetex).toHaveBeenCalledOnce();
    const cached = JSON.parse(mockRedisSetex.mock.calls[0][2] as string);
    expect(Array.isArray(cached.endpoints)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("getWpCapabilities — v1.5.0 format", () => {
  const v15Response = {
    plugin_version: "1.5.0",
    api_namespace: "clicksociety/v1",
    capabilities: [
      { id: "publish", method: "POST", endpoint: "/publish" },
      { id: "seo",     method: "POST", endpoint: "/seo/{id}" },
      { id: "media",   method: "POST", endpoint: "/media" },
    ],
  };

  it("normalizes capabilities[].id → endpoints[]", async () => {
    mockProxyResponse(v15Response);
    const result = await getWpCapabilities("client-xyz");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.endpoints).toEqual(["publish", "seo", "media"]);
    expect(result.data.write_require_task_id).toBe(false);
    expect(result.data.elementor_active).toBe(false);
  });

  it("does NOT throw on endpoints.length (regression for DECOMPOSE_JOB_FAILED)", async () => {
    mockProxyResponse(v15Response);
    const result = await getWpCapabilities("client-xyz");
    if (!result.ok) throw new Error("Expected ok");
    // This was the crashing line in task-decomposer.ts:219
    expect(() => result.data.endpoints.length).not.toThrow();
    expect(result.data.endpoints.length).toBeGreaterThan(0);
  });

  it("caches normalized value (not raw v1.5.0 object)", async () => {
    mockProxyResponse(v15Response);
    await getWpCapabilities("client-xyz");
    expect(mockRedisSetex).toHaveBeenCalledOnce();
    const cached = JSON.parse(mockRedisSetex.mock.calls[0][2] as string);
    expect(Array.isArray(cached.endpoints)).toBe(true);
    expect(cached).not.toHaveProperty("capabilities");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("getWpCapabilities — stale cache with raw v1.5.0 (re-normalize)", () => {
  it("re-normalizes cache entry that has capabilities[] instead of endpoints[]", async () => {
    const staleCache = {
      plugin_version: "1.5.0",
      api_namespace: "clicksociety/v1",
      capabilities: [{ id: "publish" }, { id: "seo" }],
    };
    mockRedisGet.mockResolvedValue(JSON.stringify(staleCache));

    const result = await getWpCapabilities("client-stale");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.endpoints).toEqual(["publish", "seo"]);
    // Should have re-cached the normalized form
    expect(mockRedisSetex).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("getWpCapabilities — unknown/malformed format", () => {
  it("returns endpoints:[] without throwing", async () => {
    mockProxyResponse({ something_weird: true, data: 42 });
    const result = await getWpCapabilities("client-broken");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.endpoints).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("getWpCapabilities — proxy error", () => {
  it("returns ok:false without crashing", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      json: async () => ({ ok: false, error: "sitio no encontrado" }),
    });
    const result = await getWpCapabilities("client-down");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("sitio no encontrado");
  });
});
