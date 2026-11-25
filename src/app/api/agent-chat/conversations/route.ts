/**
 * POST /api/agent-chat/conversations — create a new agent chat conversation.
 * REST (not tRPC) because the messages endpoint uses SSE streaming.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { UserRole } from "@prisma/client";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = (await req.json()) as { client_id?: string };
  const { client_id: clientId } = body;

  if (!clientId) {
    return NextResponse.json(
      { error: "client_id es obligatorio" },
      { status: 400 },
    );
  }

  // Load client + site
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      cerebroClientId: true,
      name: true,
      domain: true,
      sites: {
        take: 1,
        select: { platform: true, githubRepo: true, url: true },
      },
    },
  });

  if (!client) {
    return NextResponse.json(
      { error: "Cliente no encontrado" },
      { status: 404 },
    );
  }

  // EDITOR access check
  if (session.user.role !== UserRole.ADMIN) {
    const hasAccess = await prisma.clientUser.findFirst({
      where: {
        clientId,
        email: session.user.email!,
      },
    });
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Sin acceso a este cliente" },
        { status: 403 },
      );
    }
  }

  // Gate: only NEXTJS with githubRepo
  const site = client.sites[0];
  if (!site || site.platform !== "NEXTJS") {
    return NextResponse.json(
      { error: "El chat de cambios solo esta disponible para sitios Next.js" },
      { status: 403 },
    );
  }
  if (!site.githubRepo) {
    return NextResponse.json(
      {
        error:
          "El sitio no tiene repositorio de GitHub configurado",
      },
      { status: 403 },
    );
  }

  if (!client.cerebroClientId) {
    return NextResponse.json(
      { error: "Cliente sin ID de Notion (cerebroClientId)" },
      { status: 400 },
    );
  }

  // Find active plan (optional link)
  const activePlan = await prisma.monthlyPlan.findFirst({
    where: { clientId, status: { notIn: ["ARCHIVED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const conv = await prisma.agentConversation.create({
    data: {
      clientId: client.id,
      notionClientId: client.cerebroClientId,
      planId: activePlan?.id ?? null,
      userId: session.user.id,
      status: "OPEN",
    },
  });

  return NextResponse.json(
    {
      id: conv.id,
      client_id: conv.clientId,
      status: conv.status,
      created_at: conv.createdAt.toISOString(),
    },
    { status: 201 },
  );
}
