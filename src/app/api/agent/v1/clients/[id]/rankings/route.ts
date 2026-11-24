export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAgentAuth } from "@/lib/agent-auth";

/**
 * GET /api/agent/v1/clients/{id}/rankings?from=&to=
 *
 * Returns keyword ranking history with position, URL, SERP features, and date.
 */
async function handler(
  req: NextRequest,
  { params }: { params: Record<string, string> }
) {
  const clientId = params.id;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true },
  });
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const now = new Date();
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const from = fromParam ? new Date(fromParam) : new Date(now.getTime() - 30 * 86400000);
  const to = toParam ? new Date(toParam) : now;

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "Invalid date format. Use ISO 8601." }, { status: 400 });
  }

  const rankings = await prisma.keywordRanking.findMany({
    where: {
      keyword: { clientId, deletedAt: null },
      date: { gte: from, lte: to },
    },
    select: {
      position: true,
      rankingUrl: true,
      delta: true,
      date: true,
      fetchStatus: true,
      depth: true,
      checkedAt: true,
      keyword: { select: { term: true, isPriority: true, targetUrl: true, category: true } },
    },
    orderBy: [{ date: "desc" }, { keyword: { term: "asc" } }],
    take: 2000,
  });

  const data = rankings.map((r) => ({
    keyword: r.keyword.term,
    isPriority: r.keyword.isPriority,
    category: r.keyword.category,
    position: r.position,
    rankingUrl: r.rankingUrl,
    targetUrl: r.keyword.targetUrl,
    delta: r.delta,
    fetchStatus: r.fetchStatus ?? (r.position != null ? "OK" : "NOT_IN_TOP_N"), // backward compat
    depth: r.depth ?? null,
    checkedAt: r.checkedAt?.toISOString() ?? r.date.toISOString(),
    date: r.date.toISOString(),
  }));

  return NextResponse.json({
    period: { from: from.toISOString(), to: to.toISOString() },
    count: data.length,
    rankings: data,
  });
}

export const GET = withAgentAuth(handler);
