/**
 * POST /api/admin/trigger-job
 *
 * Enqueues a data-collection job manually.
 * Protected by ADMIN_SECRET query param.
 *
 * Usage:
 *   curl -X POST "https://seo.clicksociety.com.mx/api/admin/trigger-job?secret=<ADMIN_SECRET>" \
 *     -H "Content-Type: application/json" \
 *     -d '{"job":"tracking:rankings-priority","clientId":"xxx"}'
 *
 * Supported jobs:
 *   - tracking:rankings-priority (requires clientId)
 *   - tracking:rankings-bulk (requires clientId)
 *   - analysis:backlinks (requires clientId)
 *   - analysis:competitors (requires clientId)
 *   - gsc:page-metrics (requires clientId)
 *   - all-rankings (triggers rank tracking for ALL active SEO clients)
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { dataCollectionQueue } from "@/server/jobs/queues";
import { prisma } from "@/lib/db";

const ALLOWED_JOBS = [
  "tracking:rankings-priority",
  "tracking:rankings-bulk",
  "analysis:backlinks",
  "analysis:competitors",
  "gsc:page-metrics",
  "gsc:page-metrics-backfill",
] as const;

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    job?: string;
    clientId?: string;
  };

  // Special case: trigger for all clients
  if (body.job === "all-rankings") {
    const clients = await prisma.client.findMany({
      where: { status: "ACTIVE", services: { has: "seo" } },
      select: { id: true, name: true },
    });

    const kwCounts = await prisma.keyword.groupBy({
      by: ["clientId"],
      where: { isPriority: true, deletedAt: null, clientId: { in: clients.map((c) => c.id) } },
      _count: true,
    });
    const kwMap = new Map(kwCounts.map((k) => [k.clientId, k._count]));

    const enqueued: string[] = [];
    for (const client of clients) {
      const kws = kwMap.get(client.id) ?? 0;
      if (kws === 0) continue;

      await dataCollectionQueue.add(
        "tracking:rankings-priority",
        { clientId: client.id, mode: "priority" },
        { jobId: `manual-rank:${client.id}:${Date.now()}` }
      );
      enqueued.push(`${client.name} (${kws} kws)`);
    }

    return NextResponse.json({
      ok: true,
      enqueued: enqueued.length,
      clients: enqueued,
      estimatedCost: `$${(kwCounts.reduce((s, k) => s + k._count, 0) * 0.00195).toFixed(4)}`,
    });
  }

  // Single job
  if (!body.job || !ALLOWED_JOBS.includes(body.job as (typeof ALLOWED_JOBS)[number])) {
    return NextResponse.json(
      { error: `Invalid job. Allowed: ${ALLOWED_JOBS.join(", ")}, all-rankings` },
      { status: 400 }
    );
  }

  if (!body.clientId) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }

  const client = await prisma.client.findUnique({
    where: { id: body.clientId },
    select: { id: true, name: true },
  });
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const mode = body.job.includes("bulk") ? "bulk" : "priority";
  await dataCollectionQueue.add(
    body.job,
    { clientId: client.id, mode, days: body.job.includes("backfill") ? 90 : undefined },
    { jobId: `manual:${body.job}:${client.id}:${Date.now()}` }
  );

  return NextResponse.json({
    ok: true,
    job: body.job,
    client: client.name,
    clientId: client.id,
  });
}
