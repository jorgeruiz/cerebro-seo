export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { acquirePlanLock } from "@/worker/plan-lock";
import { redis } from "@/lib/redis";

/**
 * POST /api/terminal/open
 * Body: { planId: string, taskId?: string }
 *
 * Acquires the plan lock for the entire terminal session (held via heartbeat).
 * Stores the lock holder in Redis so the close handler can release it.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo administradores." }, { status: 403 });
  }

  const body = (await req.json()) as { planId?: string; taskId?: string };
  if (!body.planId) {
    return NextResponse.json({ error: "planId requerido." }, { status: 400 });
  }

  const plan = await prisma.monthlyPlan.findUnique({
    where: { id: body.planId },
    select: { id: true, status: true, branchName: true },
  });

  if (!plan) {
    return NextResponse.json({ error: "Plan no encontrado." }, { status: 404 });
  }

  // Check for existing active terminal session
  const existing = await prisma.terminalSession.findFirst({
    where: { planId: body.planId, status: "ACTIVE" },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Ya hay una terminal activa para este plan.", sessionId: existing.id },
      { status: 409 }
    );
  }

  // Acquire plan lock for the terminal session
  const lock = await acquirePlanLock(body.planId);
  if (!lock.acquired) {
    return NextResponse.json(
      { error: "El plan está bloqueado por una tarea en ejecución." },
      { status: 409 }
    );
  }

  // Create terminal session
  const ts = await prisma.terminalSession.create({
    data: {
      planId: body.planId,
      taskId: body.taskId ?? null,
      startedById: session.user.email ?? "unknown",
      status: "ACTIVE",
    },
  });

  // Store the lock holder so the close handler can release it
  // The lock.release() function is lost after this request ends,
  // so we store the holder UUID to do compare-and-delete later.
  await redis.set(`terminal-lock-holder:${ts.id}`, lock.holder!, "EX", 86400);

  // Record initial activity for inactivity tracking
  await redis.set(`terminal-activity:${ts.id}`, Date.now().toString(), "EX", 3600);

  return NextResponse.json({ sessionId: ts.id });
}
