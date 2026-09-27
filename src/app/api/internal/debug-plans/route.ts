export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

function authorize(req: NextRequest): boolean {
  const secret = process.env.SEO_INTERNAL_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * GET /api/internal/debug-plans?clientId=...
 * Temporal — listar últimos 10 planes de un cliente con metadata.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }

  // Resolve internal ID if it looks like a Notion ID (no dashes, 32 chars)
  let internalId = clientId;
  if (clientId.length === 32 && !clientId.includes("-")) {
    const client = await prisma.client.findUnique({
      where: { cerebroClientId: clientId },
      select: { id: true },
    });
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    internalId = client.id;
  }

  const plans = await prisma.nextStepPlan.findMany({
    where: { clientId: internalId },
    orderBy: { generatedAt: "desc" },
    take: 10,
    select: {
      id: true,
      generatedAt: true,
      status: true,
      model: true,
      triggeredBy: true,
      steps: true,
    },
  });

  const summary = plans.map((p) => {
    const raw = p.steps;
    const steps = (Array.isArray(raw) ? raw : []) as Record<string, unknown>[];
    return {
      id: p.id,
      generatedAt: p.generatedAt.toISOString(),
      status: p.status,
      model: p.model,
      triggeredBy: p.triggeredBy,
      stepCount: steps.length,
      withTargetUrl: steps.filter((s) => s.targetUrl).length,
      withKind: steps.filter((s) => s.kind).length,
      kinds: steps.map((s) => s.kind ?? "null"),
    };
  });

  // Check for duplicates
  const allMatches = clientId.length === 32 && !clientId.includes("-")
    ? await prisma.client.findMany({
        where: { cerebroClientId: clientId },
        select: { id: true, name: true, status: true },
      })
    : [];

  return NextResponse.json({ clientId: internalId, duplicates: allMatches, plans: summary });
}
