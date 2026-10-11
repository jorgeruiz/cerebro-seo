/**
 * Watchdog: finds stuck tasks and retries them once.
 *
 * - PLANNING > 10 min → re-enqueue decomposition (1 retry, then FAILED)
 * - RUNNING > RUNNING_TIMEOUT_MS → FAILED with EXECUTION_TIMEOUT
 *   (no retry — agent runs are expensive and have side effects)
 *
 * Called from actionSendToPlan after sending, and can be called
 * manually via a server action.
 */

import { prisma } from "@/lib/db";
import { decomposeQueue } from "@/server/jobs/queues";

const PLANNING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const RUNNING_TIMEOUT_MS = 15 * 60 * 1000; // 15 min (> AGENT_TIMEOUT_MIN default 10)

export async function runTaskWatchdog(planId: string): Promise<{
  retried: string[];
  failed: string[];
}> {
  const now = new Date();
  const planningCutoff = new Date(now.getTime() - PLANNING_TIMEOUT_MS);
  const runningCutoff = new Date(now.getTime() - RUNNING_TIMEOUT_MS);

  // ── 1. PLANNING stuck ───────────────────────────────────────────────────
  const stuckPlanning = await prisma.planTask.findMany({
    where: {
      planId,
      status: "PLANNING",
      createdAt: { lt: planningCutoff },
    },
    select: { id: true, title: true, failureReason: true },
  });

  // ── 2. RUNNING stuck ───────────────────────────────────────────────────
  const stuckRunning = await prisma.planTask.findMany({
    where: {
      planId,
      status: "RUNNING",
      updatedAt: { lt: runningCutoff },
    },
    select: { id: true, title: true },
  });

  const retried: string[] = [];
  const failed: string[] = [];

  // ── Handle PLANNING ─────────────────────────────────────────────────────
  for (const task of stuckPlanning) {
    if (task.failureReason?.startsWith("RETRY:")) {
      // Already retried once → mark as FAILED
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
      // First timeout → retry
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

  // ── Handle RUNNING ──────────────────────────────────────────────────────
  for (const task of stuckRunning) {
    // No retry for RUNNING — agent runs are expensive and have side effects (branches, PRs).
    // Mark FAILED and close any open TaskRun.
    await prisma.planTask.update({
      where: { id: task.id },
      data: {
        status: "FAILED",
        failureReason: `EXECUTION_TIMEOUT: la tarea estuvo en RUNNING más de ${RUNNING_TIMEOUT_MS / 60_000} min sin completar.`,
      },
    });

    // Close open TaskRuns for this task
    const openRuns = await prisma.taskRun.findMany({
      where: { taskId: task.id, status: "RUNNING" },
      select: { id: true },
    });
    for (const run of openRuns) {
      await prisma.taskRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          error: "EXECUTION_TIMEOUT",
          finishedAt: new Date(),
        },
      });
    }

    failed.push(task.id);
    console.log(`[watchdog] Task "${task.title}" → FAILED (RUNNING timeout)`);
  }

  return { retried, failed };
}
