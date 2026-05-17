import { Worker, Job, WorkerOptions } from "bullmq";
import { Decimal } from "@prisma/client/runtime/library";
import { redisBullMQ } from "@/lib/redis";
import { prisma } from "@/lib/db";

// Jobs críticos que disparan alerta inmediata al fallar permanentemente
const CRITICAL_JOBS = new Set(["cycle:close", "report:monthly"]);

export interface JobMetrics {
  jobName: string;
  clientId?: string;
  status: "success" | "failed";
  durationMs: number;
  tokensUsed?: { input: number; output: number; cached: number };
  cost?: number;
}

/**
 * Calcula el costo en USD de una llamada a Claude.
 * Precios: Sonnet 4.6 — input $3/MTok, cached $0.30/MTok, output $15/MTok
 *          Haiku 4.5  — input $0.25/MTok, cached $0.03/MTok, output $1.25/MTok
 */
export function calculateClaudeCost(
  model: "sonnet-4-6" | "haiku-4-5",
  inputTokens: number,
  outputTokens: number,
  cachedTokens = 0
): number {
  const pricing = {
    "sonnet-4-6": { input: 3, cachedInput: 0.3, output: 15 },
    "haiku-4-5": { input: 0.25, cachedInput: 0.03, output: 1.25 },
  }[model];

  const uncachedInput = Math.max(0, inputTokens - cachedTokens);
  return (
    (uncachedInput * pricing.input +
      cachedTokens * pricing.cachedInput +
      outputTokens * pricing.output) /
    1_000_000
  );
}

/**
 * Registra el uso de una API externa en la tabla ApiUsage.
 * Llamar después de cada request a DataForSEO, Claude, etc.
 */
export async function logApiUsage(params: {
  provider: string;
  endpoint: string;
  cost: number;
  clientId?: string;
}): Promise<void> {
  await prisma.apiUsage.create({
    data: {
      provider: params.provider,
      endpoint: params.endpoint,
      cost: new Decimal(params.cost.toFixed(6)),
      clientId: params.clientId ?? null,
    },
  });
}

/**
 * Registra el resultado de un job en JobLog.
 * Usado para el dashboard de observabilidad.
 */
async function logJobResult(
  job: Job,
  status: "success" | "failed",
  error?: string
): Promise<void> {
  await prisma.jobLog.create({
    data: {
      jobName: job.name,
      clientId: (job.data as { clientId?: string }).clientId ?? null,
      status,
      error: error ?? null,
      attempts: job.attemptsMade + 1,
    },
  });
}

/**
 * Notifica a Cerebro de un evento crítico vía webhook.
 * Solo se usa para fallos permanentes de jobs críticos.
 */
async function notifyCerebroCriticalFailure(
  jobName: string,
  clientId?: string
): Promise<void> {
  const cerebro = process.env.CEREBRO_API_URL;
  const secret = process.env.CEREBRO_INTERNAL_SECRET;
  if (!cerebro || !secret) return;

  try {
    await fetch(`${cerebro}/api/webhooks/seo-alerts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify({
        type: "critical_job_failed",
        jobName,
        clientId,
        ts: new Date().toISOString(),
      }),
    });
  } catch {
    // No lanzar — el job ya falló, no hay que bloquear el handler
  }
}

/**
 * Factory que crea un Worker de BullMQ con logging, ApiUsage y manejo de errores.
 *
 * Uso:
 *   export const myWorker = createWorker("queue-name", async (job) => { ... });
 */
export function createWorker<TData = unknown, TResult = unknown>(
  queueName: string,
  processor: (job: Job<TData>) => Promise<TResult>,
  options: Partial<WorkerOptions> = {}
): Worker<TData, TResult> {
  const worker = new Worker<TData, TResult>(
    queueName,
    async (job: Job<TData>) => {
      const start = Date.now();
      try {
        const result = await processor(job);
        const durationMs = Date.now() - start;

        // Log asíncrono — no bloquea el resultado
        logJobResult(job, "success").catch(console.error);

        console.log(
          `[job:ok] ${job.name} client=${(job.data as { clientId?: string }).clientId ?? "-"} ${durationMs}ms`
        );

        return result;
      } catch (err) {
        const isLastAttempt =
          job.attemptsMade >= (job.opts.attempts ?? 1) - 1;

        if (isLastAttempt) {
          const errMsg = err instanceof Error ? err.message : String(err);

          logJobResult(job, "failed", errMsg).catch(console.error);

          if (CRITICAL_JOBS.has(job.name)) {
            notifyCerebroCriticalFailure(
              job.name,
              (job.data as { clientId?: string }).clientId
            ).catch(console.error);
          }

          console.error(
            `[job:fail] ${job.name} permanent after ${job.attemptsMade + 1} attempts — ${errMsg}`
          );
        }

        throw err; // BullMQ reintentará según la config del queue
      }
    },
    {
      connection: redisBullMQ,
      concurrency: 2,
      ...options,
    }
  );

  worker.on("error", (err) => {
    console.error(`[worker:error] ${queueName}:`, err);
  });

  return worker;
}
