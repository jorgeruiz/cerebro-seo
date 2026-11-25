export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAgentAuth } from "@/lib/agent-auth";

type SourceStatus = "ok" | "empty" | "not_connected" | "error";

interface DataSourceInfo {
  status: SourceStatus;
  lastDate: string | null;
  error?: string;
}

async function handler(
  req: NextRequest,
  { params }: { params: Record<string, string> }
) {
  const clientId = params.id;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      sites: {
        select: { id: true, gscProperty: true, ga4Property: true },
        take: 1,
      },
    },
  });
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const site = client.sites[0];
  const siteId = site?.id;

  // Date range: default last 30 days
  const now = new Date();
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const from = fromParam ? new Date(fromParam) : new Date(now.getTime() - 30 * 86400000);
  const to = toParam ? new Date(toParam) : now;

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json(
      { error: "Invalid date format. Use ISO 8601 (YYYY-MM-DD)." },
      { status: 400 }
    );
  }

  // ── Helper: get last job status ───────────────────────────────────────────
  async function getJobStatus(jobName: string): Promise<{ lastSuccess: Date | null; lastError: string | null }> {
    const [success, error] = await Promise.all([
      prisma.jobLog.findFirst({
        where: { jobName, clientId, status: "success" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      prisma.jobLog.findFirst({
        where: { jobName, clientId, status: "failed" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, error: true },
      }),
    ]);
    return {
      lastSuccess: success?.createdAt ?? null,
      lastError: error && (!success || error.createdAt > success.createdAt)
        ? error.error?.slice(0, 200) ?? "Unknown error"
        : null,
    };
  }

  // ── GSC (page-level) ────────────────────────────────────────────────────
  let gscSource: DataSourceInfo & { summary?: unknown; topPages?: unknown } = {
    status: "not_connected",
    lastDate: null,
  };

  if (siteId && site?.gscProperty) {
    const gscRows = await prisma.pageMetric.findMany({
      where: { siteId, source: "gsc", date: { gte: from, lte: to } },
      orderBy: { date: "desc" },
      take: 500,
      select: { url: true, date: true, clicks: true, impressions: true, ctr: true, position: true },
    });

    const gscJob = await getJobStatus("gsc:page-metrics");
    const totalClicks = gscRows.reduce((s, r) => s + (r.clicks ?? 0), 0);
    const totalImpressions = gscRows.reduce((s, r) => s + (r.impressions ?? 0), 0);
    const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
    const avgPosition = gscRows.length > 0
      ? gscRows.reduce((s, r) => s + (r.position ?? 0), 0) / gscRows.length
      : null;

    // Top pages
    const pageMap = new Map<string, { clicks: number; impressions: number; position: number; count: number }>();
    for (const r of gscRows) {
      const prev = pageMap.get(r.url) ?? { clicks: 0, impressions: 0, position: 0, count: 0 };
      pageMap.set(r.url, {
        clicks: prev.clicks + (r.clicks ?? 0),
        impressions: prev.impressions + (r.impressions ?? 0),
        position: prev.position + (r.position ?? 0),
        count: prev.count + 1,
      });
    }
    const topPages = Array.from(pageMap.entries())
      .map(([url, v]) => ({ url, clicks: v.clicks, impressions: v.impressions, avgPosition: +(v.position / v.count).toFixed(1) }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 20);

    gscSource = {
      status: gscJob.lastError ? "error" : gscRows.length > 0 ? "ok" : "empty",
      lastDate: gscRows[0]?.date?.toISOString() ?? gscJob.lastSuccess?.toISOString() ?? null,
      ...(gscJob.lastError && { error: gscJob.lastError }),
      summary: { totalClicks, totalImpressions, avgCtr: +avgCtr.toFixed(4), avgPosition: avgPosition !== null ? +avgPosition.toFixed(1) : null },
      topPages,
    };
  }

  // ── GSC (query-level) ───────────────────────────────────────────────────
  let gscQueriesSource: DataSourceInfo & { topQueries?: unknown } = {
    status: siteId && site?.gscProperty ? "empty" : "not_connected",
    lastDate: null,
  };

  if (siteId && site?.gscProperty) {
    const queryRows = await prisma.queryMetric.findMany({
      where: { siteId, date: { gte: from, lte: to } },
      orderBy: { clicks: "desc" },
      take: 100,
      select: { query: true, page: true, clicks: true, impressions: true, position: true, date: true },
    });
    if (queryRows.length > 0) {
      gscQueriesSource = {
        status: "ok",
        lastDate: queryRows[0].date.toISOString(),
        topQueries: queryRows.map((q) => ({
          query: q.query,
          page: q.page,
          clicks: q.clicks,
          impressions: q.impressions,
          avgPosition: q.position ? +q.position.toFixed(1) : null,
        })),
      };
    }
  }

  // ── GA4 ─────────────────────────────────────────────────────────────────
  let ga4Source: DataSourceInfo & { totalSessions?: number } = {
    status: "not_connected",
    lastDate: null,
  };

  if (siteId && site?.ga4Property) {
    const ga4Rows = await prisma.pageMetric.findMany({
      where: { siteId, source: "ga4", date: { gte: from, lte: to } },
      orderBy: { date: "desc" },
      take: 100,
      select: { sessions: true, date: true },
    });
    const totalSessions = ga4Rows.reduce((s, r) => s + (r.sessions ?? 0), 0);
    ga4Source = {
      status: ga4Rows.length > 0 ? "ok" : "empty",
      lastDate: ga4Rows[0]?.date?.toISOString() ?? null,
      totalSessions,
    };
  }

  // ── Rankings ────────────────────────────────────────────────────────────
  const keywords = await prisma.keyword.findMany({
    where: { clientId, deletedAt: null },
    orderBy: [{ isPriority: "desc" }, { term: "asc" }],
    take: 100,
    select: {
      id: true,
      term: true,
      isPriority: true,
      category: true,
      targetUrl: true,
      rankings: { orderBy: { date: "desc" }, take: 1, select: { position: true, date: true, delta: true } },
    },
  });

  const rankingJob = await getJobStatus("tracking:rankings-priority");
  const rankingsSource: DataSourceInfo & { keywords?: unknown } = {
    status: rankingJob.lastError ? "error" : keywords.length > 0 ? "ok" : "empty",
    lastDate: keywords[0]?.rankings[0]?.date?.toISOString() ?? rankingJob.lastSuccess?.toISOString() ?? null,
    ...(rankingJob.lastError && { error: rankingJob.lastError }),
    keywords: keywords.map((k) => ({
      id: k.id,
      term: k.term,
      isPriority: k.isPriority,
      category: k.category,
      targetUrl: k.targetUrl,
      position: k.rankings[0]?.position ?? null,
      positionDate: k.rankings[0]?.date?.toISOString() ?? null,
      delta: k.rankings[0]?.delta ?? null,
    })),
  };

  // ── Backlinks ───────────────────────────────────────────────────────────
  const backlinkJob = await getJobStatus("analysis:backlinks");
  const backlinkCount = await prisma.backlink.count({ where: { clientId, status: "ACTIVE" } });
  const lastBacklink = await prisma.backlink.findFirst({
    where: { clientId },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });

  const backlinksSource: DataSourceInfo & { totalActive?: number; topDomains?: unknown } = {
    status: backlinkJob.lastError ? "error" : backlinkCount > 0 ? "ok" : "empty",
    lastDate: lastBacklink?.updatedAt?.toISOString() ?? backlinkJob.lastSuccess?.toISOString() ?? null,
    ...(backlinkJob.lastError && { error: backlinkJob.lastError }),
    totalActive: backlinkCount,
  };

  if (backlinkCount > 0) {
    const topBacklinks = await prisma.backlink.findMany({
      where: { clientId, status: "ACTIVE" },
      orderBy: { domainAuthority: "desc" },
      take: 20,
      select: { sourceDomain: true, sourceUrl: true, targetUrl: true, anchorText: true, domainAuthority: true, followType: true, firstSeen: true },
    });
    backlinksSource.topDomains = topBacklinks;
  }

  // ── Competitors ─────────────────────────────────────────────────────────
  const competitorJob = await getJobStatus("analysis:competitors");
  const competitors = await prisma.competitor.findMany({
    where: { clientId, deletedAt: null },
    select: {
      id: true,
      domain: true,
      domainAuthority: true,
      lastAnalyzed: true,
      snapshots: { orderBy: { capturedAt: "desc" }, take: 1, select: { rankedKeywords: true, estimatedTraffic: true, capturedAt: true } },
    },
  });

  const competitorsSource: DataSourceInfo & { competitors?: unknown } = {
    status: competitorJob.lastError ? "error" : competitors.length > 0 ? "ok" : "empty",
    lastDate: competitors[0]?.lastAnalyzed?.toISOString() ?? competitorJob.lastSuccess?.toISOString() ?? null,
    ...(competitorJob.lastError && { error: competitorJob.lastError }),
    competitors: competitors.map((c) => ({
      domain: c.domain,
      domainAuthority: c.domainAuthority,
      lastAnalyzed: c.lastAnalyzed?.toISOString() ?? null,
      rankedKeywords: c.snapshots[0]?.rankedKeywords ?? null,
      estimatedTraffic: c.snapshots[0]?.estimatedTraffic ?? null,
    })),
  };

  // ── PageSpeed ───────────────────────────────────────────────────────────
  const pagespeedJob = await getJobStatus("pagespeed:collect");
  let pagespeedSource: DataSourceInfo & { metrics?: unknown } = {
    status: "empty",
    lastDate: pagespeedJob.lastSuccess?.toISOString() ?? null,
  };

  if (siteId) {
    const psMetrics = await prisma.pageSpeedMetric.findMany({
      where: { siteId, date: { gte: new Date(now.getTime() - 90 * 86400000) } },
      orderBy: { date: "desc" },
      take: 20,
      select: { url: true, device: true, date: true, score: true, lcp: true, inp: true, cls: true, fcp: true, ttfb: true },
    });
    pagespeedSource = {
      status: pagespeedJob.lastError ? "error" : psMetrics.length > 0 ? "ok" : "empty",
      lastDate: psMetrics[0]?.date?.toISOString() ?? pagespeedJob.lastSuccess?.toISOString() ?? null,
      ...(pagespeedJob.lastError && { error: pagespeedJob.lastError }),
      metrics: psMetrics,
    };
  }

  // ── AI Search Visibility ────────────────────────────────────────────────
  const aiSearchJob = await getJobStatus("analysis:ai-search");
  const aiSearchRows = await prisma.aiSearchVisibility.findMany({
    where: { clientId, date: { gte: new Date(now.getTime() - 90 * 86400000) } },
    orderBy: { date: "desc" },
    take: 50,
    select: { date: true, llmSource: true, query: true, mentioned: true, position: true },
  });

  const mentionedCount = aiSearchRows.filter((r) => r.mentioned).length;
  const aiSearchSource: DataSourceInfo & { mentionRate?: number; results?: unknown } = {
    status: aiSearchJob.lastError ? "error" : aiSearchRows.length > 0 ? "ok" : "empty",
    lastDate: aiSearchRows[0]?.date?.toISOString() ?? aiSearchJob.lastSuccess?.toISOString() ?? null,
    ...(aiSearchJob.lastError && { error: aiSearchJob.lastError }),
    mentionRate: aiSearchRows.length > 0 ? +(mentionedCount / aiSearchRows.length).toFixed(3) : 0,
    results: aiSearchRows,
  };

  return NextResponse.json({
    period: { from: from.toISOString(), to: to.toISOString() },
    gsc: gscSource,
    gscQueries: gscQueriesSource,
    ga4: ga4Source,
    rankings: rankingsSource,
    backlinks: backlinksSource,
    competitors: competitorsSource,
    pagespeed: pagespeedSource,
    aiSearch: aiSearchSource,
  });
}

export const GET = withAgentAuth(handler);
