import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    site: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";
import { resolveSite, NoSiteError, AmbiguousSiteError } from "../resolve-site";

const SITE_A = {
  id: "site-a",
  clientId: "client-1",
  url: "https://example.com",
  gscProperty: null,
  ga4Property: null,
};

const SITE_B = {
  id: "site-b",
  clientId: "client-1",
  url: "https://other.com",
  gscProperty: null,
  ga4Property: null,
};

const SITE_OTHER_CLIENT = {
  id: "site-x",
  clientId: "client-2",
  url: "https://evil.com",
  gscProperty: null,
  ga4Property: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveSite", () => {
  describe("without siteId (auto-resolve)", () => {
    it("returns the single site when client has exactly 1", async () => {
      vi.mocked(prisma.site.findMany).mockResolvedValue([SITE_A]);

      const result = await resolveSite("client-1");

      expect(result).toEqual(SITE_A);
      expect(prisma.site.findMany).toHaveBeenCalledWith({
        where: { clientId: "client-1" },
        take: 2,
      });
    });

    it("throws NoSiteError when client has 0 sites", async () => {
      vi.mocked(prisma.site.findMany).mockResolvedValue([]);

      await expect(resolveSite("client-1")).rejects.toThrow(NoSiteError);
      await expect(resolveSite("client-1")).rejects.toMatchObject({
        code: "NO_SITE",
      });
    });

    it("throws AmbiguousSiteError when client has >1 sites", async () => {
      vi.mocked(prisma.site.findMany).mockResolvedValue([SITE_A, SITE_B]);
      vi.mocked(prisma.site.count).mockResolvedValue(3);

      await expect(resolveSite("client-1")).rejects.toThrow(AmbiguousSiteError);
      const err = await resolveSite("client-1").catch((e) => e);
      expect(err.code).toBe("AMBIGUOUS_SITE");
      expect(err.siteCount).toBe(3);
    });
  });

  describe("with siteId (explicit)", () => {
    it("returns the site when siteId belongs to clientId", async () => {
      vi.mocked(prisma.site.findUnique).mockResolvedValue(SITE_A);

      const result = await resolveSite("client-1", "site-a");

      expect(result).toEqual(SITE_A);
      expect(prisma.site.findUnique).toHaveBeenCalledWith({
        where: { id: "site-a" },
      });
    });

    it("throws NoSiteError when siteId belongs to a different client (access guard)", async () => {
      vi.mocked(prisma.site.findUnique).mockResolvedValue(SITE_OTHER_CLIENT);

      // Should NOT reveal that the site exists — returns 404-style error
      await expect(resolveSite("client-1", "site-x")).rejects.toThrow(
        NoSiteError
      );
      await expect(resolveSite("client-1", "site-x")).rejects.toMatchObject({
        code: "NO_SITE",
      });
    });

    it("throws NoSiteError when siteId does not exist", async () => {
      vi.mocked(prisma.site.findUnique).mockResolvedValue(null);

      await expect(
        resolveSite("client-1", "nonexistent")
      ).rejects.toThrow(NoSiteError);
    });
  });
});
