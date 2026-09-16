export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { aiAnalysisQueue } from "@/server/jobs/queues";

function authorize(req: NextRequest): boolean {
  const secret = process.env.SEO_INTERNAL_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * GET /api/internal/advisor/jobs/{jobId}
 *
 * Consulta el estado de un job de advisor encolado.
 *
 * Response: { status: "queued"|"running"|"done"|"failed", planId?, error? }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { jobId: string } }
): Promise<NextResponse> {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = await aiAnalysisQueue.getJob(params.jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const state = await job.getState();

  if (state === "completed") {
    const result = job.returnvalue as { planId?: string } | null;
    return NextResponse.json({
      status: "done",
      planId: result?.planId ?? null,
    });
  }

  if (state === "failed") {
    return NextResponse.json({
      status: "failed",
      error: job.failedReason ?? "Unknown error",
    });
  }

  if (state === "active") {
    return NextResponse.json({ status: "running" });
  }

  // waiting, delayed, etc.
  return NextResponse.json({ status: "queued" });
}
