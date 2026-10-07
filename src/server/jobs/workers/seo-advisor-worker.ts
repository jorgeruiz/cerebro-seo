import { createWorker } from "./base-worker";
import { runAdvisorProcessor } from "@/lib/seo-advisor/advisor-processor";
import { decomposeTask } from "../processors/task-decomposer";
import type { SeoAdvisorJobData } from "../queues";

/**
 * Worker del SeoAdvisorAgent.
 *
 * Genera el plan de "Próximos pasos sugeridos" para cada cliente SEO.
 * Corre diariamente a las 7 AM, justo después del InsightsAgent (6 AM).
 *
 * NOTA: también procesa task:decompose porque BullMQ asigna jobs a
 * cualquier worker en la cola ai-analysis. Si este worker recibe un
 * task:decompose, debe procesarlo — no descartarlo silenciosamente.
 *
 * Concurrencia: 2 clientes en paralelo.
 */
export const seoAdvisorWorker = createWorker<SeoAdvisorJobData>(
  "ai-analysis",
  async (job) => {
    if (job.name === "task:decompose") {
      await decomposeTask(job.data as { taskId: string; clientId: string; candidateId: string });
      return undefined as never;
    }

    if (job.name !== "advisor:generate") return;

    const result = await runAdvisorProcessor({
      clientId: job.data.clientId,
      scheduled: !job.data.force,
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
