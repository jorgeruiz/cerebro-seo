import { describe, it, expect, vi, beforeEach } from "vitest";
import { probeAeo } from "../aeo-prober";

// ─── Global fetch mock ───────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockResponse(
  body: string,
  init?: { status?: number; headers?: Record<string, string> }
): Response {
  const { status = 200, headers = {} } = init ?? {};
  return new Response(body, {
    status,
    headers: new Headers({
      "content-type": "text/html; charset=utf-8",
      ...headers,
    }),
  });
}

function htmlPage(bodyContent: string, headExtra = ""): string {
  const words = "lorem ipsum dolor sit amet ".repeat(50); // ~250 words
  return `<!DOCTYPE html><html><head>${headExtra}</head><body><main>${words}${bodyContent}</main></body></html>`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("probeAeo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("robots.txt bloqueando GPTBot → fail con blockedBots", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      const u = typeof url === "string" ? url : (url as URL).toString();
      if (u.includes("/robots.txt")) {
        return mockResponse(
          "User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n",
          { headers: { "content-type": "text/plain" } }
        );
      }
      if (u.includes("/llms.txt")) return mockResponse("", { status: 404 });
      if (u.includes("/llms-full.txt")) return mockResponse("", { status: 404 });
      if (u.includes("/sitemap.xml")) return mockResponse("", { status: 200, headers: { "content-type": "application/xml" } });
      if (u.endsWith(".md")) return mockResponse("", { status: 404 });
      return mockResponse(htmlPage("content"));
    });

    const result = await probeAeo("example.com", []);

    expect(result.robotsAiBlocked.status).toBe("fail");
    expect(result.robotsAiBlocked.blockedBots).toContain("GPTBot");
    expect(result.robotsAiBlocked.blockedBots).toContain("ClaudeBot");
  });

  it("robots.txt limpio con Content-Signal → pass + content_signal pass", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      const u = typeof url === "string" ? url : (url as URL).toString();
      if (u.includes("/robots.txt")) {
        return mockResponse(
          "User-agent: *\nAllow: /\nContent-Signal: https://contentsignals.org\n",
          { headers: { "content-type": "text/plain" } }
        );
      }
      if (u.includes("/llms.txt")) return mockResponse("", { status: 404 });
      if (u.includes("/llms-full.txt")) return mockResponse("", { status: 404 });
      if (u.includes("/sitemap.xml")) return mockResponse("", { status: 200 });
      if (u.endsWith(".md")) return mockResponse("", { status: 404 });
      return mockResponse(htmlPage("content"));
    });

    const result = await probeAeo("example.com", []);

    expect(result.robotsAiBlocked.status).toBe("pass");
    expect(result.contentSignal.status).toBe("pass");
  });

  it("llms.txt válido → pass", async () => {
    const validLlms = `# My Site\n> A great site\n\n## Resources\n- [Docs](https://example.com/docs)\n`;

    mockFetch.mockImplementation(async (url: string) => {
      const u = typeof url === "string" ? url : (url as URL).toString();
      if (u.includes("/llms.txt")) {
        return mockResponse(validLlms, { headers: { "content-type": "text/plain" } });
      }
      if (u.includes("/robots.txt")) return mockResponse("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      if (u.includes("/llms-full.txt")) return mockResponse("", { status: 404 });
      if (u.includes("/sitemap.xml")) return mockResponse("", { status: 200 });
      if (u.endsWith(".md")) return mockResponse("", { status: 404 });
      return mockResponse(htmlPage("content"));
    });

    const result = await probeAeo("example.com", []);
    expect(result.llmsTxt.status).toBe("pass");
  });

  it("llms.txt inválido (sin estructura) → warn", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      const u = typeof url === "string" ? url : (url as URL).toString();
      if (u.includes("/llms.txt")) {
        return mockResponse("just some random text without structure", { headers: { "content-type": "text/plain" } });
      }
      if (u.includes("/robots.txt")) return mockResponse("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      if (u.includes("/llms-full.txt")) return mockResponse("", { status: 404 });
      if (u.includes("/sitemap.xml")) return mockResponse("", { status: 200 });
      if (u.endsWith(".md")) return mockResponse("", { status: 404 });
      return mockResponse(htmlPage("content"));
    });

    const result = await probeAeo("example.com", []);
    expect(result.llmsTxt.status).toBe("warn");
  });

  it("content negotiation responde markdown → pass", async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = typeof url === "string" ? url : (url as URL).toString();
      if (u.includes("/robots.txt")) return mockResponse("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      if (u.includes("/llms.txt")) return mockResponse("", { status: 404 });
      if (u.includes("/llms-full.txt")) return mockResponse("", { status: 404 });
      if (u.includes("/sitemap.xml")) return mockResponse("", { status: 200 });
      if (u.endsWith(".md")) return mockResponse("# Page", { headers: { "content-type": "text/markdown" } });

      const acceptHeader = (init?.headers as Record<string, string>)?.Accept ?? "";
      if (acceptHeader.includes("text/markdown")) {
        return mockResponse("# Page content", {
          headers: { "content-type": "text/markdown", vary: "Accept" },
        });
      }

      return mockResponse(htmlPage("content"));
    });

    const result = await probeAeo("example.com", []);
    expect(result.contentNegotiation.status).toBe("pass");
    expect(result.mdRoute.status).toBe("pass");
  });

  it("content negotiation ignora Accept → fail", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      const u = typeof url === "string" ? url : (url as URL).toString();
      if (u.includes("/robots.txt")) return mockResponse("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      if (u.includes("/llms.txt")) return mockResponse("", { status: 404 });
      if (u.includes("/llms-full.txt")) return mockResponse("", { status: 404 });
      if (u.includes("/sitemap.xml")) return mockResponse("", { status: 200 });
      if (u.endsWith(".md")) return mockResponse("", { status: 404 });
      // Always returns HTML regardless of Accept header
      return mockResponse(htmlPage("content"));
    });

    const result = await probeAeo("example.com", []);
    expect(result.contentNegotiation.status).toBe("fail");
  });

  it("HTML client-side (< 200 words + many scripts) → ssr_content fail", async () => {
    const csrHtml = `<!DOCTYPE html><html><head></head><body>
      <div id="root"></div>
      <script src="/a.js"></script><script src="/b.js"></script>
      <script src="/c.js"></script><script src="/d.js"></script>
    </body></html>`;

    mockFetch.mockImplementation(async (url: string) => {
      const u = typeof url === "string" ? url : (url as URL).toString();
      if (u.includes("/robots.txt")) return mockResponse("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      if (u.includes("/llms.txt")) return mockResponse("", { status: 404 });
      if (u.includes("/llms-full.txt")) return mockResponse("", { status: 404 });
      if (u.includes("/sitemap.xml")) return mockResponse("", { status: 200 });
      if (u.endsWith(".md")) return mockResponse("", { status: 404 });
      return mockResponse(csrHtml);
    });

    const result = await probeAeo("example.com", []);
    expect(result.ssrContent.status).toBe("fail");
    expect(result.ssrContent.wordCount).toBeLessThan(200);
    expect(result.ssrContent.scriptCount).toBeGreaterThan(3);
  });

  it("fetch failure no tumba la probe — devuelve skipped/warn", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const result = await probeAeo("example.com", []);

    // Should not throw — all checks should be skipped/warn/fail gracefully
    expect(result).toBeDefined();
    expect(result.robotsAiBlocked.status).toBe("warn");
  });

  it("sampleUrls se limitan a 3", async () => {
    const urls = [
      "https://example.com/page-alpha",
      "https://example.com/page-beta",
      "https://example.com/page-gamma",
      "https://example.com/page-delta",
      "https://example.com/page-epsilon",
    ];

    mockFetch.mockImplementation(async (url: string) => {
      const u = typeof url === "string" ? url : (url as URL).toString();
      if (u.includes("/robots.txt")) return mockResponse("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
      if (u.includes("/llms.txt")) return mockResponse("", { status: 404 });
      if (u.includes("/llms-full.txt")) return mockResponse("", { status: 404 });
      if (u.includes("/sitemap.xml")) return mockResponse("", { status: 200 });
      if (u.endsWith(".md")) return mockResponse("", { status: 404 });
      return mockResponse(htmlPage("content"));
    });

    await probeAeo("example.com", urls);

    // URLs /page-delta and /page-epsilon should NOT generate fetches (only first 3 sampleUrls)
    const fetchedUrls = mockFetch.mock.calls.map((c) => c[0] as string);
    expect(fetchedUrls.filter((u) => u.includes("page-delta"))).toHaveLength(0);
    expect(fetchedUrls.filter((u) => u.includes("page-epsilon"))).toHaveLength(0);
    // But the first 3 should have fetches
    expect(fetchedUrls.filter((u) => u.includes("page-alpha")).length).toBeGreaterThan(0);
    expect(fetchedUrls.filter((u) => u.includes("page-gamma")).length).toBeGreaterThan(0);
  });
});
