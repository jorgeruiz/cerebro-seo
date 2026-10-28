"use server";

/**
 * Server action: Agregar al plan desde cualquier módulo.
 *
 * Crea una PlanTask con sourceRef (módulo + itemId + snapshot),
 * la encola al job de descomposición, y aplica las mismas reglas
 * que las candidatas del Análisis (plataforma, memoria, anti-invención).
 */

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decomposeQueue } from "@/server/jobs/queues";
import { resolveSite } from "@/server/sites/resolve-site";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import type { InputJsonValue } from "@prisma/client/runtime/library";
import { getTemplate, applyCapabilities, resolveTaskMode, type ActionType, type Platform } from "@/lib/task-templates";

export interface AddToPlanInput {
  clientId: string;
  title: string;
  objective: string;
  kind: "CONTENT" | "CODE" | "SETUP";
  /** @deprecated Use actionType instead. Kept for backward compat — ignored if actionType is set. */
  mode?: "AI" | "HYBRID" | "HUMAN";
  /** Action type for template lookup. Determines mode via resolveTaskMode. */
  actionType?: string;
  priority: number; // 1-5
  effort: "LOW" | "MEDIUM" | "HIGH";
  category: string; // "tecnico", "blog", "meta", "schema", etc.
  sourceRef: {
    module: string;    // "keywords", "audit", "backlinks", "competencia", "ai-search", "insights", "contenido", "terminos-busqueda", "oportunidades"
    itemId?: string;   // ID del item específico (keyword, issue, etc.)
    snapshot: Record<string, unknown>; // datos del momento (keyword, posición, CTR, etc.)
  };
}

export interface AddToPlanResult {
  ok: true;
  taskId: string;
  planId: string;
  isDuplicate: boolean; // true si ya existía con el mismo sourceRef
}

export async function actionAddToPlan(
  input: AddToPlanInput
): Promise<AddToPlanResult | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores pueden agregar al plan." };
  }

  const { clientId, title, objective, kind, priority, effort, category, sourceRef } = input;

  // Validate client
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, status: true, services: true },
  });
  if (!client) return { ok: false, error: "Cliente no encontrado." };
  if (client.status !== "ACTIVE") return { ok: false, error: "Cliente no está activo." };
  if (!client.services.includes("seo")) return { ok: false, error: "Cliente no tiene servicio SEO." };

  // Resolve site
  const site = await resolveSite(clientId).catch(() => null);
  if (!site) return { ok: false, error: "No hay sitio configurado." };

  // Get or create monthly plan
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const slug = client.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);

  const planBranchName = `plan/${slug}-${month}`;
  const plan = await prisma.monthlyPlan.upsert({
    where: { clientId_month: { clientId, month } },
    create: {
      clientId,
      month,
      status: "PLANNING",
      branchName: planBranchName,
      createdById: session.user.email ?? null,
    },
    update: { branchName: planBranchName },
  });

  // Deduplication: check if a task with the same sourceRef already exists in this plan
  const existingTasks = await prisma.planTask.findMany({
    where: {
      planId: plan.id,
      status: { notIn: ["VOIDED", "FAILED"] },
      sourceRef: { not: Prisma.JsonNull },
    },
    select: { id: true, title: true, status: true, sourceRef: true },
  });

  for (const existing of existingTasks) {
    const ref = existing.sourceRef as { module?: string; itemId?: string } | null;
    if (
      ref &&
      ref.module === sourceRef.module &&
      ref.itemId === sourceRef.itemId &&
      sourceRef.itemId // only dedup if itemId is set
    ) {
      return { ok: true, taskId: existing.id, planId: plan.id, isDuplicate: true };
    }
  }

  // Create task
  const taskCount = await prisma.planTask.count({ where: { planId: plan.id } });

  // Derive mode from template if actionType is provided
  const { actionType, mode } = input;
  let effectiveMode: "AI" | "HYBRID" | "HUMAN" = mode ?? "HUMAN";

  if (actionType && (site.platform === "NEXTJS" || site.platform === "WORDPRESS")) {
    const template = getTemplate(actionType as ActionType, site.platform as Platform);
    if (template) {
      // For WP, we'd need capabilities — but at addToPlan time we don't have them.
      // The decomposer will apply capabilities. For now, use template steps as-is.
      effectiveMode = resolveTaskMode(template.steps);
    }
  } else if (!actionType) {
    // Legacy: mode passed directly (backward compat)
    if (site.platform === "WORDPRESS" || site.platform === "MIGRACION") {
      effectiveMode = mode === "HYBRID" ? "HUMAN" : (mode ?? "HUMAN");
    } else if (!site.platform || site.platform === "OTRO") {
      effectiveMode = "HUMAN";
    }
  }

  const task = await prisma.planTask.create({
    data: {
      planId: plan.id,
      siteId: site.id,
      order: taskCount + 1,
      title,
      objective,
      prompt: "", // filled by decomposition
      acceptanceCriteria: [],
      mode: effectiveMode as "AI" | "HYBRID" | "HUMAN",
      kind: kind as "CONTENT" | "CODE" | "SETUP",
      priority,
      effort: effort as "LOW" | "MEDIUM" | "HIGH",
      category,
      sourceCandidateId: `module-${randomUUID().slice(0, 8)}`,
      sourceRef: sourceRef as unknown as InputJsonValue,
      status: "PLANNING",
    },
  });

  // Enqueue decomposition
  await decomposeQueue.add("task:decompose", {
    taskId: task.id,
    clientId,
    candidateId: task.sourceCandidateId!,
  });

  return { ok: true, taskId: task.id, planId: plan.id, isDuplicate: false };
}

/**
 * Check if a sourceRef already has an active task in the current month's plan.
 */
export async function checkSourceRefInPlan(
  clientId: string,
  module: string,
  itemId: string
): Promise<{ inPlan: boolean; taskId?: string; taskTitle?: string; taskStatus?: string }> {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const plan = await prisma.monthlyPlan.findFirst({
    where: { clientId, month },
    include: {
      tasks: {
        where: { status: { notIn: ["VOIDED", "FAILED"] }, sourceRef: { not: Prisma.JsonNull } },
        select: { id: true, title: true, status: true, sourceRef: true },
      },
    },
  });

  if (!plan) return { inPlan: false };

  for (const task of plan.tasks) {
    const ref = task.sourceRef as { module?: string; itemId?: string } | null;
    if (ref && ref.module === module && ref.itemId === itemId) {
      return { inPlan: true, taskId: task.id, taskTitle: task.title, taskStatus: task.status };
    }
  }

  return { inPlan: false };
}
