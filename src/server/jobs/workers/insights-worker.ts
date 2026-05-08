import { createWorker } from "./base-worker";
import { runInsightsProcessor } from "../processors/insights-processor";
import { InsightsJobData } from "../queues";

/**
 * Worker del InsightsAgent.
 *
 * Concurrencia: 3 paralelos — cada uno para un cliente diferente.
 * Limitar a 3 evita bursts de costo de Claude y rate limits de Anthropic.
 *
 * Este worker es el más complejo del sistema — usa Sonnet 4.6 con
 * prompt caching de 3 bloques para minimizar costo (~$0.022 por ejecución).
 */
export const insightsWorker = createWorker<InsightsJobData>(
  "ai-analysis",
  async (job) => {
    const result = await runInsightsProcessor(job.data);

    console.log(
      `[insights] client=${job.data.clientId} trigger=${job.data.trigger} ` +
        `generated=${result.insightsGenerated} dupes=${result.skippedDuplicate} ` +
        `tokens=${result.tokensUsed.input}in/${result.tokensUsed.output}out/${result.tokensUsed.cached}cached ` +
        `cost=$${result.cost.toFixed(4)}`
    );

    return result;
  },
  { concurrency: 3 }
);
