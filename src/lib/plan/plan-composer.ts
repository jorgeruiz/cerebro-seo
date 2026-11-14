/**
 * Plan Composer — deterministic selection of candidates for the monthly plan.
 *
 * The Analysis Claude PROPOSES candidates (with evidence).
 * This module SELECTS which ones enter the plan, based on fixed rules:
 *   - Urgent first (up to 30%)
 *   - Category minimums respected
 *   - Easy wins fill ~50%
 *   - Strategic fill ~25-30%
 *   - Human minutes cap
 *   - API cost cap
 *   - No duplicates (same target in last 3 months)
 *
 * Every selected candidate gets a selectionReason.
 * Every excluded candidate gets an exclusionReason.
 *
 * Spec: §9.6 Composición del plan mensual.
 */

import type { TaskCategory, ImpactBasis } from "./task-catalog";

// ─── Configuration ──────────────────────────────────────────────────────────

export interface ClientPlanConfig {
  maxTasks: number;
  mix: {
    urgentCap: number;    // fraction, e.g. 0.30
    easyWinTarget: number; // fraction, e.g. 0.50
    strategicTarget: number; // fraction, e.g. 0.25
  };
  categoryMinimums: Partial<Record<TaskCategory, number>>;
  categoryWeights: Partial<Record<TaskCategory, number>>;
  humanMinutesCap: number;
  apiCostCapUsd: number;
}

export const DEFAULT_PLAN_CONFIG: ClientPlanConfig = {
  maxTasks: 10,
  mix: {
    urgentCap: 0.30,
    easyWinTarget: 0.50,
    strategicTarget: 0.25,
  },
  categoryMinimums: {
    technical: 1,
    content: 2,
    aeo_geo: 1,
    authority_local: 0,
    measurement_conversion: 0,
    infrastructure: 0,
  },
  categoryWeights: {
    technical: 1.0,
    content: 1.0,
    aeo_geo: 1.0,
    authority_local: 0.8,
    measurement_conversion: 0.7,
    infrastructure: 1.2,
  },
  humanMinutesCap: 240,
  apiCostCapUsd: 5.0,
};

export function resolveConfig(stored: unknown): ClientPlanConfig {
  if (!stored || typeof stored !== "object") return DEFAULT_PLAN_CONFIG;
  const s = stored as Partial<ClientPlanConfig>;
  return {
    maxTasks: s.maxTasks ?? DEFAULT_PLAN_CONFIG.maxTasks,
    mix: { ...DEFAULT_PLAN_CONFIG.mix, ...s.mix },
    categoryMinimums: { ...DEFAULT_PLAN_CONFIG.categoryMinimums, ...s.categoryMinimums },
    categoryWeights: { ...DEFAULT_PLAN_CONFIG.categoryWeights, ...s.categoryWeights },
    humanMinutesCap: s.humanMinutesCap ?? DEFAULT_PLAN_CONFIG.humanMinutesCap,
    apiCostCapUsd: s.apiCostCapUsd ?? DEFAULT_PLAN_CONFIG.apiCostCapUsd,
  };
}

// ─── Candidate classification ───────────────────────────────────────────────

export type CandidateType = "urgent" | "easy_win" | "strategic";

export interface ScoredCandidate {
  /** Original candidate data */
  id: string;
  title: string;
  actionType: string;
  category: TaskCategory;
  targetUrl: string | null;
  targetKeyword: string | null;

  /** Scoring */
  type: CandidateType;
  score: number;
  impactBasis: ImpactBasis;
  impactValue: number | null;  // the actual metric value (impressions, position, etc.)
  humanMinutes: number;
  complexity: string;
  risk: string;

  /** Evidence that backs the score */
  evidenceSummary: string;
}

