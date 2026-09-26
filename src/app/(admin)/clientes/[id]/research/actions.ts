"use server";

import { getSession } from "@/lib/auth";
import { runResearch, estimateResearchCost } from "@/server/research/research-service";
import type { ResearchEstimate } from "@/server/research/types";

export async function actionGetResearchEstimate(): Promise<ResearchEstimate> {
  return estimateResearchCost(5, 10);
}

export async function actionRunResearch(
  clientId: string
): Promise<
  | { ok: true; reportId: string }
  | { ok: false; error: string }
> {
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "No autenticado" };

  const role = (session.user as { role?: string }).role;
  if (role !== "ADMIN") return { ok: false, error: "Solo ADMIN puede generar research" };

  try {
    const { reportId } = await runResearch({
      clientId,
      triggeredBy: session.user.email ?? undefined,
    });
    return { ok: true, reportId };
  } catch (err) {
    console.error("[actionRunResearch] Error:", err);
    return { ok: false, error: (err as Error).message };
  }
}
