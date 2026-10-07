/**
 * Watchdog: finds stuck tasks and retries them once.
 *
 * - PLANNING > 10 min → re-enqueue decomposition
 * - If retry also stalls → FAILED with "DECOMPOSITION_TIMEOUT"
 *
 * Called from actionSendToPlan after sending, and can be called
 * manually via a server action.
 */

import { prisma } from "@/lib/db";
import { aiAnalysisQueue } from "@/server/jobs/queues";

const PLANNING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export async function runTaskWatchdog(planId: string): Promise<{
  retried: string[];
  failed: string[];
}> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - PLANNING_TIMEOUT_MS);

  // Find tasks stuck in PLANNING past the cutoff
  const stuckTasks = await prisma.planTask.findMany({
    where: {
      planId,
      status: "PLANNING",
      createdAt: { lt: cutoff },
    },
    select: { id: true, title: true, failureReason: true },
  });

  const retried: string[] = [];
  const failed: string[] = [];

  for (const task of stuckTasks) {
    // Check if already retried (failureReason starts with "RETRY:")
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

      // Get clientId from plan
      const plan = await prisma.monthlyPlan.findUniqueOrThrow({
        where: { id: planId },
        select: { clientId: true },
      });

      await aiAnalysisQueue.add("task:decompose", {
        taskId: task.id,
        clientId: plan.clientId,
        candidateId: "watchdog-retry",
      });

      retried.push(task.id);
      console.log(`[watchdog] Task "${task.title}" → retried`);
    }
  }

  return { retried, failed };
}
