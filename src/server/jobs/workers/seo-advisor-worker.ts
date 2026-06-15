import { createWorker } from "./base-worker";
import { runAdvisorProcessor } from "@/lib/seo-advisor/advisor-processor";
import type { SeoAdvisorJobData } from "../queues";

/**
 * Worker del SeoAdvisorAgent.
 *
 * Genera el plan de "Próximos pasos sugeridos" para cada cliente SEO.
 * Corre diariamente a las 7 AM, justo después del InsightsAgent (6 AM).
 *
 * Concurrencia: 2 clientes en paralelo.
 * Costo estimado: ~$0.02/cliente/día (prompt caching reduce significativamente).
 */
export const seoAdvisorWorker = createWorker<SeoAdvisorJobData>(
  "ai-analysis",
  async (job) => {
    if (job.name !== "advisor:generate") return;

    const result = await runAdvisorProcessor({
      clientId: job.data.clientId,
      scheduled: true,
    });

    console.log(
      `[seo-advisor] client=${job.data.clientId} ` +
        `steps=${result.steps.length} ` +
        `tokens=${result.tokensUsed.input}in/${result.tokensUsed.output}out/${result.tokensUsed.cached}cached ` +
        `cost=$${result.cost.toFixed(4)}`
    );

    return result;
  },
  { concurrency: 2 }
);
