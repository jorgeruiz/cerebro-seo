/**
 * Plan Bridge — connects Analysis candidates to the Plan Composer.
 *
 * Responsibilities:
 * 1. Convert AnalysisCandidates to ScoredCandidates
 * 2. Add deterministic package candidates
 * 3. Compute traffic deltas for urgency signals
 * 4. Find recent targets (dedup last 3 months)
 * 5. Call composePlan and return the proposal
 */

import { prisma } from "@/lib/db";
import type { AnalysisCandidate } from "@/lib/analysis-candidates";
import {
  composePlan,
  classifyCandidateType,
  resolveConfig,
  type ScoredCandidate,
  type ComposedPlan,
  type UrgencySignals,
} from "./plan-composer";
import { getCatalogEntry, type ActionType, type TaskCategory } from "./task-catalog";

// ─── Traffic delta computation ──────────────────────────────────────────────

export interface TrafficDelta {
  url: string;
  clicksPrev: number;
  clicksCurr: number;
  impressionsPrev: number;
  impressionsCurr: number;
  clicksDeltaPct: number;
  impressionsDeltaPct: number;
}

/**
 * Compute traffic deltas per URL: last 28 days vs previous 28 days.
 * Uses PageMetric table. Returns URLs with significant drops.
 */
export async function computeTrafficDeltas(
  siteId: string,
  dropThresholdPct: number = 30,
): Promise<{ deltas: TrafficDelta[]; drops: TrafficDelta[] }> {
  const now = new Date();
  const d28 = new Date(now.getTime() - 28 * 86400000);
  const d56 = new Date(now.getTime() - 56 * 86400000);

  // Current period (last 28d)
  const current = await prisma.pageMetric.groupBy({
    by: ["url"],
    where: { siteId: { in: [siteId] }, date: { gte: d28 } },
    _sum: { clicks: true, impressions: true },
  });

  // Previous period (28-56d ago)
  const previous = await prisma.pageMetric.groupBy({
    by: ["url"],
    where: { siteId: { in: [siteId] }, date: { gte: d56, lt: d28 } },
    _sum: { clicks: true, impressions: true },
  });

  const prevMap = new Map(previous.map((p) => [p.url, p._sum]));

  const deltas: TrafficDelta[] = [];
  for (const curr of current) {
    const prev = prevMap.get(curr.url);
    const clicksPrev = prev?.clicks ?? 0;
    const clicksCurr = curr._sum.clicks ?? 0;
    const impressionsPrev = prev?.impressions ?? 0;
    const impressionsCurr = curr._sum.impressions ?? 0;

    const clicksDeltaPct = clicksPrev > 0 ? ((clicksCurr - clicksPrev) / clicksPrev) * 100 : 0;
    const impressionsDeltaPct = impressionsPrev > 0 ? ((impressionsCurr - impressionsPrev) / impressionsPrev) * 100 : 0;

    deltas.push({
      url: curr.url,
      clicksPrev, clicksCurr,
      impressionsPrev, impressionsCurr,
      clicksDeltaPct, impressionsDeltaPct,
    });
  }

  const drops = deltas.filter((d) =>
    d.impressionsDeltaPct < -dropThresholdPct && d.impressionsPrev > 50
  );

  return { deltas, drops };
}

// ─── Package candidates (deterministic) ─────────────────────────────────────

async function getPackageCandidates(siteId: string): Promise<ScoredCandidate[]> {
  const { PACKAGE_REGISTRY } = await import("./packages/index");

  const installed = await prisma.sitePackage.findMany({
    where: { siteId },
    select: { packageId: true, status: true },
  });
  const installedIds = new Set(installed.filter((p) => p.status === "INSTALLED").map((p) => p.packageId));

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { platform: true, githubRepo: true, defaultBranch: true },
  });
  if (!site) return [];

  const candidates: ScoredCandidate[] = [];

  for (const pkg of PACKAGE_REGISTRY) {
    if (pkg.version === "0") continue; // not active
    if (!site.platform || !pkg.platforms.includes(site.platform)) continue;
    if (installedIds.has(pkg.id)) continue;

    // Run detect if repo available
    if (site.githubRepo) {
      const detection = await pkg.detect({
        siteId,
        githubRepo: site.githubRepo,
        defaultBranch: site.defaultBranch,
      }).catch(() => ({ installed: false }));
      if (detection.installed) continue; // already installed, just not tracked
    }

    candidates.push({
      id: `pkg-${pkg.id}`,
      title: `Instalar paquete: ${pkg.name}`,
      actionType: "install_package",
      category: "infrastructure" as TaskCategory,
      targetUrl: null,
      targetKeyword: null,
      type: "strategic",
      score: 100, // packages get max score — they unblock other tasks
      impactBasis: "infrastructure",
      impactValue: 100,
      humanMinutes: 15,
      complexity: "high",
      risk: "medium",
      evidenceSummary: `Habilita: ${pkg.enables.join(", ")}`,
    });
  }

  return candidates;
}

