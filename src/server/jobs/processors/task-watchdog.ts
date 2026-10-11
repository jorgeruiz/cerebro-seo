/**
 * Watchdog: finds stuck tasks and retries/fails them.
 *
 * - PLANNING > 10 min → re-enqueue decomposition (1 retry, then FAILED)
 * - TaskRun RUNNING > AGENT_TIMEOUT + margin → FAILED (measured per run, not per task)
 *
 * Called every 5 min by watchdog-scheduler.
 */

import { prisma } from "@/lib/db";
import { decomposeQueue } from "@/server/jobs/queues";

const PLANNING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
// Agent timeout default is 10 min. We add 5 min margin for npm ci + build.
const RUN_TIMEOUT_MS = 15 * 60 * 1000;

export async function runTaskWatchdog(planId: string): Promise<{
  retried: string[];
  failed: string[];
}> {
  const now = new Date();
  const planningCutoff = new Date(now.getTime() - PLANNING_TIMEOUT_MS);
  const runCutoff = new Date(now.getTime() - RUN_TIMEOUT_MS);

  // ── 1. PLANNING stuck (task-level) ──────────────────────────────────────
  const stuckPlanning = await prisma.planTask.findMany({
    where: {
      planId,
      status: "PLANNING",
      createdAt: { lt: planningCutoff },
    },
    select: { id: true, title: true, failureReason: true },
  });

  // ── 2. TaskRun stuck in RUNNING (run-level, not task-level) ─────────────
  const stuckRuns = await prisma.taskRun.findMany({
    where: {
      task: { planId },
      status: "RUNNING",
      startedAt: { lt: runCutoff },
    },
    select: {
      id: true,
      taskId: true,
      stepId: true,
      task: { select: { title: true } },
    },
  });

  const retried: string[] = [];
  const failed: string[] = [];

  // ── Handle PLANNING ─────────────────────────────────────────────────────
  for (const task of stuckPlanning) {
    if (task.failureReason?.startsWith("RETRY:")) {
      await prisma.planTask.update({
        where: { id: task.id },
        data: {
          status: "FAILED",
          failureReason: "DECOMPOSITION_TIMEOUT: la descomposición en pasos no completó después de 2 intentos.",
        },
      });
      failed.push(task.id);
      console.log(`[watchdog] Task "${task.title}" → FAILED (2nd timeout)`);
    } else {
      await prisma.planTask.update({
        where: { id: task.id },
        data: { failureReason: "RETRY: re-enqueued by watchdog" },
      });

      const plan = await prisma.monthlyPlan.findUniqueOrThrow({
        where: { id: planId },
        select: { clientId: true },
      });

      await decomposeQueue.add("task:decompose", {
        taskId: task.id,
        clientId: plan.clientId,
        candidateId: "watchdog-retry",
      });

      retried.push(task.id);
      console.log(`[watchdog] Task "${task.title}" → retried`);
    }
  }

  // ── Handle stuck TaskRuns ───────────────────────────────────────────────
  // Group by task to avoid marking the same task FAILED multiple times
  const failedTaskIds = new Set<string>();

  for (const run of stuckRuns) {
    // Close the stuck run
    await prisma.taskRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        error: `EXECUTION_TIMEOUT: el paso estuvo en RUNNING más de ${RUN_TIMEOUT_MS / 60_000} min.`,
        finishedAt: new Date(),
      },
    });

    // Mark the step as FAILED if stepId exists
    if (run.stepId) {
      await prisma.planStep.update({
        where: { id: run.stepId },
        data: { status: "FAILED" },
      });
    }

    // Mark parent task as FAILED (once per task)
    if (!failedTaskIds.has(run.taskId)) {
      failedTaskIds.add(run.taskId);
      await prisma.planTask.update({
        where: { id: run.taskId },
        data: {
          status: "FAILED",
          failureReason: `EXECUTION_TIMEOUT: un paso estuvo en RUNNING más de ${RUN_TIMEOUT_MS / 60_000} min.`,
        },
      });
      failed.push(run.taskId);
      console.log(`[watchdog] Task "${run.task.title}" → FAILED (run ${run.id} timeout)`);
    }
  }

  return { retried, failed };
}
