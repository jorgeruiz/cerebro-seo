import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockRunPageSpeed = vi.hoisted(() => vi.fn());
const mockCrawlSite = vi.hoisted(() => vi.fn());

// ─── vi.mock ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: {
    site: { findFirst: vi.fn() },
    audit: {
      create: vi.fn(),
      update: vi.fn(),
    },
    auditIssue: { createMany: vi.fn() },
  },
}));

vi.mock("@/server/providers/pagespeed", () => ({
  runPageSpeed: mockRunPageSpeed,
}));

vi.mock("@/server/crawler/site-crawler", () => ({
  crawlSite: mockCrawlSite,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PSI_RESULT = {
  url: "https://molinoazteca.mx",
  strategy: "mobile" as const,
  scores: { performance: 75, accessibility: 90, bestPractices: 88, seo: 85 },
  cwv: { lcp: 2500, fcp: 1200, cls: 0.05, tbt: 180 },
  opportunities: [
    { id: "unused-javascript", title: "Eliminar JS no usado", description: "...", score: 0.3, displayValue: "120 KiB" },
  ],
  fetchedAt: new Date(),
};

const CRAWL_RESULT = {
  siteUrl: "https://molinoazteca.mx",
  pagesCrawled: 8,
  pagesIndexable: 7,
  brokenPages: 1,
  redirectPages: 0,
  robotsTxtFound: true,
  crawledAt: new Date(),
  pages: [
    {
      url: "https://molinoazteca.mx/",
      statusCode: 200,
      ttfbMs: 300,
      title: "Molino Azteca",
      metaDescription: "Harinas industriales",
      canonical: "https://molinoazteca.mx/",
      robotsMeta: undefined,
      h1Count: 1,
      h1Text: "Harinas",
      h2Count: 3,
      imagesWithoutAlt: 0,
      internalLinks: [],
      externalLinks: 2,
      wordCount: 450,
      issues: [],
    },
    {
      url: "https://molinoazteca.mx/404",
      statusCode: 404,
      ttfbMs: 100,
      h1Count: 0,
      h2Count: 0,
      imagesWithoutAlt: 0,
      internalLinks: [],
      externalLinks: 0,
      wordCount: 0,
      issues: [{ type: "not_found", severity: "critical" as const, message: "HTTP 404" }],
    },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runAuditProcessor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("modo quick — llama PageSpeed, no crawlSite, guarda audit", async () => {
    const { prisma } = await import("@/lib/db");

    vi.mocked(prisma.site.findFirst).mockResolvedValue({ id: "site-1", url: "https://molinoazteca.mx" } as never);
    vi.mocked(prisma.audit.create).mockResolvedValue({ id: "audit-1" } as never);
    vi.mocked(prisma.audit.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditIssue.createMany).mockResolvedValue({ count: 1 });

    mockRunPageSpeed.mockResolvedValue(PSI_RESULT);

    const { runAuditProcessor } = await import("../processors/audit-processor");
    const result = await runAuditProcessor({ clientId: "client-1", mode: "quick" });

    expect(mockCrawlSite).not.toHaveBeenCalled();
    expect(mockRunPageSpeed).toHaveBeenCalledWith("https://molinoazteca.mx", "mobile");
    expect(result.mode).toBe("quick");
    expect(result.auditId).toBe("audit-1");
    expect(result.scores.performance).toBe(75);
    expect(prisma.audit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "audit-1" },
        data: expect.objectContaining({ status: "completed" }),
      })
    );
  });

  it("modo complete — llama crawlSite + PageSpeed mobile + desktop", async () => {
    const { prisma } = await import("@/lib/db");

    vi.mocked(prisma.site.findFirst).mockResolvedValue({ id: "site-1", url: "https://molinoazteca.mx" } as never);
    vi.mocked(prisma.audit.create).mockResolvedValue({ id: "audit-2" } as never);
    vi.mocked(prisma.audit.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditIssue.createMany).mockResolvedValue({ count: 2 });

    mockRunPageSpeed.mockResolvedValue(PSI_RESULT);
    mockCrawlSite.mockResolvedValue(CRAWL_RESULT);

    const { runAuditProcessor } = await import("../processors/audit-processor");
    const result = await runAuditProcessor({ clientId: "client-1", mode: "complete" });

    expect(mockCrawlSite).toHaveBeenCalledWith("https://molinoazteca.mx", 50);
    expect(mockRunPageSpeed).toHaveBeenCalledTimes(2); // mobile + desktop
    expect(result.pagesCrawled).toBe(8);
    expect(result.mode).toBe("complete");
  });

  it("si no hay site → lanza error, no crea audit", async () => {
    const { prisma } = await import("@/lib/db");

    vi.mocked(prisma.site.findFirst).mockResolvedValue(null);

    const { runAuditProcessor } = await import("../processors/audit-processor");
    await expect(runAuditProcessor({ clientId: "client-x", mode: "quick" })).rejects.toThrow("No site found");

    expect(prisma.audit.create).not.toHaveBeenCalled();
  });

  it("si PageSpeed falla → audit completa con scores en 0 (no lanza error)", async () => {
    const { prisma } = await import("@/lib/db");

    vi.mocked(prisma.site.findFirst).mockResolvedValue({ id: "site-1", url: "https://example.com" } as never);
    vi.mocked(prisma.audit.create).mockResolvedValue({ id: "audit-3" } as never);
    vi.mocked(prisma.audit.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditIssue.createMany).mockResolvedValue({ count: 0 });

    // allSettled → no lanza, pero psiMobileResult = null
    mockRunPageSpeed.mockRejectedValue(new Error("PageSpeed API timeout"));

    const { runAuditProcessor } = await import("../processors/audit-processor");
    const result = await runAuditProcessor({ clientId: "client-1", mode: "quick" });

    // Completa sin lanzar — con scores en 0
    expect(result.scores.performance).toBe(0);
    expect(result.scores.seo).toBe(0);
    expect(prisma.audit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed" }),
      })
    );
  });

  it("agrega http:// si siteUrl no tiene protocolo", async () => {
    const { prisma } = await import("@/lib/db");

    vi.mocked(prisma.site.findFirst).mockResolvedValue({ id: "site-1", url: "molinoazteca.mx" } as never);
    vi.mocked(prisma.audit.create).mockResolvedValue({ id: "audit-4" } as never);
    vi.mocked(prisma.audit.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditIssue.createMany).mockResolvedValue({ count: 0 });

    mockRunPageSpeed.mockResolvedValue(PSI_RESULT);

    const { runAuditProcessor } = await import("../processors/audit-processor");
    await runAuditProcessor({ clientId: "client-1", mode: "quick" });

    expect(mockRunPageSpeed).toHaveBeenCalledWith("https://molinoazteca.mx", expect.any(String));
  });
});
