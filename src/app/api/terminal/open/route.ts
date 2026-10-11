export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isPlanLocked } from "@/worker/plan-lock";

/**
 * POST /api/terminal/open
 * Body: { planId: string, taskId?: string }
 * Returns: { sessionId: string } or { error: string }
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

  // Check if plan is locked (task AI running)
  const locked = await isPlanLocked(body.planId);
  if (locked) {
    return NextResponse.json({ error: "El plan está bloqueado por una tarea en ejecución." }, { status: 409 });
  }

  // Check for existing active terminal session
  const existing = await prisma.terminalSession.findFirst({
    where: { planId: body.planId, status: "ACTIVE" },
  });
  if (existing) {
    return NextResponse.json({ error: "Ya hay una terminal activa para este plan.", sessionId: existing.id }, { status: 409 });
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

  return NextResponse.json({ sessionId: ts.id });
}
