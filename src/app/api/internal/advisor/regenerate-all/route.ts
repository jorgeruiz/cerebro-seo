export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { aiAnalysisQueue } from "@/server/jobs/queues";
import { format } from "date-fns";

function authorize(req: NextRequest): boolean {
  const secret = process.env.SEO_INTERNAL_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * POST /api/internal/advisor/regenerate-all
 *
 * Regenera el plan de advisor para TODOS los clientes SEO activos.
 * Invalida caches Redis y encola jobs con force=true.
 *
 * Response: { queued: number, clients: { id, name, jobId }[] }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clients = await prisma.client.findMany({
    where: { status: "ACTIVE", services: { has: "seo" } },
    select: { id: true, name: true },
  });

  const today = format(new Date(), "yyyy-MM-dd");
  const month = format(new Date(), "yyyy-MM");
  const results: { id: string; name: string; jobId: string }[] = [];

  for (const client of clients) {
    // Invalidar caches
    await Promise.all([
      redis.del(`advisor:ran:${client.id}:${today}`),
      redis.del(`advisor:signals:${client.id}:${today}`),
      redis.del(`advisor:profile:${client.id}:${month}`),
    ]);

    // Encolar job
    const job = await aiAnalysisQueue.add(
      "advisor:generate",
      { clientId: client.id, force: true },
      { jobId: `advisor-regen:${client.id}:${Date.now()}` }
    );

    results.push({
      id: client.id,
      name: client.name,
      jobId: job.id ?? "unknown",
    });
  }

  return NextResponse.json({
    queued: results.length,
    clients: results,
  });
}
