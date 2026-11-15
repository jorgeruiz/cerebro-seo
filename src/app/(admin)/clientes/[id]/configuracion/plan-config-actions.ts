"use server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { ClientPlanConfig } from "@/lib/plan/plan-composer";

export async function actionSavePlanConfig(
  clientId: string,
  config: ClientPlanConfig,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") return { ok: false, error: "Solo administradores." };

  await prisma.client.update({
    where: { id: clientId },
    data: { planConfig: config as unknown as Parameters<typeof prisma.client.update>[0]["data"]["planConfig"] },
  });

  return { ok: true };
}
