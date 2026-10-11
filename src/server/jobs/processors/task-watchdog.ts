/**
 * Watchdog: finds stuck tasks and retries/fails them.
 *
 * - PLANNING > 10 min → re-enqueue decomposition (1 retry, then FAILED)
 * - TaskRun RUNNING > AGENT_TIMEOUT + margin → FAILED (per run)
 * - Task RUNNING with NO runs > 10 min → re-enqueue (lost job)
 *
 * Called every 5 min by watchdog-scheduler.
 */

import { prisma } from "@/lib/db";
import { decomposeQueue, planTaskQueue } from "@/server/jobs/queues";

const PLANNING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const RUN_TIMEOUT_MS = 15 * 60 * 1000; // agent timeout + margin
const ENQUEUED_TIMEOUT_MS = 10 * 60 * 1000; // task set to RUNNING but no run started

export async function runTaskWatchdog(planId: string): Promise<{
  retried: string[];
  failed: string[];
}> {
  const now = new Date();
  const planningCutoff = new Date(now.getTime() - PLANNING_TIMEOUT_MS);
  const runCutoff = new Date(now.getTime() - RUN_TIMEOUT_MS);
  const enqueuedCutoff = new Date(now.getTime() - ENQUEUED_TIMEOUT_MS);

  // ── 1. PLANNING stuck ───────────────────────────────────────────────────
  const stuckPlanning = await prisma.planTask.findMany({
    where: {
      planId,
      status: "PLANNING",
      createdAt: { lt: planningCutoff },
    },
    select: { id: true, title: true, failureReason: true },
  });

  // ── 2. TaskRun stuck in RUNNING ─────────────────────────────────────────
  const stuckRuns = await prisma.taskRun.findMany({
    where: {
      task: { planId },
      status: "RUNNING",
      startedAt: { lt: runCutoff },
    },
    select: {
      id: true, taskId: true, stepId: true,
      task: { select: { title: true } },
    },
  });

  // ── 3. Task RUNNING with NO runs (lost job) ────────────────────────────
  const stuckEnqueued = await prisma.planTask.findMany({
    where: {
      planId,
      status: "RUNNING",
      updatedAt: { lt: enqueuedCutoff },
      runs: { none: { status: "RUNNING" } }, // no active run
    },
    select: { id: true, title: true, failureReason: true },
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
      console.log(`[watchdog] Task "${task.title}" → retried (PLANNING)`);
    }
  }

  // ── Handle stuck TaskRuns ───────────────────────────────────────────────
  const failedTaskIds = new Set<string>();

  for (const run of stuckRuns) {
    await prisma.taskRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        error: `EXECUTION_TIMEOUT: el paso estuvo en RUNNING más de ${RUN_TIMEOUT_MS / 60_000} min.`,
        finishedAt: new Date(),
      },
    });

    if (run.stepId) {
      await prisma.planStep.update({
        where: { id: run.stepId },
        data: { status: "FAILED" },
      });
    }

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
      console.log(`[watchdog] Task "${run.task.title}" → FAILED (run timeout)`);
    }
  }

  // ── Handle lost jobs (RUNNING with no active run) ───────────────────────
  for (const task of stuckEnqueued) {
    if (task.failureReason?.startsWith("RETRY:enqueued")) {
      // Already retried once → FAILED
      await prisma.planTask.update({
        where: { id: task.id },
        data: {
          status: "FAILED",
          failureReason: "LOST_JOB: la tarea fue encolada pero el worker nunca la procesó después de 2 intentos.",
        },
      });
      failed.push(task.id);
      console.log(`[watchdog] Task "${task.title}" → FAILED (lost job, 2nd)`);
    } else {
      // First timeout → re-enqueue with backoff
      await prisma.planTask.update({
        where: { id: task.id },
        data: { failureReason: "RETRY:enqueued by watchdog" },
      });

      await planTaskQueue.add("execute", {
        taskId: task.id,
        triggeredById: "watchdog-retry",
      }, {
        delay: 5_000, // 5s backoff
      });

      retried.push(task.id);
      console.log(`[watchdog] Task "${task.title}" → re-enqueued (lost job)`);
    }
  }

  return { retried, failed };
}