// ─── Convert candidates ─────────────────────────────────────────────────────

function candidateToScored(
  c: AnalysisCandidate,
  urgency: UrgencySignals,
  deltaMap: Map<string, TrafficDelta>,
): ScoredCandidate {
  const entry = getCatalogEntry(c.actionType as ActionType);
  const category = (c.categoria ?? mapBloqueToCategory(c.bloque) ?? entry?.category ?? "technical") as TaskCategory;

  // Get impact value from traffic delta if available
  let impactValue: number | null = null;
  if (c.urlObjetivo && deltaMap.has(c.urlObjetivo)) {
    const delta = deltaMap.get(c.urlObjetivo)!;
    impactValue = delta.impressionsCurr; // raw impressions as impact proxy
  }

  const complexity = entry?.complexity ?? "medium";
  const risk = entry?.risk ?? "low";
  const humanMinutes = entry?.humanMinutes ?? 15;
  const impactBasis = entry?.impactBasis ?? "impressions_position";

  // Determine mode from catalog (not from LLM)
  const mode = entry?.modes?.WORDPRESS?.mode ?? entry?.modes?.NEXTJS?.mode ?? "HYBRID";

  const type = classifyCandidateType(
    c.actionType ?? "other",
    risk, complexity, mode,
    urgency, impactValue,
  );

  return {
    id: c.id,
    title: c.titulo,
    actionType: c.actionType ?? "other",
    category,
    targetUrl: c.urlObjetivo ?? null,
    targetKeyword: c.keywordObjetivo ?? null,
    type,
    score: 0, // filled by composePlan
    impactBasis,
    impactValue,
    humanMinutes,
    complexity,
    risk,
    evidenceSummary: c.justificacion.slice(0, 120),
  };
}

function mapBloqueToCategory(bloque?: string | null): TaskCategory | null {
  if (!bloque) return null;
  if (bloque === "tecnico") return "technical";
  if (bloque === "contenido") return "content";
  if (bloque === "aeo_geo") return "aeo_geo";
  return null;
}

// ─── Main entry point ───────────────────────────────────────────────────────

export async function composeProposal(
  clientId: string,
  siteId: string,
  candidates: AnalysisCandidate[],
  dropThresholdPct: number = 30,
): Promise<ComposedPlan> {
  // 1. Compute traffic deltas
  const { drops, deltas } = await computeTrafficDeltas(siteId, dropThresholdPct);
  const deltaMap = new Map(deltas.map((d) => [d.url, d]));

  // 2. Build urgency signals
  const auditIssues = await prisma.auditIssue.findMany({
    where: { audit: { siteId }, severity: { in: ["critical", "high"] } },
    select: { type: true, severity: true },
    take: 20,
  });

  const urgency: UrgencySignals = {
    has404WithTraffic: auditIssues.some((i) => i.type.includes("404")),
    hasDesindexedUrls: false, // would need GSC coverage data
    hasRobotsBlocking: false, // would need robots.txt check
    hasTrafficDrop: drops.length > 0,
    hasSecurityCritical: auditIssues.some((i) => i.severity === "critical" && (i.type.includes("security") || i.type.includes("xss"))),
    hasLostBacklinksHighDA: false, // would need backlink check
  };

  // 3. Convert analysis candidates to scored
  const scored = candidates
    .filter((c) => c.actionType !== "install_package") // don't duplicate package candidates
    .map((c) => candidateToScored(c, urgency, deltaMap));

  // 4. Add deterministic package candidates
  const packageCandidates = await getPackageCandidates(siteId);
  scored.push(...packageCandidates);

  // 5. Find recent targets (done in last 3 months)
  const threeMonthsAgo = new Date(Date.now() - 90 * 86400000);
  const recentTasks = await prisma.planTask.findMany({
    where: {
      siteId,
      status: "DONE",
      completedAt: { gte: threeMonthsAgo },
    },
    select: { targetKeyword: true, resultUrls: true },
  });
  const recentTargets = new Set<string>();
  for (const t of recentTasks) {
    if (t.targetKeyword) recentTargets.add(t.targetKeyword);
    for (const url of (t.resultUrls ?? [])) recentTargets.add(url);
  }

  // 6. Get client config
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { planConfig: true },
  });
  const config = resolveConfig(client?.planConfig);

  // 7. Compose
  return composePlan(scored, [], config, recentTargets);
}
