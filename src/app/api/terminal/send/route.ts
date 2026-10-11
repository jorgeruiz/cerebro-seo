export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { terminalQueue } from "@/server/jobs/queues";

/**
 * POST /api/terminal/send
 * Body: { sessionId: string, prompt: string }
 * Enqueues a turn job for the terminal worker.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo administradores." }, { status: 403 });
  }

  const body = (await req.json()) as { sessionId?: string; prompt?: string };
  if (!body.sessionId || !body.prompt) {
    return NextResponse.json({ error: "sessionId y prompt requeridos." }, { status: 400 });
  }

  const ts = await prisma.terminalSession.findUnique({
    where: { id: body.sessionId },
    select: { id: true, status: true, planId: true, startedById: true },
  });

  if (!ts) return NextResponse.json({ error: "Sesión no encontrada." }, { status: 404 });
  if (ts.status !== "ACTIVE") return NextResponse.json({ error: "Sesión no está activa." }, { status: 400 });

  await terminalQueue.add("terminal-turn", {
    sessionId: ts.id,
    action: "turn",
    prompt: body.prompt,
    triggeredById: session.user.email ?? undefined,
  });

  return NextResponse.json({ ok: true });
}
