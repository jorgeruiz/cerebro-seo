"use server";

import { getSession } from "@/lib/auth";
import { generateContentPlan, type ContentPlanResult } from "@/lib/claude-content-plan";
import { prisma } from "@/lib/db";

export interface ContentPlanRecord {
  id: string;
  month: string;
  plan: ContentPlanResult;
  model: string;
  cost: number;
  triggeredBy: string | null;
  createdAt: Date;
}

export async function actionGenerateContentPlan(
  clientId: string
): Promise<{ ok: true; record: ContentPlanRecord } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores pueden generar planes de contenido." };
  }

  try {
    const { plan, planId } = await generateContentPlan(clientId, session.user.email ?? undefined);

    const record = await prisma.contentPlan.findUniqueOrThrow({ where: { id: planId } });

    return {
      ok: true,
      record: {
        id: record.id,
        month: record.month,
        plan,
        model: record.model,
        cost: Number(record.cost),
        triggeredBy: record.triggeredBy,
        createdAt: record.createdAt,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[content-plan] Error generando plan:", err);
    return { ok: false, error: msg };
  }
}

export async function getContentPlanHistory(clientId: string): Promise<ContentPlanRecord[]> {
  const records = await prisma.contentPlan.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return records.map((r) => ({
    id: r.id,
    month: r.month,
    plan: r.ideas as unknown as ContentPlanResult,
    model: r.model,
    cost: Number(r.cost),
    triggeredBy: r.triggeredBy,
    createdAt: r.createdAt,
  }));
}

