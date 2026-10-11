import { Worker, Job } from "bullmq";
import { redisBullMQ } from "@/lib/redis-connection";
import { prisma } from "@/lib/db";
import { decomposeTask } from "../processors/task-decomposer";

/**
 * Worker dedicado para task:decompose.
 *
 * Separado de insights-worker y seo-advisor-worker para que:
 * - No dependa del Advisor (se retira en S2c)
 * - El evento 'failed' marque la tarea como FAILED directamente
 *   (no depender solo del watchdog)
 *
 * Escucha la cola "task-decompose" (cola propia, no ai-analysis).
 * Concurrencia: 3 — las descomposiciones son baratas (~$0.02 cada una).
 */

interface DecomposeJobData {
  taskId: string;
  clientId: string;
  candidateId: string;
}

const worker = new Worker<DecomposeJobData>(
  "task-decompose",
  async (job: Job<DecomposeJobData>) => {
    console.log(`[decompose-worker] Processing ${job.id} — task ${job.data.taskId}`);
    await decomposeTask(job.data);
  },
  {
    connection: redisBullMQ,
    concurrency: 3,
  }
);

// Mark task FAILED when the job fails permanently (after all retries)
worker.on("failed", (job, err) => {
  if (!job) return;
  const { taskId } = job.data;
  const errMsg = err.message ?? String(err);
  const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 1) - 1;

  if (isLastAttempt) {
    console.error(`[decompose-worker] Job ${job.id} failed permanently — marking task ${taskId} FAILED`);
    prisma.planTask.update({
      where: { id: taskId },
      data: {
        status: "FAILED",
        failureReason: `DECOMPOSE_JOB_FAILED: ${errMsg.slice(0, 500)}`,
      },
    }).catch((dbErr) => {
      console.error(`[decompose-worker] Failed to update task ${taskId}:`, dbErr);
    });
  }
});

worker.on("completed", (job) => {
  console.log(`[decompose-worker] Job ${job?.id} completed`);
});

worker.on("error", (err) => {
  console.error("[decompose-worker] Worker error:", err);
});

export { worker as decomposeWorker };
