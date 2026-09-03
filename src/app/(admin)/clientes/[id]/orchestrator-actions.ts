"use server";

import { getSession } from "@/lib/auth";
import { env } from "@/env";
import { prisma } from "@/lib/db";
import { decomposeAction, type Subtarea } from "@/lib/claude-analysis";

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

// ─── Análisis Claude → Orquestador (con desglose de sub-tareas) ───────────

const IMPACTO_TO_PRIORITY: Record<string, string> = {
  alto: "alta",
  medio: "media",
  bajo: "baja",
};

export interface DecomposeAndSendInput {
  clientId: string;
  analysisId: string;
  oppIndex: number;
  titulo: string;
  descripcion: string;
  accion: string;
  impacto: string;
}

export interface DecomposeAndSendResult {
  ok: true;
  subtareasCount: number;
  merged: boolean;
}

export async function actionDecomposeAndSendToOrchestrator(
  input: DecomposeAndSendInput,
): Promise<DecomposeAndSendResult | { ok: false; error: string }> {
  const session = await getSession();
  if (!session?.user) {
    return { ok: false, error: "No autenticado." };
  }

  const url = env.ORQUESTADOR_URL;
  const secret = env.CEREBRO_INTERNAL_SECRET;
  if (!url || !secret) {
    return { ok: false, error: "ORQUESTADOR_URL o CEREBRO_INTERNAL_SECRET no configurados." };
  }

  // Resolver cerebroClientId
  const client = await prisma.client.findUnique({
    where: { id: input.clientId },
    select: { cerebroClientId: true },
  });

  if (!client?.cerebroClientId) {
    return {
      ok: false,
      error: "Este cliente no está mapeado a Cerebro. Configura su cerebroClientId antes de enviar al Orquestador.",
    };
  }

  // Descomponer la acción en sub-tareas
  let subtareas: Subtarea[];
  try {
    subtareas = await decomposeAction({
      titulo: input.titulo,
      descripcion: input.descripcion,
      accion: input.accion,
      impacto: input.impacto,
    });
  } catch (err) {
    console.error("[orchestrator] decomposeAction failed:", err);
    return { ok: false, error: "Error al descomponer la acción." };
  }

  // sourceId y oppType van DENTRO de payload — el intake lee payload.sourceId / payload.oppType.
  // Como campos top-level se ignoran en silencio.
  const sourceId = `analysis:${input.analysisId}:opp:${input.oppIndex}`;

  // sourceUrl: si todas las sub-tareas comparten el mismo targetUrl, usarlo.
  // Si no, usar la URL del análisis en Cerebro SEO como fallback para que
  // la agrupación del Orquestador (sourceUrl + sourceCategory) siempre dispare.
  const targetUrls = Array.from(
    new Set(subtareas.map((s) => s.targetUrl).filter(Boolean))
  );
  const sourceUrl = targetUrls.length === 1
    ? targetUrls[0]
    : `/clientes/${input.clientId}/analisis`;

  const body = {
    clientId: client.cerebroClientId,
    topic: input.titulo,
    priority: IMPACTO_TO_PRIORITY[input.impacto] ?? "media",
    sourceSystem: "cerebro-seo" as const,
    sourceUrl,
    sourceCategory: "analysis-opportunity",
    payload: {
      sourceId,
      oppType: "analysis-opportunity",
      titulo: input.titulo,
      descripcion: input.descripcion,
      accion: input.accion,
      impacto: input.impacto,
      subtareas,
    },
  };

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
    return { ok: true, subtareasCount: subtareas.length, merged: !!json.merged };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error de red";
    return { ok: false, error: msg };
  }
}
