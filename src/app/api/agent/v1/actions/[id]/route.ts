export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAgentAuth } from "@/lib/agent-auth";
import { PlanTaskStatus } from "@prisma/client";

const patchSchema = z.object({
  status: z.enum(["pending", "in_progress", "done", "discarded"]),
  note: z.string().max(2000).optional(),
  url: z.string().url().max(500).optional(),
});

const STATUS_MAP: Record<string, PlanTaskStatus> = {
  pending: "READY",
  in_progress: "RUNNING",
  done: "DONE",
  discarded: "VOIDED",
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

  const { status, note, url } = parsed.data;

  // Verify task exists
  const task = await prisma.planTask.findUnique({
    where: { id: taskId },
    select: { id: true, status: true, resultUrls: true },
  });
  if (!task) {
    return NextResponse.json({ error: "Action not found" }, { status: 404 });
  }

  const newStatus = STATUS_MAP[status];
  const resultUrls = url ? [...task.resultUrls, url] : task.resultUrls;

  const updated = await prisma.planTask.update({
    where: { id: taskId },
    data: {
      status: newStatus,
      resultUrls,
      ...(note && { failureReason: status === "discarded" ? note : undefined }),
      ...(note && status !== "discarded" && { voidReason: undefined }),
      ...(status === "done" && { completedAt: new Date(), completedById: "agent:grok" }),
    },
    select: { id: true, status: true, resultUrls: true },
  });

  return NextResponse.json({
    id: updated.id,
    status: status,
    resultUrls: updated.resultUrls,
  });
}

export const PATCH = withAgentAuth(handler);
