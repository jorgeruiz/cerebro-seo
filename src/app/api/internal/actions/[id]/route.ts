export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/internal/actions/{id}
 * Authorization: Bearer ${SEO_INTERNAL_SECRET}
 *
 * Validates that a PlanTask (action) exists and returns its current state.
 * Used by Cerebro WEB connector to validate actionId before processing.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.SEO_INTERNAL_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const task = await prisma.planTask.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      status: true,
      kind: true,
      mode: true,
      category: true,
      actionType: true,
      priority: true,
      resultUrls: true,
      statusNote: true,
      completedAt: true,
      plan: {
        select: {
          id: true,
          month: true,
          status: true,
          clientId: true,
          client: {
            select: {
              cerebroClientId: true,
              name: true,
            },
          },
        },
      },
    },
  });

  if (!task) {
    return NextResponse.json({ error: "Action not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: task.id,
    title: task.title,
    status: task.status,
    kind: task.kind,
    mode: task.mode,
    category: task.category,
    actionType: task.actionType,
    priority: task.priority,
    resultUrls: task.resultUrls,
    statusNote: task.statusNote,
    completedAt: task.completedAt?.toISOString() ?? null,
    plan: {
      id: task.plan.id,
      month: task.plan.month,
      status: task.plan.status,
    },
    client: {
      id: task.plan.clientId,
      notionClientId: task.plan.client.cerebroClientId,
      name: task.plan.client.name,
    },
  });
}
