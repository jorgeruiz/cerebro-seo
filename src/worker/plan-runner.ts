/**
 * Worker de ejecución de plan mensual.
 *
 * Entrypoint separado — se despliega como otro servicio en Easypanel
 * (mismo repo, otro comando de inicio: `npx tsx src/worker/plan-runner.ts`).
 *
 * El proceso web SOLO encola jobs en "plan-task-execution".
 * Este worker los consume con concurrency 1.
 */

// Validar env del worker (falla rápido si faltan vars)
import "./env";

import { Worker } from "bullmq";
import { redisBullMQ } from "@/lib/redis-connection";
import { processTask } from "./task-processor";
import type { PlanTaskJobData } from "@/server/jobs/queues";

console.log("[plan-runner] Starting plan task worker...");

const worker = new Worker<PlanTaskJobData>(
  "plan-task-execution",
  async (job) => {
    console.log(`[plan-runner] Processing job ${job.id} — task ${job.data.taskId}`);
    await processTask(job.data);
  },
  {
    connection: redisBullMQ,
    concurrency: 1,
    lockDuration: 600_000,    // 10 min — agent tasks can take several minutes
    lockRenewTime: 300_000,   // renew lock every 5 min
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

// Graceful shutdown
async function shutdown() {
  console.log("[plan-runner] Shutting down...");
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log("[plan-runner] Worker ready. Waiting for jobs on queue 'plan-task-execution'...");
