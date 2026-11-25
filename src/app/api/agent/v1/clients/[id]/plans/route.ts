export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAgentAuth } from "@/lib/agent-auth";

// ─── POST /api/agent/v1/clients/{id}/plans ──────────────────────────────────

const createSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Format: YYYY-MM"),
  focus: z.enum(["all", "technical_only"]).default("all"),
  summary: z.string().max(5000).optional(),
  source: z.literal("agent").default("agent"),
});

async function handlePost(
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { month, focus, summary } = parsed.data;

  // Check if plan already exists for this client+month
  const existing = await prisma.monthlyPlan.findUnique({
    where: { clientId_month: { clientId, month } },
    select: { id: true, status: true, source: true },
  });

  if (existing) {
    // Allow replacement only if still in PLANNING (draft)
    if (existing.status !== "PLANNING") {
      return NextResponse.json(
        {
          error: "Plan already exists and is not a draft",
          existingPlanId: existing.id,
          status: existing.status,
        },
        { status: 409 }
      );
    }
    // Delete existing draft and its tasks to replace
    await prisma.monthlyPlan.delete({ where: { id: existing.id } });
  }

  const plan = await prisma.monthlyPlan.create({
    data: {
      clientId,
      month,
      status: "PLANNING",
      source: "agent",
      focus,
      summary: summary ?? null,
    },
    select: {
      id: true,
      month: true,
      status: true,
      source: true,
      focus: true,
      summary: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    id: plan.id,
    month: plan.month,
    status: "draft",
    source: plan.source,
    focus: plan.focus,
    summary: plan.summary,
    createdAt: plan.createdAt.toISOString(),
    replaced: !!existing,
  }, { status: 201 });
}

// ─── GET /api/agent/v1/clients/{id}/plans?month=YYYY-MM ─────────────────────

async function handleGet(
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

  const month = req.nextUrl.searchParams.get("month");

  const plans = await prisma.monthlyPlan.findMany({
    where: {
      clientId,
      ...(month && { month }),
    },
    orderBy: { month: "desc" },
    take: 12,
    select: {
      id: true,
      month: true,
      status: true,
      source: true,
      focus: true,
      summary: true,
      completedAt: true,
      createdAt: true,
      _count: { select: { tasks: true } },
      tasks: {
        select: { status: true },
      },
    },
  });

  const STATUS_REVERSE: Record<string, string> = {
    PLANNING: "draft",
    ACTIVE: "approved",
    IN_REVIEW: "in_progress",
    PUBLISHED: "completed",
    ARCHIVED: "archived",
  };

  const result = plans.map((p) => {
    const total = p.tasks.length;
    const closed = p.tasks.filter((t) =>
      t.status === "DONE" || t.status === "VOIDED"
    ).length;

    return {
      id: p.id,
      month: p.month,
      status: STATUS_REVERSE[p.status] ?? p.status.toLowerCase(),
      source: p.source,
      focus: p.focus,
      summary: p.summary,
      actionCount: total,
      progress: total > 0 ? Math.round((closed / total) * 100) : 0,
      completedAt: p.completedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    };
  });

  return NextResponse.json({ plans: result });
}

export const POST = withAgentAuth(handlePost);
export const GET = withAgentAuth(handleGet);
