"use server";

import { getSession } from "@/lib/auth";
import { env } from "@/env";
import { prisma } from "@/lib/db";

export interface OrchestratorPayload {
  clientId: string; // local CUID — se resuelve a cerebroClientId antes de enviar
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

  // Resolver cerebroClientId (Notion page ID) desde el CUID local
  const client = await prisma.client.findUnique({
    where: { id: data.clientId },
    select: { cerebroClientId: true },
  });

  if (!client?.cerebroClientId) {
    return {
      ok: false,
      error: "Este cliente no está mapeado a Cerebro. Configura su cerebroClientId antes de enviar al Orquestador.",
    };
  }

  const { clientId: _, ...rest } = data;
  const body = { ...rest, clientId: client.cerebroClientId };

  try {
    const res = await fetch(`${url}/api/orchestrator/intake`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
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
