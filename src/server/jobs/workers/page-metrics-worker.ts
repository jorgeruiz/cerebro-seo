/**
 * Page Metrics Worker — populates PageMetric from GSC + GA4.
 *
 * Job names:
 *   - "gsc:page-metrics"   → daily job, fetches last 1 day
 *   - "gsc:page-metrics-backfill" → backfill, fetches last 90 days
 *
 * Queue: data-collection
 * Concurrency: 2
 */

import { createWorker } from "./base-worker";
import { runPageMetricsProcessor, type PageMetricsJobData } from "../processors/page-metrics-processor";

export const pageMetricsWorker = createWorker<PageMetricsJobData>(
  "data-collection",
  async (job) => {
    const days = job.name === "gsc:page-metrics-backfill"
      ? (job.data.days ?? 90)
      : (job.data.days ?? 1);

    const result = await runPageMetricsProcessor({
      clientId: job.data.clientId,
      days,
    });

    console.log(
      `[page-metrics-worker] job=${job.name} client=${job.data.clientId} ` +
      `rows=${result.rowsWritten} days=${result.daysProcessed}`
    );

    return result;
  },
  { concurrency: 2 }
);
