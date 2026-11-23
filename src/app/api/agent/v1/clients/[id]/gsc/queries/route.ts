export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAgentAuth } from "@/lib/agent-auth";

/**
 * GET /api/agent/v1/clients/{id}/gsc/queries?from=&to=&page=1
 *
 * Returns GSC query-level metrics: clicks, impressions, CTR, position.
 * Paginated (100 per page). Includes delta vs previous period.
 */
async function handler(
  req: NextRequest,
  { params }: { params: Record<string, string> }
) {
  const clientId = params.id;

  const site = await prisma.site.findFirst({
    where: { clientId },
    select: { id: true, gscProperty: true },
  });
  if (!site) {
    return NextResponse.json({ error: "No site configured" }, { status: 404 });
  }

  const now = new Date();
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") ?? "1", 10));
  const pageSize = 100;

  const from = fromParam ? new Date(fromParam) : new Date(now.getTime() - 28 * 86400000);
  const to = toParam ? new Date(toParam) : now;

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "Invalid date format." }, { status: 400 });
  }

  // Current period
  const currentMetrics = await prisma.queryMetric.findMany({
    where: {
      siteId: site.id,
      date: { gte: from, lte: to },
    },
    orderBy: { impressions: "desc" },
  });

  // Aggregate by query+page
  const aggregated = new Map<string, {
    query: string;
    page: string | null;
    clicks: number;
    impressions: number;
    ctrSum: number;
    positionSum: number;
    count: number;
  }>();

  for (const m of currentMetrics) {
    const key = `${m.query}::${m.page ?? ""}`;
    const prev = aggregated.get(key) ?? {
      query: m.query,
      page: m.page,
      clicks: 0,
      impressions: 0,
      ctrSum: 0,
      positionSum: 0,
      count: 0,
    };
    prev.clicks += m.clicks;
    prev.impressions += m.impressions;
    if (m.ctr != null) { prev.ctrSum += m.ctr; prev.count++; }
    if (m.position != null) { prev.positionSum += m.position; prev.count = Math.max(prev.count, 1); }
    aggregated.set(key, prev);
  }

  // Previous period (same length)
  const periodMs = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - periodMs);
  const prevTo = new Date(from.getTime() - 1);

  const prevMetrics = await prisma.queryMetric.findMany({
    where: {
      siteId: site.id,
      date: { gte: prevFrom, lte: prevTo },
    },
  });

  const prevAgg = new Map<string, { clicks: number; impressions: number; position: number; count: number }>();
  for (const m of prevMetrics) {
    const key = `${m.query}::${m.page ?? ""}`;
    const prev = prevAgg.get(key) ?? { clicks: 0, impressions: 0, position: 0, count: 0 };
    prev.clicks += m.clicks;
    prev.impressions += m.impressions;
    if (m.position != null) { prev.position += m.position; prev.count++; }
    prevAgg.set(key, prev);
  }

  // Build results with deltas
  const allEntries = Array.from(aggregated.values())
    .sort((a, b) => b.impressions - a.impressions);

  const total = allEntries.length;
  const paginated = allEntries.slice((page - 1) * pageSize, page * pageSize);

  const results = paginated.map((e) => {
    const key = `${e.query}::${e.page ?? ""}`;
    const prev = prevAgg.get(key);
    const avgPosition = e.count > 0 ? +(e.positionSum / e.count).toFixed(1) : null;
    const avgCtr = e.impressions > 0 ? +(e.clicks / e.impressions * 100).toFixed(2) : null;
    const prevAvgPos = prev && prev.count > 0 ? +(prev.position / prev.count).toFixed(1) : null;

    return {
      query: e.query,
      page: e.page,
      clicks: e.clicks,
      impressions: e.impressions,
      ctr: avgCtr,
      position: avgPosition,
      deltaClicks: prev ? e.clicks - prev.clicks : null,
      deltaImpressions: prev ? e.impressions - prev.impressions : null,
      deltaPosition: avgPosition != null && prevAvgPos != null
        ? +(prevAvgPos - avgPosition).toFixed(1) // positive = improved
        : null,
    };
  });

  return NextResponse.json({
    period: { from: from.toISOString(), to: to.toISOString() },
    hasGsc: !!site.gscProperty,
    page,
    pageSize,
    total,
    queries: results,
  });
}

export const GET = withAgentAuth(handler);
