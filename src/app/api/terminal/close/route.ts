export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { terminalQueue } from "@/server/jobs/queues";

/**
 * POST /api/terminal/close
 * Body: { sessionId: string }
 * Enqueues a close job (WIP commit if unsaved changes + bitácora + release lock).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo administradores." }, { status: 403 });
  }

  const body = (await req.json()) as { sessionId?: string };
  if (!body.sessionId) {
    return NextResponse.json({ error: "sessionId requerido." }, { status: 400 });
  }

  const ts = await prisma.terminalSession.findUnique({
    where: { id: body.sessionId },
    select: { id: true, status: true },
  });

  if (!ts) return NextResponse.json({ error: "Sesión no encontrada." }, { status: 404 });
  if (ts.status !== "ACTIVE") return NextResponse.json({ error: "Sesión ya cerrada." }, { status: 400 });

  await terminalQueue.add("terminal-close", {
    sessionId: ts.id,
    action: "close",
    triggeredById: session.user.email ?? undefined,
  });

  return NextResponse.json({ ok: true });
}
