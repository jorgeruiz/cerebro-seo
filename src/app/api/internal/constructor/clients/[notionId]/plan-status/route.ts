export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateNotionClientId } from "@/lib/notion-client-id";

/**
 * GET /api/internal/constructor/clients/{notionId}/plan-status
 * Authorization: Bearer ${SEO_INTERNAL_SECRET}
 *
 * Returns the current monthly plan status for a client, including:
 * - Plan metadata (month, status, progress)
 * - All tasks with mode, status, results
 * - Currently running task (for live display)
 * - History of recent months
 *
 * Used by Constructor to show the client's SEO work panel.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { notionId: string } }
) {
  // 1. Auth guard
  const authHeader = req.headers.get("authorization");
  const secret = process.env.SEO_INTERNAL_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate notion_client_id
  const idValidation = validateNotionClientId(params.notionId);
  if (!idValidation.valid) {
    return NextResponse.json({ error: idValidation.message }, { status: 400 });
  }
  const notionClientId = idValidation.normalized;

  // 3. Lookup client
  const client = await prisma.client.findUnique({
    where: { cerebroClientId: notionClientId },
    select: { id: true, name: true, cerebroClientId: true },
  });

  if (!client) {
    return NextResponse.json({
      client: { notion_client_id: notionClientId, nombre: null },
      plan: null,
      history: [],
    });
  }

  // 4. Get current plan (most recent non-archived)
  const plan = await prisma.monthlyPlan.findFirst({
    where: {
      clientId: client.id,
      status: { not: "ARCHIVED" },
    },
    orderBy: { month: "desc" },
    include: {
      tasks: {
        orderBy: { order: "asc" },
        include: {
          steps: {
            orderBy: { order: "asc" },
            select: { id: true, title: true, type: true, status: true, order: true },
          },
          runs: {
            orderBy: { startedAt: "desc" },
            take: 1,
            select: {
              status: true,
              changedRoutes: true,
              logTail: true,
              finishedAt: true,
              costUsd: true,
            },
          },
        },
      },
    },
  });

  // 5. Get month history (last 6 months)
  const history = await prisma.monthlyPlan.findMany({
    where: { clientId: client.id },
    orderBy: { month: "desc" },
    take: 6,
    select: {
      month: true,
      status: true,
      completedAt: true,
      notionUploadedAt: true,
      _count: { select: { tasks: true } },
    },
  });

  if (!plan) {
    return NextResponse.json({
      client: { notion_client_id: client.cerebroClientId, nombre: client.name },
      plan: null,
      history: history.map(formatHistoryEntry),
    });
  }

  // 6. Calculate progress
  const totalTasks = plan.tasks.length;
  const doneTasks = plan.tasks.filter((t) => t.status === "DONE").length;
  const voidedTasks = plan.tasks.filter((t) => t.status === "VOIDED").length;
  const activeTasks = totalTasks - voidedTasks;
  const progress = activeTasks > 0 ? Math.round((doneTasks / activeTasks) * 100) : 0;

  // 7. Find currently running task
  const runningTask = plan.tasks.find((t) => t.status === "RUNNING");
  const waitingTask = plan.tasks.find((t) => t.status === "WAITING_HUMAN");
  const currentTask = runningTask ?? waitingTask;

  // 8. Build task list
  const tasks = plan.tasks
    .filter((t) => t.status !== "VOIDED")
    .map((t) => {
      const lastRun = t.runs[0] ?? null;
      const currentStep = t.steps.find((s) => s.status === "RUNNING" || s.status === "WAITING_HUMAN");
      const nextPendingStep = t.steps.find((s) => s.status === "PENDING");

      return {
        title: t.title,
        status: t.status,
        mode: t.mode,
        category: t.category,
        kind: t.kind,
        priority: t.priority,
        resultUrls: t.resultUrls,
        completedAt: t.completedAt?.toISOString() ?? null,
        // Step progress
        stepsTotal: t.steps.length,
        stepsDone: t.steps.filter((s) => s.status === "DONE").length,
        // Current activity
        currentStep: currentStep?.title ?? nextPendingStep?.title ?? null,
        currentStepType: currentStep?.type ?? nextPendingStep?.type ?? null,
        // Last run info
        lastRunStatus: lastRun?.status ?? null,
        lastRunRoutes: lastRun?.changedRoutes ?? [],
        lastRunNote: lastRun?.logTail?.slice(0, 200) ?? null,
      };
    });

  // 9. Build response
  return NextResponse.json({
    client: {
      notion_client_id: client.cerebroClientId,
      nombre: client.name,
    },
    plan: {
      month: plan.month,
      status: plan.status,
      progress,
      taskCount: activeTasks,
      tasksDone: doneTasks,
      currentTask: currentTask ? {
        title: currentTask.title,
        status: currentTask.status,
        mode: currentTask.mode,
        step: currentTask.steps.find((s) => s.status === "RUNNING" || s.status === "WAITING_HUMAN")?.title ?? null,
      } : null,
      tasks,
      // Notion sync status
      notionUploadedAt: plan.notionUploadedAt?.toISOString() ?? null,
      notionEstrategiaId: plan.notionEstrategiaId ?? null,
      // Timestamps
      createdAt: plan.createdAt.toISOString(),
      completedAt: plan.completedAt?.toISOString() ?? null,
      mergedAt: plan.mergedAt?.toISOString() ?? null,
    },
    history: history.map(formatHistoryEntry),
  });
}

function formatHistoryEntry(h: {
  month: string;
  status: string;
  completedAt: Date | null;
  notionUploadedAt: Date | null;
  _count: { tasks: number };
}) {
  return {
    month: h.month,
    status: h.status,
    taskCount: h._count.tasks,
    completedAt: h.completedAt?.toISOString() ?? null,
    notionUploadedAt: h.notionUploadedAt?.toISOString() ?? null,
  };
}
