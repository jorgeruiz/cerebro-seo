export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAgentAuth } from "@/lib/agent-auth";
import type { MonthlyPlanStatus } from "@prisma/client";

const STATUS_REVERSE: Record<string, string> = {
  PLANNING: "draft",
  ACTIVE: "approved",
  IN_REVIEW: "in_progress",
  PUBLISHED: "completed",
  ARCHIVED: "archived",
};

const TASK_STATUS_REVERSE: Record<string, string> = {
  PLANNING: "pending",
  READY: "pending",
  RUNNING: "in_progress",
  WAITING_HUMAN: "waiting_approval",
  BLOCKED: "blocked",
  DONE: "done",
  VOIDED: "skipped",
  FAILED: "failed",
  NEEDS_DEFINITION: "pending",
  NEEDS_INPUT: "pending",
};

// ─── GET /api/agent/v1/plans/{planId} ────────────────────────────────────────

async function handleGet(
  _req: NextRequest,
  { params }: { params: Record<string, string> }
) {
  const planId = params.planId;

  const plan = await prisma.monthlyPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      clientId: true,
      month: true,
      status: true,
      source: true,
      focus: true,
      summary: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
      client: { select: { name: true } },
      tasks: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          order: true,
          title: true,
          objective: true,
          actionType: true,
          category: true,
          mode: true,
          kind: true,
          priority: true,
          status: true,
          assignee: true,
          requiresApproval: true,
          dataSource: true,
          targetKeyword: true,
          targetUrl: true,
          resultUrls: true,
          statusNote: true,
          statusChangedBy: true,
          statusChangedAt: true,
          blockedReason: true,
          voidReason: true,
          completedAt: true,
          completedById: true,
          createdAt: true,
        },
      },
    },
  });

  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const total = plan.tasks.length;
  const closed = plan.tasks.filter((t) =>
    t.status === "DONE" || t.status === "VOIDED"
  ).length;
  const blocked = plan.tasks.filter((t) => t.status === "BLOCKED").length;
  const waitingApproval = plan.tasks.filter((t) => t.status === "WAITING_HUMAN").length;
  const humanWork = plan.tasks.filter((t) => t.assignee === "felix").length;
  const skipped = plan.tasks.filter((t) => t.status === "VOIDED").length;

  const actions = plan.tasks.map((t) => ({
    id: t.id,
    order: t.order,
    title: t.title,
    description: t.objective || null,
    type: t.actionType ?? t.category,
    category: t.category,
    mode: t.mode.toLowerCase(),
    priority: t.priority,
    status: TASK_STATUS_REVERSE[t.status] ?? t.status.toLowerCase(),
    assignee: t.assignee ?? "ejecutor",
    requiresApproval: t.requiresApproval,
    dataSource: t.dataSource,
    targetKeyword: t.targetKeyword,
    url: t.targetUrl,
    resultUrls: t.resultUrls,
    note: t.statusNote ?? t.blockedReason ?? t.voidReason ?? null,
    statusChangedBy: t.statusChangedBy,
    statusChangedAt: t.statusChangedAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    completedBy: t.completedById,
    createdAt: t.createdAt.toISOString(),
  }));

  return NextResponse.json({
    id: plan.id,
    clientId: plan.clientId,
    clientName: plan.client.name,
    month: plan.month,
    status: STATUS_REVERSE[plan.status] ?? plan.status.toLowerCase(),
    source: plan.source,
    focus: plan.focus,
    summary: plan.summary,
    progress: total > 0 ? Math.round((closed / total) * 100) : 0,
    counts: { total, closed, blocked, waitingApproval, humanWork, skipped },
    completedAt: plan.completedAt?.toISOString() ?? null,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    actions,
  });
}

// ─── PATCH /api/agent/v1/plans/{planId} ──────────────────────────────────────

const patchSchema = z.object({
  status: z.enum(["draft", "approved", "in_progress", "completed"]),
});

const STATUS_MAP: Record<string, MonthlyPlanStatus> = {
  draft: "PLANNING",
  approved: "ACTIVE",
  in_progress: "IN_REVIEW",
  completed: "PUBLISHED",
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["approved"],
  approved: ["in_progress", "draft"],
  in_progress: ["completed", "approved"],
  completed: [], // terminal
};

async function handlePatch(
  req: NextRequest,
  { params }: { params: Record<string, string> }
) {
  const planId = params.planId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const plan = await prisma.monthlyPlan.findUnique({
    where: { id: planId },
    select: { id: true, status: true, tasks: { select: { status: true } } },
  });
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const currentStatus = STATUS_REVERSE[plan.status] ?? plan.status.toLowerCase();
  const targetStatus = parsed.data.status;
  const allowed = VALID_TRANSITIONS[currentStatus] ?? [];

  if (!allowed.includes(targetStatus)) {
    return NextResponse.json(
      {
        error: `Cannot transition from "${currentStatus}" to "${targetStatus}"`,
        allowedTransitions: allowed,
      },
      { status: 409 }
    );
  }

  // If completing, verify all tasks are closed
  if (targetStatus === "completed") {
    const open = plan.tasks.filter(
      (t) => t.status !== "DONE" && t.status !== "VOIDED"
    );
    if (open.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot complete plan: ${open.length} actions still open`,
          openActions: open.length,
        },
        { status: 409 }
      );
    }
  }

  const updated = await prisma.monthlyPlan.update({
    where: { id: planId },
    data: {
      status: STATUS_MAP[targetStatus],
      ...(targetStatus === "completed" && { completedAt: new Date() }),
    },
    select: { id: true, status: true, completedAt: true },
  });

  return NextResponse.json({
    id: updated.id,
    status: targetStatus,
    completedAt: updated.completedAt?.toISOString() ?? null,
  });
}

export const GET = withAgentAuth(handleGet);
export const PATCH = withAgentAuth(handlePatch);
