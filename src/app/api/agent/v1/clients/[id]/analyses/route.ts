export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAgentAuth } from "@/lib/agent-auth";

async function handler(
  req: NextRequest,
  { params }: { params: Record<string, string> }
) {
  const clientId = params.id;

  // Verify client exists
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true },
  });
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  // Optional month filter (YYYY-MM)
  const month = req.nextUrl.searchParams.get("month");

  // Get the most recent analysis
  const analysis = await prisma.clientAnalysis.findFirst({
    where: { clientId },
    orderBy: { createdAt: "desc" },
  });

  if (!analysis) {
    return NextResponse.json({ analysis: null, actions: [] });
  }

  // Parse structured content
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(analysis.content);
  } catch {
    parsed = { raw: analysis.content };
  }

  // Get plan tasks (actions) for the month
  const planMonth = month ?? new Date().toISOString().slice(0, 7);
  const tasks = await prisma.planTask.findMany({
    where: {
      plan: { clientId, month: planMonth },
    },
    orderBy: { priority: "asc" },
    select: {
      id: true,
      title: true,
      category: true,
      actionType: true,
      targetKeyword: true,
      priority: true,
      status: true,
      objective: true,
      resultUrls: true,
      previewUrl: true,
    },
  });

  const actions = tasks.map((t) => ({
    id: t.id,
    type: t.actionType ?? t.category,
    url: t.resultUrls[0] ?? t.previewUrl ?? null,
    priority: t.priority,
    status: t.status.toLowerCase(),
    description: t.title,
    proposedChange: t.objective,
    targetKeyword: t.targetKeyword,
  }));

  return NextResponse.json({
    analysis: {
      id: analysis.id,
      createdAt: analysis.createdAt.toISOString(),
      model: analysis.model,
      content: parsed,
    },
    actions,
  });
}

export const GET = withAgentAuth(handler);
