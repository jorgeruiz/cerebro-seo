import { prisma } from "@/lib/db";
import type { Site } from "@prisma/client";

// ── Error types ─────────────────────────────────────────────────────────────

export class NoSiteError extends Error {
  readonly code = "NO_SITE" as const;
  constructor(clientId: string) {
    super(`Client ${clientId} has no site configured`);
    this.name = "NoSiteError";
  }
}

export class AmbiguousSiteError extends Error {
  readonly code = "AMBIGUOUS_SITE" as const;
  readonly siteCount: number;
  constructor(clientId: string, count: number) {
    super(
      `Client ${clientId} has ${count} sites — siteId is required to disambiguate`
    );
    this.name = "AmbiguousSiteError";
    this.siteCount = count;
  }
}

// ── resolveSite ─────────────────────────────────────────────────────────────

/**
 * Resolve the Site for a client, safely.
 *
 * - With `siteId`: validates `site.clientId === clientId`.
 *   Returns 404-style error (not 403) to avoid revealing existence.
 * - Without `siteId`: returns the single site of the client.
 *   Throws NoSiteError (0 sites) or AmbiguousSiteError (>1 sites).
 */
export async function resolveSite(
  clientId: string,
  siteId?: string | null
): Promise<Site> {
  if (siteId) {
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site || site.clientId !== clientId) {
      throw new NoSiteError(clientId);
    }
    return site;
  }

  const sites = await prisma.site.findMany({
    where: { clientId },
    take: 2, // only need to know if 0, 1, or >1
  });

  if (sites.length === 0) {
    throw new NoSiteError(clientId);
  }

  if (sites.length > 1) {
    const total = await prisma.site.count({ where: { clientId } });
    throw new AmbiguousSiteError(clientId, total);
  }

  return sites[0];
}
