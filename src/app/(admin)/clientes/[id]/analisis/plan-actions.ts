"use server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decomposeQueue } from "@/server/jobs/queues";
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

  const empty: EligibilityResult = { eligible: false, reason: "", platform: null, hasRepo: false, missingForCode: [], missingForContent: [] };

  if (!client) return { ...empty, reason: "Cliente no encontrado." };
  if (client.status !== "ACTIVE") return { ...empty, reason: "Cliente no está activo." };
  if (!client.services.includes("seo")) return { ...empty, reason: "Cliente no tiene servicio SEO." };

  const site = await resolveSite(clientId).catch(() => null);
  if (!site) return { ...empty, reason: "No hay sitio configurado." };

  const hasRepo = !!site.githubRepo;
  const platformReason = ineligibilityReason(site.platform);

  // Get memory status from the latest preflight run (if any)
  const missingForCode: string[] = [];
  let missingForContent: string[] = [];

  const latestPreflight = await prisma.taskRun.findFirst({
    where: {
      task: { siteId: site.id, category: "preflight", status: { not: "VOIDED" } },
      status: "SUCCEEDED",
    },
    orderBy: { startedAt: "desc" },
    select: { memoryStatus: true },
  });

  if (latestPreflight?.memoryStatus) {
    const mem = latestPreflight.memoryStatus as Record<string, string>;
    // CODE requires: site-spec, site-map, site-state
    for (const key of ["site-spec", "site-map", "site-state"]) {
      if (mem[key] !== "FULL") missingForCode.push(`${key} (${mem[key] ?? "ABSENT"})`);
    }
    // CONTENT adds: catalog-schemas
    missingForContent = [...missingForCode];
    if (mem["catalog-schemas"] !== "FULL") {
      missingForContent.push(`catalog-schemas (${mem["catalog-schemas"] ?? "ABSENT"})`);
    }
  }

  return {
    eligible: true,
    reason: platformReason,
    platform: site.platform,
    hasRepo,
    missingForCode,
    missingForContent,
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
      branchName: `plan/${clientSlug(client.name)}-${month}`,
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

    // ── Classify via catalog (quick — no LLM, uses existing actionType + signals)
    const { classifyTaskQuick } = await import("@/lib/plan/classify-task");
    const { getCatalogEntry } = await import("@/lib/plan/task-catalog");

    const classification = classifyTaskQuick({
      title: candidate.titulo,
      objective: candidate.descripcion,
      existingActionType: candidate.actionType,
    });

    const catalogEntry = getCatalogEntry(classification.actionType);
    const platformKey = (eligibility.platform === "NEXTJS" || eligibility.platform === "WORDPRESS")
      ? eligibility.platform as "NEXTJS" | "WORDPRESS" : null;
    const mode = platformKey && catalogEntry
      ? catalogEntry.modes[platformKey].mode === "AI" ? "AI" : catalogEntry.modes[platformKey].mode === "HYBRID" ? "HYBRID" : "HUMAN"
      : "HUMAN";
    const category = catalogEntry?.category ?? inferCategory(candidate);
    const kind = candidate.kind === "SETUP" ? "SETUP" : candidate.kind === "CONTENT" ? "CONTENT" : "CODE";
    const effort = candidate.effort === "LOW" ? "LOW" : candidate.effort === "HIGH" ? "HIGH" : "MEDIUM";

    // Determine initial status based on classification
    const initialStatus = classification.actionType === "other" ? "NEEDS_DEFINITION" as const : "PLANNING" as const;

    const task = await prisma.planTask.create({
      data: {
        planId: plan.id,
        siteId: siteId ?? "",
        order: taskCount + created + 1,
        title: candidate.titulo,
        objective: candidate.descripcion,
        prompt: "",
        acceptanceCriteria: [],
        mode,
        modeReason: candidate.modeReason ?? null,
        kind,
        priority: candidate.priority,
        effort,
        category,
        actionType: classification.actionType,
        classificationConfidence: classification.confidence,
        targetKeyword: candidate.keywordObjetivo ?? null,
        sourceCandidateId: candidate.id,
        status: initialStatus,
      },
    });

    // Log classification event
    if (candidate.actionType && candidate.actionType !== classification.actionType) {
      await prisma.classificationEvent.create({
        data: {
          taskId: task.id,
          originalType: candidate.actionType,
          finalType: classification.actionType,
          actor: "classifier",
          reason: `Análisis propuso "${candidate.actionType}", clasificador resolvió "${classification.actionType}" (confianza: ${classification.confidence.toFixed(2)})`,
        },
      });
    }

    // Only enqueue decomposition if not NEEDS_DEFINITION
    if (initialStatus !== "NEEDS_DEFINITION") {
      await decomposeQueue.add("task:decompose", {
        taskId: task.id,
        clientId,
        candidateId: candidate.id,
      });
    }

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

// ─── Retry stuck task ────────────────────────────────────────────────────────

export async function actionRetryTask(
  taskId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores." };
  }

  const task = await prisma.planTask.findUnique({
    where: { id: taskId },
    include: { plan: { select: { clientId: true } } },
  });

  if (!task) return { ok: false, error: "Tarea no encontrada." };
  if (task.status !== "PLANNING" && task.status !== "FAILED") {
    return { ok: false, error: "Solo se pueden reintentar tareas en PLANNING o FAILED." };
  }

  // Reset to PLANNING and re-enqueue
  await prisma.planTask.update({
    where: { id: taskId },
    data: { status: "PLANNING", failureReason: null },
  });

  // Delete any existing steps (from a partial previous attempt)
  await prisma.planStep.deleteMany({ where: { taskId } });

  await decomposeQueue.add("task:decompose", {
    taskId,
    clientId: task.plan.clientId,
    candidateId: task.sourceCandidateId ?? "retry",
  });

  return { ok: true };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Infer the real category from candidate actionType and title. */
function inferCategory(candidate: { actionType?: string | null; titulo: string; kind: string }): string {
  // actionType → category mapping
  const AT_TO_CATEGORY: Record<string, string> = {
    create_blog: "blog",
    update_meta: "meta",
    keyword_research: "keyword",
    schema: "schema",
    internal_links: "enlazado",
    edit_page_text: "optimizacion",
    create_landing: "landing",
    upload_media: "media",
    generate_image: "imagen",
  };

  if (candidate.actionType && AT_TO_CATEGORY[candidate.actionType]) {
    return AT_TO_CATEGORY[candidate.actionType];
  }

  // Regex fallback from title (order: specific → generic)
  const t = candidate.titulo.toLowerCase();
  if (/blog|artículo|articulo|post|redactar/.test(t)) return "blog";
  if (/landing/.test(t)) return "landing";
  if (/meta\s*(title|description|tag)|yoast/.test(t)) return "meta";
  if (/schema|json-?ld/.test(t)) return "schema";
  if (/enlaces?\s*intern|internal\s*link/.test(t)) return "enlazado";
  if (/optimizar.*texto|contenido/.test(t)) return "optimizacion";
  // keyword LAST — many titles mention "keyword" as context
  if (/investigar.*keyword|seleccionar.*keyword|palabras?\s*clave/.test(t)) return "keyword";

  // Fallback to kind-based
  return candidate.kind === "CONTENT" ? "contenido" : candidate.kind === "CODE" ? "tecnico" : "setup";
}
