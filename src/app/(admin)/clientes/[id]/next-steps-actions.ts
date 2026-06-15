"use server";

import { getSession } from "@/lib/auth";
import { runAdvisorProcessor } from "@/lib/seo-advisor/advisor-processor";
import { prisma } from "@/lib/db";
import type { NextStep } from "@/lib/seo-advisor/types";

export interface NextStepPlanRecord {
  id: string;
  steps: NextStep[];
  model: string;
  cost: number;
  triggeredBy: string | null;
  generatedAt: Date;
}

export async function actionRegenerateNextSteps(
  clientId: string
): Promise<{ ok: true; record: NextStepPlanRecord } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores pueden regenerar el plan." };
  }

  try {
    const result = await runAdvisorProcessor({
      clientId,
      triggeredBy: session.user.email ?? undefined,
      scheduled: false, // omitir idempotencia diaria — regeneración manual
    });

    const record = await prisma.nextStepPlan.findUniqueOrThrow({
      where: { id: result.planId },
    });

    return {
      ok: true,
      record: {
        id: record.id,
        steps: record.steps as unknown as NextStep[],
        model: record.model,
        cost: Number(record.cost),
        triggeredBy: record.triggeredBy,
        generatedAt: record.generatedAt,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[seo-advisor] Error regenerando plan:", err);
    return { ok: false, error: msg };
  }
}

export async function getLatestNextStepPlan(
  clientId: string
): Promise<NextStepPlanRecord | null> {
  const record = await prisma.nextStepPlan.findFirst({
    where: { clientId },
    orderBy: { generatedAt: "desc" },
  });
  if (!record) return null;

  return {
    id: record.id,
    steps: record.steps as unknown as NextStep[],
    model: record.model,
    cost: Number(record.cost),
    triggeredBy: record.triggeredBy,
    generatedAt: record.generatedAt,
  };
}
