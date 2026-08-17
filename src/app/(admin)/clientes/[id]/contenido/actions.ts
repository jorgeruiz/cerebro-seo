"use server";

import { getSession } from "@/lib/auth";
import { generateContentPlan, type ContentPlanResult } from "@/lib/claude-content-plan";
import type { ContentIdea, ContentType } from "@/lib/claude-content-plan";
import { prisma } from "@/lib/db";
import { env } from "@/env";

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

// ─── Orquestador intake ──────────────────────────────────────────────────

const ACTION_TYPE_MAP: Partial<Record<ContentType, string>> = {
  landing: "site.landing.create",
  blog:    "blog.create",
  pilar:   "blog.create",
  soporte: "blog.create",
};

export interface OrchestratorResult {
  ok: true;
  merged: boolean;
}

export async function actionSendToOrchestrator(
  clientId: string,
  idea: ContentIdea,
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

  const actionType = ACTION_TYPE_MAP[idea.tipo];

  const body: Record<string, unknown> = {
    clientId,
    topic: idea.keywords[0] ?? idea.titulo,
    priority: idea.prioridad,
    sourceSystem: "cerebro-seo",
    sourceUrl: idea.urlSugerida ?? null,
    sourceCategory: idea.tipo,
    payload: {
      titulo: idea.titulo,
      keywords: idea.keywords,
      angulo: idea.angulo,
      razon: idea.razon,
      prioridad: idea.prioridad,
      tipo: idea.tipo,
      urlSugerida: idea.urlSugerida ?? null,
    },
  };

  if (actionType) {
    body.actionType = actionType;
  }

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

    const data = await res.json() as { merged?: boolean };
    return { ok: true, merged: !!data.merged };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error de red";
    return { ok: false, error: msg };
  }
}
