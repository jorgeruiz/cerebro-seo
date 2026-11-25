/**
 * POST /api/agent-chat/conversations/[id]/messages — send message, SSE response.
 * REST with SSE streaming (not tRPC). Auth via NextAuth session.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { UserRole } from "@prisma/client";
import { handleAgentMessage } from "@/lib/agent-chat/engine";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id: conversationId } = await params;
  const body = (await req.json()) as { message?: string };

  if (!body.message?.trim()) {
    return NextResponse.json(
      { error: "message es obligatorio" },
      { status: 400 },
    );
  }

  // Load conversation with client context
  const conv = await prisma.agentConversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      clientId: true,
      notionClientId: true,
      planId: true,
      userId: true,
      status: true,
      client: {
        select: {
          name: true,
          domain: true,
          sites: {
            take: 1,
            select: { url: true },
          },
        },
      },
    },
  });

  if (!conv) {
    return NextResponse.json(
      { error: "Conversacion no encontrada" },
      { status: 404 },
    );
  }

  // Auth: conversation owner or ADMIN
  if (
    conv.userId !== session.user.id &&
    session.user.role !== UserRole.ADMIN
  ) {
    // EDITOR: check ClientUser access
    const hasAccess = await prisma.clientUser.findFirst({
      where: {
        clientId: conv.clientId,
        email: session.user.email!,
      },
    });
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Sin acceso a esta conversacion" },
        { status: 403 },
      );
    }
  }

  if (conv.status !== "OPEN") {
    return NextResponse.json(
      { error: "Esta conversacion ya no acepta mensajes" },
      { status: 400 },
    );
  }

  const siteDomain =
    conv.client.sites[0]?.url?.replace(/^https?:\/\//, "").replace(/\/$/, "") ??
    conv.client.domain;

  const stream = handleAgentMessage({
    conversationId: conv.id,
    clientId: conv.clientId,
    notionClientId: conv.notionClientId,
    clientName: conv.client.name,
    siteDomain,
    planId: conv.planId,
    userMessage: body.message.trim(),
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
