export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAgentAuth } from "@/lib/agent-auth";
import { ACTION_TYPES } from "@/lib/plan/task-catalog";

const actionSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  url: z.string().max(500).optional(),
  targetKeyword: z.string().max(200).optional(),
  priority: z.number().int().min(1).max(10).default(5),
  category: z.enum(["technical", "content", "setup"]).default("technical"),
  mode: z.enum(["AI", "HYBRID", "HUMAN"]).default("HYBRID"),
  assignee: z.enum(["ejecutor", "felix"]).default("ejecutor"),
  requiresApproval: z.boolean().default(false),
  dataSource: z.string().max(2000).optional(),
  steps: z.array(z.string().max(1000)).max(20).optional(),
});

const batchSchema = z.array(actionSchema).min(1).max(50);

const CATEGORY_TO_KIND: Record<string, string> = {
  technical: "CODE",
  content: "CONTENT",
  setup: "SETUP",
};

async function handlePost(
  req: NextRequest,
  { params }: { params: Record<string, string> }
) {
  const planId = params.planId;

  const plan = await prisma.monthlyPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      status: true,
      clientId: true,
      client: { select: { sites: { select: { id: true }, take: 1 } } },
      _count: { select: { tasks: true } },
    },
  });
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  // Only allow adding actions to draft plans
  if (plan.status !== "PLANNING") {
    return NextResponse.json(
      { error: "Can only add actions to draft plans", planStatus: plan.status },
      { status: 409 }
    );
  }

  const siteId = plan.client.sites[0]?.id;
  if (!siteId) {
    return NextResponse.json({ error: "Client has no site configured" }, { status: 422 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const validTypes = new Set<string>(ACTION_TYPES);
  const errors: Array<{ index: number; type: string; error: string }> = [];
  const validActions: Array<z.infer<typeof actionSchema> & { index: number }> = [];

  for (let i = 0; i < parsed.data.length; i++) {
    const action = parsed.data[i];
    if (!validTypes.has(action.type)) {
      errors.push({
        index: i,
        type: action.type,
        error: `Unknown action type "${action.type}". Valid types: ${ACTION_TYPES.join(", ")}`,
      });
    } else {
      validActions.push({ ...action, index: i });
    }
  }

  // If ANY action has an invalid type, reject the entire batch with clear errors
  if (errors.length > 0) {
    return NextResponse.json(
      { error: "Invalid action types in batch", invalidActions: errors },
      { status: 400 }
    );
  }

  const startOrder = plan._count.tasks;
  const created = await prisma.$transaction(
    validActions.map((action, i) =>
      prisma.planTask.create({
        data: {
          planId,
          siteId,
          order: startOrder + i,
          title: action.title,
          objective: action.description ?? "",
          prompt: "", // Agent plans don't use prompts
          mode: action.mode,
          kind: CATEGORY_TO_KIND[action.category] as "CODE" | "CONTENT" | "SETUP",
          priority: action.priority,
          category: action.category,
          actionType: action.type,
          targetKeyword: action.targetKeyword ?? null,
          targetUrl: action.url ?? null,
          status: action.requiresApproval ? "WAITING_HUMAN" : "READY",
          assignee: action.assignee,
          requiresApproval: action.requiresApproval,
          dataSource: action.dataSource ?? null,
          agentSteps: action.steps ?? undefined,
        },
        select: {
          id: true,
          title: true,
          actionType: true,
          status: true,
          assignee: true,
          priority: true,
          order: true,
        },
      })
    )
  );

  const STATUS_REVERSE: Record<string, string> = {
    READY: "pending",
    WAITING_HUMAN: "waiting_approval",
  };

  return NextResponse.json({
    created: created.map((t) => ({
      id: t.id,
      title: t.title,
      type: t.actionType,
      status: STATUS_REVERSE[t.status] ?? t.status.toLowerCase(),
      assignee: t.assignee,
      priority: t.priority,
      order: t.order,
    })),
    count: created.length,
  }, { status: 201 });
}

export const POST = withAgentAuth(handlePost);
