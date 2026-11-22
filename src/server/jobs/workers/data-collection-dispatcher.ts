/**
 * Unified Data Collection Dispatcher.
 *
 * BullMQ distributes jobs round-robin to ALL workers on the same queue.
 * Having separate workers per job type on "data-collection" caused jobs
 * to land in the wrong processor (e.g. backlinks worker swallowing a
 * rank tracking job). This dispatcher routes by job.name.
 *
 * IMPORTANT: This is the ONLY worker that should listen on "data-collection".
 * The individual worker files are imported here — their createWorker() calls
 * are still active, but we guard against double-registration by being the
 * primary dispatcher. The old workers have `if (job.name !== ...) return;`
 * guards, so even if they process a misrouted job, they'll no-op.
 *
 * TODO: Eventually refactor individual workers to export processor functions
 * instead of creating Workers, and dispatch everything from here.
 */

import { createWorker } from "./base-worker";
import { runRankTrackingProcessor } from "../processors/rank-tracking-processor";
import { runPageMetricsProcessor } from "../processors/page-metrics-processor";
import { runPackageDetectProcessor } from "../processors/package-detect-processor";
import { runBacklinksJob } from "./backlinks-worker";
import { runCompetitorJob } from "./competitor-worker";
import { runAiSearchJob } from "./ai-search-worker";
import { runAuditQuickJob } from "./audit-quick-worker";
import { runAuditCompleteJob } from "./audit-complete-worker";

export const dataCollectionWorker = createWorker(
  "data-collection",
  async (job) => {
    const data = job.data as { clientId?: string; mode?: string; days?: number };
    const clientId = data.clientId;

    switch (job.name) {
      // ── Rank Tracking ─────────────────────────────────────────────
      case "tracking:rankings-priority":
      case "tracking:rankings-bulk": {
        if (!clientId) throw new Error("clientId required for rank tracking");
        const mode = job.name === "tracking:rankings-bulk" ? "bulk" as const : "priority" as const;
        return await runRankTrackingProcessor({ clientId, mode });
      }

      // ── Backlinks ─────────────────────────────────────────────────
      case "analysis:backlinks": {
        if (!clientId) throw new Error("clientId required for backlinks");
        return await runBacklinksJob(clientId);
      }

      // ── Competitors ───────────────────────────────────────────────
      case "analysis:competitors": {
        if (!clientId) throw new Error("clientId required for competitors");
        return await runCompetitorJob(clientId);
      }

      // ── AI Search Visibility ──────────────────────────────────────
      case "analysis:ai-search": {
        if (!clientId) throw new Error("clientId required for ai-search");
        return await runAiSearchJob(clientId);
      }

      // ── GSC Page Metrics ──────────────────────────────────────────
      case "gsc:page-metrics":
      case "gsc:page-metrics-backfill": {
        if (!clientId) throw new Error("clientId required for page-metrics");
        const days = job.name === "gsc:page-metrics-backfill" ? (data.days ?? 90) : 1;
        return await runPageMetricsProcessor({ clientId, days });
      }

      // ── Audits ────────────────────────────────────────────────────
      case "crawler:audit-quick": {
        if (!clientId) throw new Error("clientId required for audit");
        return await runAuditQuickJob(clientId);
      }
      case "crawler:audit": {
        if (!clientId) throw new Error("clientId required for audit");
        return await runAuditCompleteJob(clientId);
      }

      // ── Package Detection ─────────────────────────────────────────
      case "packages:detect": {
        return await runPackageDetectProcessor();
      }

      default:
        console.warn(`[data-collection] Unknown job name: ${job.name} — skipping`);
        return undefined;
    }
  },
  { concurrency: 3 }
);