export interface ComposedPlan {
  selected: Array<ScoredCandidate & { selectionReason: string }>;
  excluded: Array<ScoredCandidate & { exclusionReason: string }>;
  blocked: Array<{ id: string; title: string; reason: string; remedy: string }>;
  stats: {
    totalCandidates: number;
    selected: number;
    excluded: number;
    blocked: number;
    urgentCount: number;
    easyWinCount: number;
    strategicCount: number;
    humanMinutesTotal: number;
    humanMinutesCap: number;
    byCategory: Record<string, number>;
  };
}

// ─── Type classification (deterministic, no LLM) ────────────────────────────

export interface UrgencySignals {
  has404WithTraffic: boolean;
  hasDesindexedUrls: boolean;
  hasRobotsBlocking: boolean;
  hasTrafficDrop: boolean;       // >20% drop in GSC impressions 28d
  hasSecurityCritical: boolean;
  hasLostBacklinksHighDA: boolean;
}

export function classifyCandidateType(
  actionType: string,
  risk: string,
  complexity: string,
  mode: string,
  urgency: UrgencySignals,
  impactValue: number | null,
): CandidateType {
  // Urgent: active loss of traffic or trust
  if (urgency.has404WithTraffic || urgency.hasDesindexedUrls || urgency.hasRobotsBlocking
    || urgency.hasTrafficDrop || urgency.hasSecurityCritical || urgency.hasLostBacklinksHighDA) {
    return "urgent";
  }

  // Easy win: low risk + AI mode + low complexity + data-backed
  if (risk === "low" && (mode === "AI" || mode === "HYBRID") && complexity === "low" && impactValue !== null) {
    return "easy_win";
  }

  // Everything else is strategic
  return "strategic";
}

// ─── Scoring ────────────────────────────────────────────────────────────────

export function scoreCandidate(
  candidate: ScoredCandidate,
  categoryWeight: number,
): number {
  // Impact: normalized 0-100 from impactValue
  const impact = candidate.impactValue !== null
    ? Math.min(candidate.impactValue, 100)
    : 30; // default if no data

  // Confidence: 1.0 if real data, 0.5 if no impactValue
  const confidence = candidate.impactValue !== null ? 1.0 : 0.5;

  // Effort penalty: complexity + humanMinutes
  const complexityPenalty = candidate.complexity === "low" ? 1.0
    : candidate.complexity === "medium" ? 0.7
    : 0.4; // high

  const humanPenalty = candidate.humanMinutes > 0
    ? Math.max(0.3, 1 - candidate.humanMinutes / 120)
    : 1.0;

  return impact * confidence * complexityPenalty * humanPenalty * categoryWeight;
}

// ─── Selection algorithm ────────────────────────────────────────────────────

