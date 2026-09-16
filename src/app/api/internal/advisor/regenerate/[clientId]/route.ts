export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { aiAnalysisQueue } from "@/server/jobs/queues";
import { validateNotionClientId } from "@/lib/notion-client-id";

function authorize(req: NextRequest): boolean {
  const secret = process.env.SEO_INTERNAL_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * POST /api/internal/advisor/regenerate/{cerebroClientId}
 *
 * Encola un job BullMQ del advisor para el cliente dado.
 * Idempotente: si ya hay un job activo (waiting/active), devuelve el mismo jobId.
 *
 * Response: { jobId: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { clientId: string } }
): Promise<NextResponse> {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const idValidation = validateNotionClientId(params.clientId);
  if (!idValidation.valid) {
    return NextResponse.json({ error: idValidation.message }, { status: 400 });
  }
  const cerebroClientId = idValidation.normalized;

  const client = await prisma.client.findUnique({
    where: { cerebroClientId },
    select: { id: true, status: true },
  });

  if (!client) {
    return NextResponse.json(
      { error: `Cliente con cerebroClientId "${cerebroClientId}" no encontrado` },
      { status: 404 }
    );
  }

  if (client.status !== "ACTIVE") {
    return NextResponse.json(
      { error: `Cliente no está activo (status: ${client.status})` },
      { status: 400 }
    );
  }

  // Idempotencia: buscar job activo existente para este cliente
  const existingJobs = await aiAnalysisQueue.getJobs(["waiting", "active"]);
  const existing = existingJobs.find(
    (j) => j.name === "advisor:generate" && j.data?.clientId === client.id
  );

  if (existing) {
    return NextResponse.json({ jobId: existing.id ?? "unknown" });
  }

  // Encolar nuevo job
  const job = await aiAnalysisQueue.add(
    "advisor:generate",
    { clientId: client.id },
    {
      jobId: `advisor-api:${client.id}:${Date.now()}`,
    }
  );

  return NextResponse.json({ jobId: job.id ?? "unknown" });
}
