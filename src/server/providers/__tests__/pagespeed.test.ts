import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runPageSpeed } from "../pagespeed";

// ─── Mock fetch ───────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const baseResponse = {
  id: "https://example.com/",
  lighthouseResult: {
    categories: {
      performance: { score: 0.82 },
      accessibility: { score: 0.95 },
      "best-practices": { score: 0.9 },
      seo: { score: 0.88 },
    },
    audits: {
      "largest-contentful-paint": { id: "largest-contentful-paint", title: "LCP", description: "...", score: 0.7, displayValue: "2.1 s" },
      "first-contentful-paint": { id: "first-contentful-paint", title: "FCP", description: "...", score: 0.8, displayValue: "1.2 s" },
      "cumulative-layout-shift": { id: "cumulative-layout-shift", title: "CLS", description: "...", score: 0.9, displayValue: "0.05" },
      "total-blocking-time": { id: "total-blocking-time", title: "TBT", description: "...", score: 0.85, displayValue: "120 ms" },
      "server-response-time": { id: "server-response-time", title: "TTFB", description: "...", score: 0.8, displayValue: "0.3 s" },
      "render-blocking-resources": { id: "render-blocking-resources", title: "Eliminar recursos que bloquean el renderizado", description: "Desc.", score: 0.4, displayValue: "0.5 s" },
      "unused-javascript": { id: "unused-javascript", title: "Eliminar JavaScript no utilizado", description: "Desc.", score: 0.3, displayValue: "120 KiB" },
    },
  },
  loadingExperience: {
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100, category: "AVERAGE" },
      INTERACTION_TO_NEXT_PAINT: { percentile: 150, category: "GOOD" },
    },
  },
};

function mockOkResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
    status: 200,
  });
}

describe("runPageSpeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockImplementation(() => mockOkResponse(baseResponse));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retorna scores correctos (0-100)", async () => {
    const result = await runPageSpeed("https://example.com", "mobile");

    expect(result.scores.performance).toBe(82);
    expect(result.scores.accessibility).toBe(95);
    expect(result.scores.bestPractices).toBe(90);
    expect(result.scores.seo).toBe(88);
  });

  it("retorna CWV convertidos a ms cuando displayValue tiene ' s'", async () => {
    const result = await runPageSpeed("https://example.com", "mobile");

    // "2.1 s" → 2100ms
    expect(result.cwv.lcp).toBe(2100);
    // "1.2 s" → 1200ms
    expect(result.cwv.fcp).toBe(1200);
  });

  it("CWV de loadingExperience sobreescribe los de lighthouse", async () => {
    const result = await runPageSpeed("https://example.com", "mobile");

    // loadingExperience.LCP = 2100
    expect(result.cwv.lcp).toBe(2100);
    // INP de loadingExperience
    expect(result.cwv.inp).toBe(150);
  });

  it("extrae oportunidades con score < 0.9", async () => {
    const result = await runPageSpeed("https://example.com", "mobile");

    const ids = result.opportunities.map((o) => o.id);
    expect(ids).toContain("render-blocking-resources");
    expect(ids).toContain("unused-javascript");
  });

  it("incluye url y strategy en el resultado", async () => {
    const result = await runPageSpeed("https://example.com", "desktop");

    expect(result.url).toBe("https://example.com");
    expect(result.strategy).toBe("desktop");
    expect(result.fetchedAt).toBeInstanceOf(Date);
  });

  it("lanza error si la API responde !ok", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve("Rate limit exceeded"),
    });

    await expect(runPageSpeed("https://example.com")).rejects.toThrow("429");
  });

  it("incluye API key en la URL si GOOGLE_PAGESPEED_API_KEY está definida", async () => {
    process.env.GOOGLE_PAGESPEED_API_KEY = "test-key-123";

    mockFetch.mockImplementation(() => mockOkResponse(baseResponse));
    await runPageSpeed("https://example.com", "mobile");

    const callUrl = mockFetch.mock.calls[0][0] as string;
    expect(callUrl).toContain("key=test-key-123");

    delete process.env.GOOGLE_PAGESPEED_API_KEY;
  });
});
