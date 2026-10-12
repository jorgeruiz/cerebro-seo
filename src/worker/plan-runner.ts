/**
 * Worker de ejecución de plan mensual + terminal web.
 *
 * Entrypoint separado — se despliega como otro servicio en Easypanel
 * (mismo repo, otro comando de inicio: `npx tsx src/worker/plan-runner.ts`).
 *
 * Consume dos colas:
 * - "plan-task-execution" — tareas AI del plan (concurrency 1)
 * - "terminal-sessions" — turnos de terminal interactiva (concurrency 1)
 *
 * Graceful shutdown: SIGTERM → termina jobs en curso, sale limpiamente.
 */

// Validar env del worker (falla rápido si faltan vars)
import "./env";

import { Worker } from "bullmq";
import { redisBullMQ } from "@/lib/redis-connection";
import { processTask } from "./task-processor";
import type { PlanTaskJobData } from "@/server/jobs/queues";

// Import terminal handler — registers its own Worker on "terminal-sessions"
import "./terminal-handler";

console.log("[plan-runner] Starting plan task worker...");

let isShuttingDown = false;

const worker = new Worker<PlanTaskJobData>(
  "plan-task-execution",
  async (job) => {
    if (isShuttingDown) {
      console.log(`[plan-runner] Shutdown in progress, skipping job ${job.id}`);
      throw new Error("WORKER_SHUTTING_DOWN");
    }
    console.log(`[plan-runner] Processing job ${job.id} — task ${job.data.taskId}`);
    await processTask(job.data);
  },
  {
    connection: redisBullMQ,
    concurrency: 1,
    lockDuration: 600_000,
    lockRenewTime: 150_000,
    stalledInterval: 300_000,
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
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("[plan-runner] SIGTERM received. Finishing current jobs...");

  try {
    await worker.close();
    console.log("[plan-runner] Workers closed cleanly.");
  } catch (err) {
    console.error("[plan-runner] Error during shutdown:", err);
  }

  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log("[plan-runner] Worker ready. Listening on plan-task-execution + terminal-sessions.");
