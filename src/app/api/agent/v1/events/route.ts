export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAgentAuth } from "@/lib/agent-auth";

const eventSchema = z.object({
  type: z.string().min(1).max(100),
  clientId: z.string().min(1),
  message: z.string().max(5000),
  date: z.string().datetime().optional(),
});

async function handler(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { type, clientId, message, date } = parsed.data;

  // Verify client exists
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true },
  });
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  // Store as a TimelineEvent for the bitacora
  const event = await prisma.timelineEvent.create({
    data: {
      clientId,
      date: date ? new Date(date) : new Date(),
      type: "EXTERNAL",
      title: type,
      description: message,
      source: "agent:grok",
    },
  });

  return NextResponse.json({ id: event.id, created: true }, { status: 201 });
}

export const POST = withAgentAuth(handler);
