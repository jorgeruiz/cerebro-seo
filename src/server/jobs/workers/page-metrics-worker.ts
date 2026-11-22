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

// Re-export for dispatcher
export { runPageMetricsProcessor } from "../processors/page-metrics-processor";
export type { PageMetricsJobData } from "../processors/page-metrics-processor";
