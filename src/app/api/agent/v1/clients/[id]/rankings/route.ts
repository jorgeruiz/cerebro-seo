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
    include: {
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
    date: r.date.toISOString(),
  }));

  return NextResponse.json({
    period: { from: from.toISOString(), to: to.toISOString() },
    count: data.length,
    rankings: data,
  });
}

export const GET = withAgentAuth(handler);
