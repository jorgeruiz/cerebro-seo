export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { withAgentAuth } from "@/lib/agent-auth";
import { prisma } from "@/lib/db";

const SOURCES = [
  "rankings",
  "gsc_pages",
  "gsc_queries",
  "ga4",
  "backlinks",
  "competitors",
  "pagespeed",
  "ai_search",
] as const;

const STALE_DAYS = 4;

/**
 * GET /api/agent/v1/health/sources?clientId=...
 *
 * Returns a matrix of client × data source with:
 * - Last data date
 * - Days since last data
 * - Status (ok, stale, failed, not_connected)
 * - Last error
 */
async function handler(req: NextRequest) {
  const clientIdParam = req.nextUrl.searchParams.get("clientId");

  // Get active SEO clients
  const clients = await prisma.client.findMany({
    where: {
      status: "ACTIVE",
      services: { has: "seo" },
      ...(clientIdParam ? { id: clientIdParam } : {}),
    },
    select: { id: true, name: true, domain: true },
    orderBy: { name: "asc" },
  });

  const now = new Date();
  const matrix: Array<{
    clientId: string;
    clientName: string;
    sources: Array<{
      source: string;
      lastDataDate: string | null;
      daysAgo: number | null;
      status: string;
      lastError: string | null;
      lastRunAt: string | null;
    }>;
  }> = [];

  for (const client of clients) {
    const clientSources: Array<{
      source: string;
      lastDataDate: string | null;
      daysAgo: number | null;
      status: string;
      lastError: string | null;
      lastRunAt: string | null;
    }> = [];

    for (const source of SOURCES) {
      // Get latest DataSourceRun for this client+source
      const latestRun = await prisma.dataSourceRun.findFirst({
        where: { clientId: client.id, source },
        orderBy: { startedAt: "desc" },
        select: {
          status: true,
          lastDataDate: true,
          error: true,
          startedAt: true,
        },
      });

      if (!latestRun) {
        // Check if we can determine status from existing data
        const fallbackStatus = await getFallbackStatus(client.id, source);
        clientSources.push({
          source,
          lastDataDate: fallbackStatus.lastDate,
          daysAgo: fallbackStatus.lastDate
            ? Math.floor((now.getTime() - new Date(fallbackStatus.lastDate).getTime()) / 86400000)
            : null,
          status: fallbackStatus.status,
          lastError: null,
          lastRunAt: null,
        });
        continue;
      }

      const lastDataDate = latestRun.lastDataDate?.toISOString().slice(0, 10) ?? null;
      const daysAgo = latestRun.lastDataDate
        ? Math.floor((now.getTime() - latestRun.lastDataDate.getTime()) / 86400000)
        : null;

      let status = latestRun.status;
      if (status === "ok" && daysAgo !== null && daysAgo > STALE_DAYS) {
        status = "stale";
      }

      clientSources.push({
        source,
        lastDataDate,
        daysAgo,
        status,
        lastError: latestRun.error?.slice(0, 200) ?? null,
        lastRunAt: latestRun.startedAt.toISOString(),
      });
    }

    matrix.push({
      clientId: client.id,
      clientName: client.name,
      sources: clientSources,
    });
  }

  // Summary
  const staleCount = matrix.reduce(
    (sum, row) => sum + row.sources.filter((s) => s.status === "stale" || s.status === "failed").length,
    0,
  );

  return NextResponse.json({
    checkedAt: now.toISOString(),
    staleThreshold: `${STALE_DAYS} days`,
    clientCount: matrix.length,
    staleSourceCount: staleCount,
    matrix,
  });
}

async function getFallbackStatus(
  clientId: string,
  source: string,
): Promise<{ status: string; lastDate: string | null }> {
  const site = await prisma.site.findFirst({
    where: { clientId },
    select: { id: true, gscProperty: true, ga4Property: true },
  });

  switch (source) {
    case "rankings": {
      const latest = await prisma.keywordRanking.findFirst({
        where: { keyword: { clientId } },
        orderBy: { date: "desc" },
        select: { date: true },
      });
      return {
        status: latest ? "ok" : "no_data",
        lastDate: latest?.date.toISOString().slice(0, 10) ?? null,
      };
    }
    case "gsc_pages": {
      if (!site?.gscProperty) return { status: "not_connected", lastDate: null };
      const latest = await prisma.pageMetric.findFirst({
        where: { siteId: site.id, source: "gsc" },
        orderBy: { date: "desc" },
        select: { date: true },
      });
      return {
        status: latest ? "ok" : "no_data",
        lastDate: latest?.date.toISOString().slice(0, 10) ?? null,
      };
    }
    case "gsc_queries": {
      if (!site?.gscProperty) return { status: "not_connected", lastDate: null };
      const latest = await prisma.queryMetric.findFirst({
        where: { siteId: site.id },
        orderBy: { date: "desc" },
        select: { date: true },
      });
      return {
        status: latest ? "ok" : "no_data",
        lastDate: latest?.date.toISOString().slice(0, 10) ?? null,
      };
    }
    case "ga4": {
      if (!site?.ga4Property) return { status: "not_connected", lastDate: null };
      const latest = await prisma.pageMetric.findFirst({
        where: { siteId: site.id, source: "ga4" },
        orderBy: { date: "desc" },
        select: { date: true },
      });
      return {
        status: latest ? "ok" : "no_data",
        lastDate: latest?.date.toISOString().slice(0, 10) ?? null,
      };
    }
    case "backlinks": {
      const latest = await prisma.backlinkSnapshot.findFirst({
        where: { clientId },
        orderBy: { capturedAt: "desc" },
        select: { capturedAt: true },
      });
      return {
        status: latest ? "ok" : "no_data",
        lastDate: latest?.capturedAt.toISOString().slice(0, 10) ?? null,
      };
    }
    case "competitors": {
      const latest = await prisma.competitorSnapshot.findFirst({
        where: { clientId },
        orderBy: { capturedAt: "desc" },
        select: { capturedAt: true },
      });
      return {
        status: latest ? "ok" : "no_data",
        lastDate: latest?.capturedAt.toISOString().slice(0, 10) ?? null,
      };
    }
    case "pagespeed": {
      if (!site) return { status: "not_connected", lastDate: null };
      const latest = await prisma.pageSpeedMetric.findFirst({
        where: { siteId: site.id },
        orderBy: { date: "desc" },
        select: { date: true },
      });
      return {
        status: latest ? "ok" : "no_data",
        lastDate: latest?.date.toISOString().slice(0, 10) ?? null,
      };
    }
    case "ai_search": {
      const latest = await prisma.aiSearchVisibility.findFirst({
        where: { clientId },
        orderBy: { date: "desc" },
        select: { date: true },
      });
      return {
        status: latest ? "ok" : "no_data",
        lastDate: latest?.date.toISOString().slice(0, 10) ?? null,
      };
    }
    default:
      return { status: "unknown", lastDate: null };
  }
}

export const GET = withAgentAuth(handler);