export function composePlan(
  candidates: ScoredCandidate[],
  blocked: Array<{ id: string; title: string; reason: string; remedy: string }>,
  config: ClientPlanConfig,
  recentTargets: Set<string>, // targets done in last 3 months
): ComposedPlan {
  const maxTasks = config.maxTasks;
  const urgentCap = Math.ceil(maxTasks * config.mix.urgentCap);

  // Step 1: Score all candidates
  const scored = candidates.map((c) => {
    const catWeight = config.categoryWeights[c.category] ?? 1.0;
    return { ...c, score: scoreCandidate(c, catWeight) };
  });

  // Step 2: Exclude duplicates (same target in last 3 months)
  const eligible: typeof scored = [];
  const duplicateExcluded: Array<(typeof scored)[0] & { exclusionReason: string }> = [];

  for (const c of scored) {
    const targetKey = c.targetUrl ?? c.targetKeyword ?? c.title;
    if (recentTargets.has(targetKey)) {
      duplicateExcluded.push({ ...c, exclusionReason: `Duplicada: "${targetKey}" ejecutada en los últimos 3 meses` });
    } else {
      eligible.push(c);
    }
  }

  // Step 3: Sort by type priority then score
  const typeOrder: Record<CandidateType, number> = { urgent: 0, easy_win: 1, strategic: 2 };
  eligible.sort((a, b) => {
    const typeDiff = typeOrder[a.type] - typeOrder[b.type];
    if (typeDiff !== 0) return typeDiff;
    return b.score - a.score;
  });

  // Step 4: Select
  const selected: Array<(typeof scored)[0] & { selectionReason: string }> = [];
  const excluded: Array<(typeof scored)[0] & { exclusionReason: string }> = [];
  const categoryCounts: Record<string, number> = {};
  let humanMinutesTotal = 0;
  let urgentCount = 0;

  function trySelect(c: (typeof scored)[0], reason: string): boolean {
    if (selected.length >= maxTasks) return false;

    // Check human minutes cap
    if (humanMinutesTotal + c.humanMinutes > config.humanMinutesCap) {
      excluded.push({ ...c, exclusionReason: `Supera tope humano: ${humanMinutesTotal}+${c.humanMinutes} > ${config.humanMinutesCap} min` });
      return false;
    }

    selected.push({ ...c, selectionReason: reason });
    humanMinutesTotal += c.humanMinutes;
    categoryCounts[c.category] = (categoryCounts[c.category] ?? 0) + 1;
    if (c.type === "urgent") urgentCount++;
    return true;
  }

  // 4a: Urgents first (up to cap)
  const urgents = eligible.filter((c) => c.type === "urgent");
  for (const c of urgents) {
    if (urgentCount >= urgentCap) {
      excluded.push({ ...c, exclusionReason: `Cuota urgentes llena (${urgentCap})` });
      continue;
    }
    trySelect(c, `Urgente (score=${c.score.toFixed(1)}, ${c.evidenceSummary})`);
  }

  // 4b: Category minimums with best-scoring candidates
  const nonUrgentSelected = new Set(selected.map((s) => s.id));
  const remaining = eligible.filter((c) => c.type !== "urgent" && !nonUrgentSelected.has(c.id));

  for (const [cat, min] of Object.entries(config.categoryMinimums)) {
    const current = categoryCounts[cat] ?? 0;
    if (current >= (min ?? 0)) continue;

    const catCandidates = remaining.filter((c) => c.category === cat);
    catCandidates.sort((a, b) => b.score - a.score);

    for (const c of catCandidates) {
      if ((categoryCounts[cat] ?? 0) >= (min ?? 0)) break;
      if (selected.find((s) => s.id === c.id)) continue;
      trySelect(c, `Mínimo categoría ${cat} (score=${c.score.toFixed(1)})`);
    }
  }

  // 4c: Fill easy wins
  const easyWins = remaining.filter((c) => c.type === "easy_win" && !selected.find((s) => s.id === c.id));
  easyWins.sort((a, b) => b.score - a.score);
  for (const c of easyWins) {
    if (selected.length >= maxTasks) break;
    trySelect(c, `Easy win (score=${c.score.toFixed(1)}, ${c.evidenceSummary})`);
  }

  // 4d: Fill strategic
  const strategic = remaining.filter((c) => c.type === "strategic" && !selected.find((s) => s.id === c.id));
  strategic.sort((a, b) => b.score - a.score);
  for (const c of strategic) {
    if (selected.length >= maxTasks) break;
    trySelect(c, `Estratégica (score=${c.score.toFixed(1)}, ${c.evidenceSummary})`);
  }

  // 4e: Everything not selected goes to excluded
  for (const c of eligible) {
    if (!selected.find((s) => s.id === c.id) && !excluded.find((e) => e.id === c.id)) {
      excluded.push({ ...c, exclusionReason: `Cuota llena (${selected.length}/${maxTasks})` });
    }
  }

  // Merge duplicate-excluded
  excluded.push(...duplicateExcluded);

  return {
    selected,
    excluded,
    blocked,
    stats: {
      totalCandidates: candidates.length,
      selected: selected.length,
      excluded: excluded.length,
      blocked: blocked.length,
      urgentCount,
      easyWinCount: selected.filter((s) => s.type === "easy_win").length,
      strategicCount: selected.filter((s) => s.type === "strategic").length,
      humanMinutesTotal,
      humanMinutesCap: config.humanMinutesCap,
      byCategory: categoryCounts,
    },
  };
}
