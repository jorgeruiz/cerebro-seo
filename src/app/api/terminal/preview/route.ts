export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { terminalQueue } from "@/server/jobs/queues";

/**
 * POST /api/terminal/preview
 * Body: { sessionId: string }
 * Enqueues a preview job (diff summary for the UI to show before save).
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
  if (ts.status !== "ACTIVE") return NextResponse.json({ error: "Sesión no está activa." }, { status: 400 });

  await terminalQueue.add("terminal-preview", {
    sessionId: ts.id,
    action: "preview",
  });

  return NextResponse.json({ ok: true });
}
