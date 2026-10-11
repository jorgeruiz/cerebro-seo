/**
 * Watchdog scheduler: corre cada 5 minutos para todos los planes activos.
 *
 * Detecta tareas stuck en PLANNING (>10 min) o RUNNING (>15 min)
 * y las retries/falla según la política.
 *
 * Usa un BullMQ repeatable job para garantizar que corre
 * incluso si nadie abre la UI del Plan Mensual.
 */

import { Queue, Worker } from "bullmq";
import { redisBullMQ } from "@/lib/redis-connection";
import { prisma } from "@/lib/db";
import { runTaskWatchdog } from "../processors/task-watchdog";

const WATCHDOG_QUEUE = "plan-watchdog";

const queue = new Queue(WATCHDOG_QUEUE, {
  connection: redisBullMQ,
  defaultJobOptions: {
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 20 },
  },
});

const worker = new Worker(
  WATCHDOG_QUEUE,
  async () => {
    // Find all plans with tasks in PLANNING or RUNNING
    const activePlans = await prisma.monthlyPlan.findMany({
      where: {
        status: { in: ["PLANNING", "ACTIVE"] },
        tasks: {
          some: { status: { in: ["PLANNING", "RUNNING"] } },
        },
      },
      select: { id: true },
    });

    if (activePlans.length === 0) return;

    let totalRetried = 0;
    let totalFailed = 0;

    for (const plan of activePlans) {
      const result = await runTaskWatchdog(plan.id);
      totalRetried += result.retried.length;
      totalFailed += result.failed.length;
    }

    if (totalRetried > 0 || totalFailed > 0) {
      console.log(
        `[watchdog-scheduler] Checked ${activePlans.length} plan(s): ${totalRetried} retried, ${totalFailed} failed`
      );
    }
  },
  {
    connection: redisBullMQ,
    concurrency: 1,
  }
);

worker.on("error", (err) => {
  console.error("[watchdog-scheduler] Worker error:", err);
});

export async function initWatchdogScheduler(): Promise<void> {
  await queue.add(
    "watchdog:sweep",
    {},
    {
      repeat: { every: 5 * 60 * 1000 }, // every 5 minutes
      jobId: "watchdog:sweep:global",
    }
  );
  console.log("[watchdog-scheduler] Registered: every 5 min");
}
