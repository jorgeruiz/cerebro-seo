export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAgentAuth } from "@/lib/agent-auth";

/**
 * GET /api/agent/v1/clients/{id}/ai-visibility
 *
 * Returns AI search visibility data: AI Overview presence, citations.
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
  const from = fromParam ? new Date(fromParam) : new Date(now.getTime() - 90 * 86400000);
  const to = toParam ? new Date(toParam) : now;

  const records = await prisma.aiSearchVisibility.findMany({
    where: {
      clientId,
      date: { gte: from, lte: to },
    },
    orderBy: { date: "desc" },
    take: 500,
  });

  const total = records.length;
  const mentioned = records.filter((r) => r.mentioned).length;
  const mentionRate = total > 0 ? +(mentioned / total * 100).toFixed(1) : null;

  const data = records.map((r) => ({
    query: r.query,
    llmSource: r.llmSource,
    mentioned: r.mentioned,
    position: r.position,
    context: r.context,
    date: r.date.toISOString(),
  }));

  return NextResponse.json({
    period: { from: from.toISOString(), to: to.toISOString() },
    summary: {
      total,
      mentioned,
      mentionRate,
    },
    records: data,
  });
}

export const GET = withAgentAuth(handler);
