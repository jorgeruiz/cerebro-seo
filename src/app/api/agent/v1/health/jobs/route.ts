export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { withAgentAuth } from "@/lib/agent-auth";
import { dataCollectionQueue, aiAnalysisQueue, syncQueue } from "@/server/jobs/queues";
import { prisma } from "@/lib/db";

/**
 * GET /api/agent/v1/health/jobs
 *
 * Returns the status of all background jobs:
 * - Last successful run per job type
 * - Last error per job type
 * - Next scheduled execution
 * - Stale alerts (>2 days without running)
 */

const STALE_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

/** Job types we monitor and what queue they belong to */
const MONITORED_JOBS = [
  { name: "tracking:rankings-priority", queue: "data-collection", label: "Rank Tracking (Priority)", expectedFrequency: "daily" },
  { name: "tracking:rankings-bulk", queue: "data-collection", label: "Rank Tracking (Bulk)", expectedFrequency: "weekly" },
  { name: "analysis:backlinks", queue: "data-collection", label: "Backlinks", expectedFrequency: "weekly" },
  { name: "analysis:competitors", queue: "data-collection", label: "Competitors", expectedFrequency: "biweekly" },
  { name: "analysis:ai-search", queue: "data-collection", label: "AI Search Visibility", expectedFrequency: "weekly" },
  { name: "gsc:page-metrics", queue: "data-collection", label: "GSC Page Metrics", expectedFrequency: "daily" },
  { name: "pagespeed:collect", queue: "data-collection", label: "PageSpeed CWV", expectedFrequency: "weekly" },
  { name: "insights:generate", queue: "ai-analysis", label: "Insights", expectedFrequency: "daily" },
  { name: "sync:cerebro", queue: "sync", label: "Cerebro Sync", expectedFrequency: "6h" },
] as const;

function getQueue(queueName: string) {
  switch (queueName) {
    case "data-collection": return dataCollectionQueue;
    case "ai-analysis": return aiAnalysisQueue;
    case "sync": return syncQueue;
    default: return dataCollectionQueue;
  }
}

async function handler(_req: NextRequest) {
  const now = Date.now();
  const jobStatuses: Array<{
    name: string;
    label: string;
    expectedFrequency: string;
    lastSuccess: string | null;
    lastError: string | null;
    lastErrorMessage: string | null;
    nextRun: string | null;
    isStale: boolean;
    registeredSchedulers: number;
  }> = [];

  for (const jobDef of MONITORED_JOBS) {
    const queue = getQueue(jobDef.queue);

    // Get completed and failed jobs for this type
    let lastSuccess: Date | null = null;
    let lastError: Date | null = null;
    let lastErrorMessage: string | null = null;

    // Check JobLog for recent activity
    const recentLogs = await prisma.jobLog.findMany({
      where: { jobName: { startsWith: jobDef.name } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { status: true, error: true, createdAt: true },
    });

    for (const log of recentLogs) {
      if (log.status === "completed" && !lastSuccess) {
        lastSuccess = log.createdAt;
      }
      if (log.status === "failed" && !lastError) {
        lastError = log.createdAt;
        lastErrorMessage = log.error?.slice(0, 200) ?? null;
      }
    }

    // If no JobLog entries, check the queue's completed/failed sets
    if (!lastSuccess) {
      try {
        const completed = await queue.getCompleted(0, 0);
        const match = completed.find((j) => j.name === jobDef.name);
        if (match?.finishedOn) {
          lastSuccess = new Date(match.finishedOn);
        }
      } catch { /* queue access error — non-fatal */ }
    }

    if (!lastError) {
      try {
        const failed = await queue.getFailed(0, 0);
        const match = failed.find((j) => j.name === jobDef.name);
        if (match?.finishedOn) {
          lastError = new Date(match.finishedOn);
          lastErrorMessage = match.failedReason?.slice(0, 200) ?? null;
        }
      } catch { /* non-fatal */ }
    }

    // Check repeatable jobs (schedulers)
    let nextRun: Date | null = null;
    let registeredSchedulers = 0;
    try {
      const repeatables = await queue.getRepeatableJobs();
      const matching = repeatables.filter((r) => r.name === jobDef.name);
      registeredSchedulers = matching.length;
      if (matching.length > 0 && matching[0].next) {
        nextRun = new Date(matching[0].next);
      }
    } catch { /* non-fatal */ }

    const isStale = !lastSuccess || (now - lastSuccess.getTime() > STALE_THRESHOLD_MS);

    jobStatuses.push({
      name: jobDef.name,
      label: jobDef.label,
      expectedFrequency: jobDef.expectedFrequency,
      lastSuccess: lastSuccess?.toISOString() ?? null,
      lastError: lastError?.toISOString() ?? null,
      lastErrorMessage,
      nextRun: nextRun?.toISOString() ?? null,
      isStale,
      registeredSchedulers,
    });
  }

  const staleJobs = jobStatuses.filter((j) => j.isStale);
  const healthy = staleJobs.length === 0;

  return NextResponse.json({
    healthy,
    checkedAt: new Date().toISOString(),
    staleThreshold: "2 days",
    staleCount: staleJobs.length,
    staleJobs: staleJobs.map((j) => j.name),
    jobs: jobStatuses,
  });
}

export const GET = withAgentAuth(handler);
