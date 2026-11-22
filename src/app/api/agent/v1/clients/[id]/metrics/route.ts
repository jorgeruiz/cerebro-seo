export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAgentAuth } from "@/lib/agent-auth";

async function handler(
  req: NextRequest,
  { params }: { params: Record<string, string> }
) {
  const clientId = params.id;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, sites: { select: { id: true }, take: 1 } },
  });
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const siteId = client.sites[0]?.id;
  if (!siteId) {
    return NextResponse.json({ error: "No site configured" }, { status: 404 });
  }

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

  // Fetch page metrics (GSC + GA4 data)
  const pageMetrics = await prisma.pageMetric.findMany({
    where: { siteId, date: { gte: from, lte: to } },
    orderBy: { date: "desc" },
    take: 500,
    select: {
      url: true,
      date: true,
      source: true,
      clicks: true,
      impressions: true,
      ctr: true,
      position: true,
      sessions: true,
    },
  });

  // Aggregate traffic totals
  const gscRows = pageMetrics.filter((m) => m.source === "gsc");
  const ga4Rows = pageMetrics.filter((m) => m.source === "ga4");

  const totalClicks = gscRows.reduce((s, r) => s + (r.clicks ?? 0), 0);
  const totalImpressions = gscRows.reduce((s, r) => s + (r.impressions ?? 0), 0);
  const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
  const avgPosition =
    gscRows.length > 0
      ? gscRows.reduce((s, r) => s + (r.position ?? 0), 0) / gscRows.length
      : null;
  const totalSessions = ga4Rows.reduce((s, r) => s + (r.sessions ?? 0), 0);

  // Top pages by clicks
  const pageMap = new Map<string, { clicks: number; impressions: number; position: number; count: number }>();
  for (const r of gscRows) {
    const key = r.url;
    const prev = pageMap.get(key) ?? { clicks: 0, impressions: 0, position: 0, count: 0 };
    pageMap.set(key, {
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

  // Keywords with latest ranking
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
      rankings: {
        orderBy: { date: "desc" },
        take: 1,
        select: { position: true, date: true, delta: true },
      },
    },
  });

  const keywordData = keywords.map((k) => ({
    id: k.id,
    term: k.term,
    isPriority: k.isPriority,
    category: k.category,
    targetUrl: k.targetUrl,
    position: k.rankings[0]?.position ?? null,
    positionDate: k.rankings[0]?.date?.toISOString() ?? null,
    delta: k.rankings[0]?.delta ?? null,
  }));

  return NextResponse.json({
    period: { from: from.toISOString(), to: to.toISOString() },
    summary: {
      totalClicks,
      totalImpressions,
      avgCtr: +avgCtr.toFixed(4),
      avgPosition: avgPosition !== null ? +avgPosition.toFixed(1) : null,
      totalSessions,
    },
    topPages,
    keywords: keywordData,
  });
}

export const GET = withAgentAuth(handler);
