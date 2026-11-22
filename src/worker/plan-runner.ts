/**
 * Worker de ejecución de plan mensual + terminal web + data collection.
 *
 * Entrypoint separado — se despliega como otro servicio en Easypanel
 * (mismo repo, otro comando de inicio: `npx tsx src/worker/plan-runner.ts`).
 *
 * Consume TODAS las colas de background:
 * - "plan-task-execution" — tareas AI del plan (concurrency 1)
 * - "terminal-sessions" — turnos de terminal interactiva (concurrency 1)
 * - "data-collection" — rank tracking, backlinks, competidores, GSC, audits
 * - "ai-analysis" — insights, análisis background
 * - "sync" — sync con Cerebro/Notion
 *
 * Los schedulers (cron jobs de BullMQ) se registran aquí al iniciar,
 * NO en el proceso web. Esto garantiza que siempre corran mientras
 * el worker esté vivo, independiente de restarts del proceso web.
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

// ── Data collection (cola "data-collection") ────────────────────────────────
// UN solo Worker para la cola "data-collection" que despacha por job.name.
// Antes había un Worker por tipo en la misma cola — BullMQ repartía round-robin
// y los jobs caían en el worker equivocado (completados sin trabajo).
import "@/server/jobs/workers/data-collection-dispatcher";

// ── Analysis workers (cola "ai-analysis") ───────────────────────────────────
import "@/server/jobs/workers/insights-worker";
import "@/server/jobs/workers/decompose-worker";

// ── Sync workers (cola "sync") ──────────────────────────────────────────────
import "@/server/jobs/workers/cerebro-sync-worker";
import "@/server/jobs/workers/cerebro-tasks-sync-worker";

import { execSync } from "child_process";
const COMMIT = (() => {
  const fromEnv = process.env.GIT_SHA;
  if (fromEnv && fromEnv !== "unknown") return fromEnv.slice(0, 7);
  try { return execSync("git rev-parse --short HEAD").toString().trim(); }
  catch { return "unknown"; }
})();

console.log(`[plan-runner] Starting worker... commit=${COMMIT}`);

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

// ── Initialize schedulers (cron jobs) ────────────────────────────────────────
// Runs idempotently — BullMQ deduplicates by jobId.
// This is the ONLY place schedulers are registered in production.
(async () => {
  try {
    const { initSchedulers } = await import("@/server/jobs/schedulers");
    const { initWatchdogScheduler } = await import("@/server/jobs/schedulers/watchdog-scheduler");
    await initSchedulers();
    await initWatchdogScheduler();
    console.log("[plan-runner] Schedulers registered.");
  } catch (err) {
    console.error("[plan-runner] Scheduler init failed:", err instanceof Error ? err.message : err);
  }
})();

console.log("[plan-runner] Worker ready. Listening on all queues.");
