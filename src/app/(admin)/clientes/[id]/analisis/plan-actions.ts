"use server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { aiAnalysisQueue } from "@/server/jobs/queues";
import type { AnalysisCandidate } from "@/lib/analysis-candidates";
import { resolveSite } from "@/server/sites/resolve-site";
import { ineligibilityReason } from "@/lib/site-platform";
import { canSendCandidate, type EligibilityResult } from "@/lib/plan-eligibility";

export type { EligibilityResult };

export async function checkEligibility(clientId: string): Promise<EligibilityResult> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { status: true, services: true },
  });

  if (!client) return { eligible: false, reason: "Cliente no encontrado.", platform: null, hasRepo: false };
  if (client.status !== "ACTIVE") return { eligible: false, reason: "Cliente no está activo.", platform: null, hasRepo: false };
  if (!client.services.includes("seo")) return { eligible: false, reason: "Cliente no tiene servicio SEO.", platform: null, hasRepo: false };

  const site = await resolveSite(clientId).catch(() => null);
  if (!site) return { eligible: false, reason: "No hay sitio configurado.", platform: null, hasRepo: false };

  const hasRepo = !!site.githubRepo;
  const platformReason = ineligibilityReason(site.platform);

  // SETUP y HUMAN se pueden mandar sin NEXTJS ni repo
  // Pero el gate general reporta si IA/HYBRID están disponibles
  return {
    eligible: true, // siempre se pueden mandar SETUP/HUMAN
    reason: platformReason, // motivo si IA no está disponible
    platform: site.platform,
    hasRepo,
  };
}


// ─── Mandar al plan ──────────────────────────────────────────────────────────

function clientSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
}

export interface SendToPlanResult {
  planId: string;
  tasksCreated: number;
  tasksDuplicated: number;
}

export async function actionSendToPlan(
  clientId: string,
  analysisId: string,
  candidates: AnalysisCandidate[]
): Promise<{ ok: true; result: SendToPlanResult } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores pueden enviar al plan." };
  }

  if (candidates.length === 0) {
    return { ok: false, error: "No hay candidatas seleccionadas." };
  }

  const eligibility = await checkEligibility(clientId);

  // Validate each candidate is sendable
  for (const c of candidates) {
    const check = canSendCandidate(c, eligibility);
    if (!check.allowed) {
      return { ok: false, error: `Candidata "${c.titulo}" no se puede enviar: ${check.reason}` };
    }
  }

  // Get or create MonthlyPlan for current month
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    select: { name: true },
  });

  // Find cycle for this month if exists
  const cycle = await prisma.monthlyCycle.findFirst({
    where: { clientId, yearMonth: month },
  });

  const site = await resolveSite(clientId).catch(() => null);

  const plan = await prisma.monthlyPlan.upsert({
    where: { clientId_month: { clientId, month } },
    create: {
      clientId,
      month,
      status: "PLANNING",
      analysisId,
      cycleId: cycle?.id ?? null,
      branchName: `plan/${clientSlug(client.name)}-${month}`,
      createdById: session.user.email ?? null,
    },
    update: {
      // Don't overwrite existing plan fields, just update analysisId if newer
      analysisId,
    },
  });

  // Create PlanTasks — skip duplicates by sourceCandidateId
  const existingCandidateIds = await prisma.planTask.findMany({
    where: { planId: plan.id, sourceCandidateId: { not: null } },
    select: { sourceCandidateId: true },
  });
  const existingIds = new Set(existingCandidateIds.map((t) => t.sourceCandidateId));

  const taskCount = await prisma.planTask.count({ where: { planId: plan.id } });
  let created = 0;
  let duplicated = 0;

  for (const candidate of candidates) {
    if (existingIds.has(candidate.id)) {
      duplicated++;
      continue;
    }

    const siteId = site?.id;
    if (!siteId && candidate.kind !== "SETUP" && candidate.mode !== "HUMAN") {
      continue; // skip non-setup tasks without site
    }

    // Map candidate kind to Prisma enum
    const kind = candidate.kind === "SETUP" ? "SETUP" : candidate.kind === "CONTENT" ? "CONTENT" : "CODE";
    const mode = candidate.mode === "AI" ? "AI" : candidate.mode === "HYBRID" ? "HYBRID" : "HUMAN";
    const effort = candidate.effort === "LOW" ? "LOW" : candidate.effort === "HIGH" ? "HIGH" : "MEDIUM";

    const task = await prisma.planTask.create({
      data: {
        planId: plan.id,
        siteId: siteId ?? "", // SETUP tasks may not have site
        order: taskCount + created + 1,
        title: candidate.titulo,
        objective: candidate.descripcion,
        prompt: "", // filled by decomposition job
        acceptanceCriteria: [],
        mode,
        kind,
        priority: candidate.priority,
        effort,
        category: candidate.kind.toLowerCase(),
        sourceCandidateId: candidate.id,
        status: "PLANNING",
      },
    });

    // Enqueue decomposition job (in ai-analysis queue, NOT the agent worker)
    await aiAnalysisQueue.add("task:decompose", {
      taskId: task.id,
      clientId,
      candidateId: candidate.id,
    });

    created++;
  }

  return {
    ok: true,
    result: { planId: plan.id, tasksCreated: created, tasksDuplicated: duplicated },
  };
}

// ─── Estado del plan ─────────────────────────────────────────────────────────

export interface PlanTaskView {
  id: string;
  title: string;
  kind: string;
  mode: string;
  status: string;
  sourceCandidateId: string | null;
  steps: Array<{ id: string; order: number; title: string; type: string; status: string }>;
}

export async function getPlanTasks(clientId: string): Promise<PlanTaskView[]> {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const plan = await prisma.monthlyPlan.findFirst({
    where: { clientId, month },
    include: {
      tasks: {
        orderBy: { order: "asc" },
        include: {
          steps: { orderBy: { order: "asc" } },
        },
      },
    },
  });

  if (!plan) return [];

  return plan.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    kind: t.kind,
    mode: t.mode,
    status: t.status,
    sourceCandidateId: t.sourceCandidateId,
    steps: t.steps.map((s) => ({
      id: s.id,
      order: s.order,
      title: s.title,
      type: s.type,
      status: s.status,
    })),
  }));
}
