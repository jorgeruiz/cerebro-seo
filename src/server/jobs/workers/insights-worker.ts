import { createWorker } from "./base-worker";
import { runInsightsProcessor } from "../processors/insights-processor";
import { runAdvisorProcessor } from "@/lib/seo-advisor/advisor-processor";
import { decomposeTask } from "../processors/task-decomposer";
import { InsightsJobData, SeoAdvisorJobData } from "../queues";

/**
 * Worker del InsightsAgent.
 *
 * Concurrencia: 3 paralelos — cada uno para un cliente diferente.
 * Limitar a 3 evita bursts de costo de Claude y rate limits de Anthropic.
 *
 * Este worker es el más complejo del sistema — usa Sonnet 4.6 con
 * prompt caching de 3 bloques para minimizar costo (~$0.022 por ejecución).
 *
 * NOTA: También procesa advisor:generate porque ambos workers comparten
 * la cola ai-analysis y BullMQ asigna jobs a cualquier worker disponible.
 */
export const insightsWorker = createWorker<InsightsJobData | SeoAdvisorJobData>(
  "ai-analysis",
  async (job) => {
    // Dispatch por nombre de job — ambos workers comparten la cola ai-analysis
    if (job.name === "advisor:generate") {
      const data = job.data as SeoAdvisorJobData;
      const result = await runAdvisorProcessor({
        clientId: data.clientId,
        scheduled: !data.force,
      });
      return result as never;
    }

    if (job.name === "task:decompose") {
      await decomposeTask(job.data as { taskId: string; clientId: string; candidateId: string });
      return undefined as never;
    }

    if (job.name !== "insights:generate") return undefined as never;

    const result = await runInsightsProcessor(job.data as InsightsJobData);

    console.log(
      `[insights] client=${job.data.clientId} trigger=${(job.data as InsightsJobData).trigger} ` +
        `generated=${result.insightsGenerated} dupes=${result.skippedDuplicate} ` +
        `tokens=${result.tokensUsed.input}in/${result.tokensUsed.output}out/${result.tokensUsed.cached}cached ` +
        `cost=$${result.cost.toFixed(4)}`
    );

    return result;
  },
  { concurrency: 3 }
);
