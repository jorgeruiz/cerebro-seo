export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAgentAuth } from "@/lib/agent-auth";

/**
 * GET /api/agent/v1/clients/{id}/pagespeed
 *
 * Returns PageSpeed metrics history: score, LCP, INP, CLS, field data.
 */
async function handler(
  req: NextRequest,
  { params }: { params: Record<string, string> }
) {
  const clientId = params.id;

  const site = await prisma.site.findFirst({
    where: { clientId },
    select: { id: true },
  });
  if (!site) {
    return NextResponse.json({ error: "No site configured" }, { status: 404 });
  }

  const now = new Date();
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const from = fromParam ? new Date(fromParam) : new Date(now.getTime() - 90 * 86400000);
  const to = toParam ? new Date(toParam) : now;

  const metrics = await prisma.pageSpeedMetric.findMany({
    where: {
      siteId: site.id,
      date: { gte: from, lte: to },
    },
    orderBy: [{ date: "desc" }, { url: "asc" }],
    take: 500,
  });

  const data = metrics.map((m) => ({
    url: m.url,
    device: m.device,
    score: m.score,
    lcp: m.lcp,
    inp: m.inp,
    cls: m.cls,
    fcp: m.fcp,
    ttfb: m.ttfb,
    fieldData: m.fieldData,
    date: m.date.toISOString(),
  }));

  return NextResponse.json({
    period: { from: from.toISOString(), to: to.toISOString() },
    count: data.length,
    metrics: data,
  });
}

export const GET = withAgentAuth(handler);
