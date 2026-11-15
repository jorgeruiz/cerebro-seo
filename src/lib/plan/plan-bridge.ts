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
  type CandidateUrgencySignals,
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
  siteUrgencyData: SiteUrgencyData,
  deltaMap: Map<string, TrafficDelta>,
  gscMetrics: Map<string, { impressions: number; position: number; ctr: number }>,
  sitePlatform: string | null,
): ScoredCandidate {
  const entry = getCatalogEntry(c.actionType as ActionType);

  // Category: catalog first, LLM as fallback
  const category = (entry?.category ?? c.categoria ?? mapBloqueToCategory(c.bloque) ?? "technical") as TaskCategory;

  // Normalize URL for lookup
  const normalizedUrl = c.urlObjetivo ? normalizeUrl(c.urlObjetivo) : null;

  // Get impact value: traffic delta first, then GSC metrics
  let impactValue: number | null = null;
  if (normalizedUrl) {
    // Try delta map with normalized URL
    for (const [key, delta] of Array.from(deltaMap.entries())) {
      if (normalizeUrl(key) === normalizedUrl) {
        impactValue = delta.impressionsCurr;
        break;
      }
    }
    // Fallback: GSC metrics
    if (impactValue === null) {
      for (const [key, metrics] of Array.from(gscMetrics.entries())) {
        if (normalizeUrl(key) === normalizedUrl) {
          impactValue = metrics.impressions;
          break;
        }
      }
    }
  }

  const complexity = entry?.complexity ?? "medium";
  const risk = entry?.risk ?? "low";
  const humanMinutes = entry?.humanMinutes ?? 15;
  const impactBasis = entry?.impactBasis ?? "impressions_position";

  // Mode from catalog using the REAL site platform (not hardcoded WORDPRESS)
  const platformKey = sitePlatform === "NEXTJS" ? "NEXTJS" : sitePlatform === "WORDPRESS" ? "WORDPRESS" : null;
  const mode = platformKey && entry?.modes?.[platformKey]
    ? entry.modes[platformKey].mode
    : entry?.modes?.WORDPRESS?.mode ?? "HYBRID";

  // Per-candidate urgency (not global)
  const candidateUrgency = buildCandidateUrgency(c, siteUrgencyData);

  const type = classifyCandidateType(
    c.actionType ?? "other",
    risk, complexity, mode,
    candidateUrgency, impactValue,
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

/** Site-level urgency data used to build per-candidate signals. */
interface SiteUrgencyData {
  urlsWith404Traffic: Set<string>;
  urlsWithTrafficDrop: Set<string>;
  securityCriticalTypes: Set<string>;
}

function buildCandidateUrgency(
  c: AnalysisCandidate,
  data: SiteUrgencyData,
): CandidateUrgencySignals {
  const url = c.urlObjetivo ?? "";

  return {
    // Only urgent if THIS candidate's target has the problem
    targetHas404WithTraffic: data.urlsWith404Traffic.has(url),
    targetIsDesindexed: false, // would need GSC per-URL data
    targetBlockedByRobots: false,
    targetHasTrafficDrop: data.urlsWithTrafficDrop.has(url),
    isSecurityCritical: c.actionType === "security_fix" && data.securityCriticalTypes.size > 0,
    targetLostHighDABacklinks: false,
  };
}

/** Normalize URL for comparison: strip protocol, www, trailing slash. */
export function normalizeUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
    .toLowerCase();
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

  // 2. Build site-level urgency data (used per-candidate, not globally)
  const auditIssues = await prisma.auditIssue.findMany({
    where: { audit: { siteId }, severity: { in: ["critical", "high"] } },
    select: { type: true, severity: true, affectedUrl: true },
    take: 50,
  });

  // URLs with 404 that had traffic (cross with PageMetric)
  const urls404 = auditIssues.filter((i) => i.type.includes("404")).map((i) => i.affectedUrl).filter(Boolean) as string[];
  const urlsWith404Traffic = new Set<string>();
  if (urls404.length > 0) {
    const metricsFor404 = await prisma.pageMetric.groupBy({
      by: ["url"],
      where: { url: { in: urls404 }, clicks: { gt: 0 } },
      _sum: { clicks: true },
    });
    for (const m of metricsFor404) urlsWith404Traffic.add(m.url);
  }

  const siteUrgencyData: SiteUrgencyData = {
    urlsWith404Traffic,
    urlsWithTrafficDrop: new Set(drops.map((d) => d.url)),
    securityCriticalTypes: new Set(
      auditIssues.filter((i) => i.severity === "critical").map((i) => i.type)
    ),
  };

  // 2b. Fetch GSC metrics per URL (fallback when no traffic delta)
  const gscMetrics = new Map<string, { impressions: number; position: number; ctr: number }>();
  const recentMetrics = await prisma.pageMetric.groupBy({
    by: ["url"],
    where: { siteId: { in: [siteId] }, date: { gte: new Date(Date.now() - 28 * 86400000) } },
    _sum: { impressions: true, clicks: true },
    _avg: { position: true, ctr: true },
  });
  for (const m of recentMetrics) {
    gscMetrics.set(m.url, {
      impressions: m._sum.impressions ?? 0,
      position: m._avg.position ?? 0,
      ctr: m._avg.ctr ?? 0,
    });
  }

  // 2c. Get site platform
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { platform: true },
  });
  const sitePlatform = site?.platform ?? null;

  // 3. Convert analysis candidates to scored (per-candidate urgency, real platform)
  const scored = candidates
    .filter((c) => c.actionType !== "install_package")
    .map((c) => candidateToScored(c, siteUrgencyData, deltaMap, gscMetrics, sitePlatform));

  // 4. Add deterministic package candidates as prerequisites
  const packageCandidates = await getPackageCandidates(siteId);
  // Mark as prerequisites if they unblock any blocked candidates
  for (const pkg of packageCandidates) {
    // Find blocked candidates that this package would unblock
    const entry = getCatalogEntry(pkg.actionType as ActionType);
    if (entry) {
      const enables = (await import("./packages/index")).getPackageDefinition(
        pkg.id.replace("pkg-", "")
      )?.enables ?? [];
      const unblockedIds = scored
        .filter((s) => enables.includes(s.actionType))
        .map((s) => s.id);
      if (unblockedIds.length > 0) {
        pkg.unblocks = unblockedIds;
        pkg.isPrerequisite = true;
        pkg.evidenceSummary = `Desbloquea: ${unblockedIds.length} tareas (${enables.join(", ")})`;
      }
    }
  }
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
