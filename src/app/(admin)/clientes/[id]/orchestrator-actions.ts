"use server";

import { getSession } from "@/lib/auth";
import { env } from "@/env";

export interface OrchestratorPayload {
  clientId: string;
  topic: string;
  priority?: string;
  actionType?: string;
  sourceSystem: "cerebro-seo";
  sourceUrl?: string | null;
  sourceCategory?: string;
  payload: Record<string, unknown>;
}

export interface OrchestratorResult {
  ok: true;
  merged: boolean;
}

export async function actionSendToOrchestrator(
  data: OrchestratorPayload,
): Promise<OrchestratorResult | { ok: false; error: string }> {
  const session = await getSession();
  if (!session?.user) {
    return { ok: false, error: "No autenticado." };
  }

  const url = env.ORQUESTADOR_URL;
  const secret = env.CEREBRO_INTERNAL_SECRET;
  if (!url || !secret) {
    return { ok: false, error: "ORQUESTADOR_URL o CEREBRO_INTERNAL_SECRET no configurados." };
  }

  try {
    const res = await fetch(`${url}/api/orchestrator/intake`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Orquestador respondió ${res.status}: ${text.slice(0, 200)}` };
    }

    const json = (await res.json()) as { merged?: boolean };
    return { ok: true, merged: !!json.merged };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error de red";
    return { ok: false, error: msg };
  }
}
