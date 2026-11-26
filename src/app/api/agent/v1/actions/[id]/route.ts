export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAgentAuth } from "@/lib/agent-auth";
import { PlanTaskStatus } from "@prisma/client";

const patchSchema = z.object({
  status: z.enum(["pending", "in_progress", "blocked", "waiting_approval", "done", "skipped"]),
  note: z.string().max(2000).optional(),
  url: z.string().url().max(500).optional(),
  steps: z.array(z.string().max(1000)).max(20).optional(),
});

const STATUS_MAP: Record<string, PlanTaskStatus> = {
  pending: "READY",
  in_progress: "RUNNING",
  blocked: "BLOCKED",
  waiting_approval: "WAITING_HUMAN",
  done: "DONE",
  skipped: "VOIDED",
};


async function handler(
  req: NextRequest,
  { params }: { params: Record<string, string> }
) {
  const taskId = params.id;

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

  const { status, note, url, steps } = parsed.data;

  // blocked and skipped require a note
  if ((status === "blocked" || status === "skipped") && !note) {
    return NextResponse.json(
      { error: `Status "${status}" requires a note` },
      { status: 400 }
    );
  }

  // Verify task exists
  const task = await prisma.planTask.findUnique({
    where: { id: taskId },
    select: { id: true, status: true, resultUrls: true, planId: true },
  });
  if (!task) {
    return NextResponse.json({ error: "Action not found" }, { status: 404 });
  }

  const newStatus = STATUS_MAP[status];
  const resultUrls = url ? [...task.resultUrls, url] : task.resultUrls;
  const now = new Date();

  const updated = await prisma.planTask.update({
    where: { id: taskId },
    data: {
      status: newStatus,
      resultUrls,
      statusNote: note ?? null,
      statusChangedBy: "agent",
      statusChangedAt: now,
      ...(status === "blocked" && { blockedReason: note }),
      ...(status === "skipped" && { voidReason: note }),
      ...(status === "done" && { completedAt: now, completedById: "agent" }),
      ...(steps && { agentSteps: steps }),
    },
    select: {
      id: true,
      status: true,
      resultUrls: true,
      statusNote: true,
      statusChangedBy: true,
      statusChangedAt: true,
      completedAt: true,
      agentSteps: true,
    },
  });

  // Auto-complete plan if all actions are closed
  if (status === "done" || status === "skipped") {
    const plan = await prisma.monthlyPlan.findUnique({
      where: { id: task.planId },
      select: {
        id: true,
        status: true,
        source: true,
        tasks: { select: { status: true } },
      },
    });
    if (plan && plan.source === "agent") {
      const allClosed = plan.tasks.every(
        (t) => t.status === "DONE" || t.status === "VOIDED"
      );
      if (allClosed && plan.status !== "PUBLISHED") {
        await prisma.monthlyPlan.update({
          where: { id: plan.id },
          data: { status: "PUBLISHED", completedAt: now },
        });
      }
    }
  }

  return NextResponse.json({
    id: updated.id,
    status,
    resultUrls: updated.resultUrls,
    note: updated.statusNote,
    changedBy: updated.statusChangedBy,
    changedAt: updated.statusChangedAt?.toISOString() ?? null,
    completedAt: updated.completedAt?.toISOString() ?? null,
    steps: updated.agentSteps ?? null,
  });
}

export const PATCH = withAgentAuth(handler);
