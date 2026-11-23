export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAgentAuth } from "@/lib/agent-auth";

/**
 * GET /api/agent/v1/clients/{id}/integrations
 *
 * Returns the connection status of all data integrations:
 * GSC, GA4, DataForSEO, GitHub, WordPress.
 */
async function handler(
  _req: NextRequest,
  { params }: { params: Record<string, string> }
) {
  const clientId = params.id;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      sites: {
        select: {
          id: true,
          url: true,
          gscProperty: true,
          ga4Property: true,
          githubRepo: true,
          platform: true,
          platformDetectedAt: true,
          framework: true,
        },
        take: 1,
      },
    },
  });

  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const site = client.sites[0];

  // Last successful page metrics sync
  const lastPageMetrics = await prisma.jobLog.findFirst({
    where: { jobName: "gsc:page-metrics", clientId, status: "success" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const lastPageMetricsError = await prisma.jobLog.findFirst({
    where: { jobName: "gsc:page-metrics", clientId, status: "failed" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, error: true },
  });

  // Last rank tracking
  const lastRanking = await prisma.jobLog.findFirst({
    where: { jobName: { startsWith: "tracking:rankings" }, clientId, status: "success" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const lastRankingError = await prisma.jobLog.findFirst({
    where: { jobName: { startsWith: "tracking:rankings" }, clientId, status: "failed" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, error: true },
  });

  // Last backlinks
  const lastBacklinks = await prisma.jobLog.findFirst({
    where: { jobName: "analysis:backlinks", clientId, status: "success" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const integrations = {
    gsc: {
      connected: !!site?.gscProperty,
      property: site?.gscProperty ?? null,
      lastSync: lastPageMetrics?.createdAt?.toISOString() ?? null,
      lastError: lastPageMetricsError
        ? { date: lastPageMetricsError.createdAt.toISOString(), message: lastPageMetricsError.error?.slice(0, 200) }
        : null,
    },
    ga4: {
      connected: !!site?.ga4Property,
      property: site?.ga4Property ?? null,
      lastSync: lastPageMetrics?.createdAt?.toISOString() ?? null, // GA4 syncs with page metrics
    },
    dataforseo: {
      connected: true, // Always available if env vars set
      lastRankingSync: lastRanking?.createdAt?.toISOString() ?? null,
      lastRankingError: lastRankingError
        ? { date: lastRankingError.createdAt.toISOString(), message: lastRankingError.error?.slice(0, 200) }
        : null,
      lastBacklinksSync: lastBacklinks?.createdAt?.toISOString() ?? null,
    },
    github: {
      connected: !!site?.githubRepo,
      repo: site?.githubRepo ?? null,
    },
    platform: {
      detected: site?.platform ?? null,
      framework: site?.framework ?? null,
      detectedAt: site?.platformDetectedAt?.toISOString() ?? null,
    },
  };

  return NextResponse.json(integrations);
}

export const GET = withAgentAuth(handler);
