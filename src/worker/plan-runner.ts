/**
 * Worker de ejecución de plan mensual.
 *
 * Entrypoint separado — se despliega como otro servicio en Easypanel
 * (mismo repo, otro comando de inicio: `npx tsx src/worker/plan-runner.ts`).
 *
 * El proceso web SOLO encola jobs en "plan-task-execution".
 * Este worker los consume con concurrency 1.
 *
 * Graceful shutdown: al recibir SIGTERM el worker termina el job en curso
 * (no acepta nuevos) y sale limpiamente. Easypanel da 30s antes de SIGKILL.
 */

// Validar env del worker (falla rápido si faltan vars)
import "./env";

import { Worker } from "bullmq";
import { redisBullMQ } from "@/lib/redis-connection";
import { processTask } from "./task-processor";
import type { PlanTaskJobData } from "@/server/jobs/queues";

console.log("[plan-runner] Starting plan task worker...");

let isShuttingDown = false;

const worker = new Worker<PlanTaskJobData>(
  "plan-task-execution",
  async (job) => {
    if (isShuttingDown) {
      // During shutdown, don't start new work — the job will be
      // returned to the queue automatically by BullMQ when we close.
      console.log(`[plan-runner] Shutdown in progress, skipping job ${job.id}`);
      throw new Error("WORKER_SHUTTING_DOWN");
    }
    console.log(`[plan-runner] Processing job ${job.id} — task ${job.data.taskId}`);
    await processTask(job.data);
  },
  {
    connection: redisBullMQ,
    concurrency: 1,
    lockDuration: 600_000,    // 10 min — agent tasks can take several minutes
    lockRenewTime: 150_000,   // renew lock every 2.5 min (< half of lockDuration)
    stalledInterval: 300_000, // check stalled every 5 min
  }
);

worker.on("completed", (job) => {
  console.log(`[plan-runner] Job ${job?.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[plan-runner] Job ${job?.id} failed:`, err.message);
});

worker.on("error", (err) => {
  console.error("[plan-runner] Worker error:", err);
});

// Graceful shutdown: stop accepting new jobs, wait for current to finish
async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("[plan-runner] SIGTERM received. Finishing current job...");

  // worker.close() waits for the active job to complete (up to 25s)
  // then returns. If the job takes longer, Easypanel will SIGKILL.
  try {
    await worker.close();
    console.log("[plan-runner] Worker closed cleanly.");
  } catch (err) {
    console.error("[plan-runner] Error during shutdown:", err);
  }

  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log("[plan-runner] Worker ready. Waiting for jobs on queue 'plan-task-execution'...");
