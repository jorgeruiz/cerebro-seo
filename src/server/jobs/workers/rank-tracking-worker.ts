/**
 * Rank Tracking Worker — procesa jobs de tracking de rankings en DataForSEO.
 *
 * Maneja dos tipos de job en la queue "data-collection":
 *   - "tracking:rankings-priority" → keywords isPriority:true, diario 3AM
 *   - "tracking:rankings-bulk"     → keywords isPriority:false, lunes 4AM
 *
 * Concurrencia: 2 (procesar 2 clientes en paralelo).
 * Idempotente: salta keywords que ya tienen ranking para hoy.
 */

import { createWorker } from "./base-worker";
import { runRankTrackingProcessor, type TrackingJobData } from "../processors/rank-tracking-processor";

export const rankTrackingWorker = createWorker<TrackingJobData>(
  "data-collection",
  async (job) => {
    const mode =
      job.name === "tracking:rankings-priority" ? "priority"
      : job.name === "tracking:rankings-bulk" ? "bulk"
      : (job.data.mode ?? "priority");

    const result = await runRankTrackingProcessor({ clientId: job.data.clientId, mode });

    console.log(
      `[rank-tracking-worker] job=${job.name} client=${job.data.clientId} ` +
      `tracked=${result.keywordsTracked} skipped=${result.keywordsSkipped} ` +
      `insights=${result.insightsGenerated} cost≈$${result.totalCost.toFixed(4)}`
    );

    return result;
  },
  { concurrency: 2 }
);
