import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the detection logic by mocking fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import after mocking
const { detectPlatform, isEligibleForExecution, ineligibilityReason } = await import("../site-platform");

function mockHtml(html: string, wpJsonOk = false) {
  mockFetch.mockImplementation(async (url: string) => {
    if (String(url).includes("/wp-json")) {
      if (wpJsonOk) return { ok: true, status: 200 };
      throw new Error("Not found");
    }
    return { ok: true, text: async () => html };
  });
}

describe("site-platform", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("detectPlatform", () => {
    it("detects Next.js via __NEXT_DATA__", async () => {
      mockHtml('<script id="__NEXT_DATA__" type="application/json">{}</script><link href="/_next/static/css/abc.css">');
      const result = await detectPlatform("https://example.com");
      expect(result.platform).toBe("NEXTJS");
      expect(result.confidence).toBe("high");
      expect(result.signals).toContain("next:__NEXT_DATA__");
    });

    it("detects Next.js via /_next/ only", async () => {
      mockHtml('<link href="/_next/static/chunks/main.js">');
      const result = await detectPlatform("https://example.com");
      expect(result.platform).toBe("NEXTJS");
      expect(result.signals).toContain("next:/_next/");
    });

    it("detects WordPress via /wp-content/", async () => {
      mockHtml('<link rel="stylesheet" href="/wp-content/themes/theme/style.css">');
      const result = await detectPlatform("https://example.com");
      expect(result.platform).toBe("WORDPRESS");
      expect(result.confidence).toBe("high");
      expect(result.signals).toContain("wp:/wp-content/");
    });

    it("detects WordPress via meta generator", async () => {
      mockHtml('<meta name="generator" content="WordPress 6.5">');
      const result = await detectPlatform("https://example.com");
      expect(result.platform).toBe("WORDPRESS");
      expect(result.signals).toContain("wp:generator:WordPress 6.5");
    });

    it("detects WordPress via /wp-json", async () => {
      mockHtml("<html><body>Simple page</body></html>", true);
      const result = await detectPlatform("https://example.com");
      expect(result.platform).toBe("WORDPRESS");
      expect(result.signals).toContain("wp:/wp-json");
    });

    it("detects MIGRACION when framework=nextjs but production=WordPress", async () => {
      mockHtml('<link href="/wp-content/themes/theme/style.css"><meta name="generator" content="WordPress 6.5">');
      const result = await detectPlatform("https://example.com", "nextjs");
      expect(result.platform).toBe("MIGRACION");
      expect(result.confidence).toBe("high");
    });

    it("does NOT detect WordPress from page text mentioning WordPress", async () => {
      // A Next.js site that talks about WordPress migration in its content
      mockHtml('<script id="__NEXT_DATA__">{}</script><link href="/_next/static/css/a.css"><p>We migrated from WordPress to Next.js for better performance</p>');
      const result = await detectPlatform("https://example.com");
      expect(result.platform).toBe("NEXTJS");
      expect(result.confidence).toBe("high");
      // Should NOT have WordPress signals from text content
      expect(result.signals.filter((s) => s.startsWith("wp:"))).toHaveLength(0);
    });

    it("returns OTRO when no signals found", async () => {
      mockHtml("<html><body>Static site</body></html>");
      const result = await detectPlatform("https://example.com");
      expect(result.platform).toBe("OTRO");
      expect(result.confidence).toBe("low");
    });

    it("handles fetch errors gracefully", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      const result = await detectPlatform("https://unreachable.com");
      expect(result.platform).toBe("OTRO");
      expect(result.confidence).toBe("low");
    });
  });

  describe("isEligibleForExecution", () => {
    it("returns true for NEXTJS", () => {
      expect(isEligibleForExecution("NEXTJS")).toBe(true);
    });

    it("returns false for WORDPRESS", () => {
      expect(isEligibleForExecution("WORDPRESS")).toBe(false);
    });

    it("returns false for MIGRACION", () => {
      expect(isEligibleForExecution("MIGRACION")).toBe(false);
    });

    it("returns false for OTRO", () => {
      expect(isEligibleForExecution("OTRO")).toBe(false);
    });

    it("returns false for null", () => {
      expect(isEligibleForExecution(null)).toBe(false);
    });
  });

  describe("ineligibilityReason", () => {
    it("returns null for NEXTJS", () => {
      expect(ineligibilityReason("NEXTJS")).toBeNull();
    });

    it("returns reason for WORDPRESS", () => {
      expect(ineligibilityReason("WORDPRESS")).toContain("WordPress");
    });

    it("returns reason for MIGRACION", () => {
      expect(ineligibilityReason("MIGRACION")).toContain("migración");
    });

    it("returns reason for null", () => {
      expect(ineligibilityReason(null)).toContain("no detectada");
    });
  });
});
