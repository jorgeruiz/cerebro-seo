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
  impactValue: number | null;
  humanMinutes: number;
  complexity: string;
  risk: string;

  /** Evidence that backs the score */
  evidenceSummary: string;

  /** For install_package: IDs of blocked candidates this would unblock */
  unblocks?: string[];
  /** True if this is a prerequisite (install_package that unblocks others) — enters before quotas */
  isPrerequisite?: boolean;
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
    prerequisiteCount: number;
    /** Slots that stayed empty because not enough candidates of a type */
    freeSlots: number;
    /** What's missing per type to fill the caps */
    missingByType: { urgent: number; easyWin: number; strategic: number };
    humanMinutesTotal: number;
    humanMinutesCap: number;
    byCategory: Record<string, number>;
  };
}

// ─── Type classification (deterministic, no LLM) ────────────────────────────

/**
 * Per-candidate urgency signals (spec §9.6).
 *
 * Urgency must be SPECIFIC to the candidate's target, not global.
 * Example: fix_broken_links is urgent only if the broken destination
 * had traffic or backlinks — not just because any 404 exists on the site.
 */
export interface CandidateUrgencySignals {
  /** This candidate's target URL had a 404 with traffic or backlinks */
  targetHas404WithTraffic: boolean;
  /** This candidate's target URL is desindexed */
  targetIsDesindexed: boolean;
  /** robots.txt or noindex is blocking this candidate's target */
  targetBlockedByRobots: boolean;
  /** This candidate's target URL had a traffic drop > threshold */
  targetHasTrafficDrop: boolean;
  /** This candidate is about a security finding with severity CRITICAL */
  isSecurityCritical: boolean;
  /** This candidate's target lost high-DA backlinks recently */
  targetLostHighDABacklinks: boolean;
}

export const NO_URGENCY: CandidateUrgencySignals = {
  targetHas404WithTraffic: false,
  targetIsDesindexed: false,
  targetBlockedByRobots: false,
  targetHasTrafficDrop: false,
  isSecurityCritical: false,
  targetLostHighDABacklinks: false,
};

export function classifyCandidateType(
  actionType: string,
  risk: string,
  complexity: string,
  mode: string,
  urgency: CandidateUrgencySignals,
  impactValue: number | null,
): CandidateType {
  // Urgent: active loss specific to THIS candidate's target (spec §9.6)
  if (urgency.targetHas404WithTraffic || urgency.targetIsDesindexed
    || urgency.targetBlockedByRobots || urgency.targetHasTrafficDrop
    || urgency.isSecurityCritical || urgency.targetLostHighDABacklinks) {
    return "urgent";
  }

  // Easy win: low risk + AI mode + low complexity + data-backed (0 doesn't count)
  if (risk === "low" && (mode === "AI" || mode === "HYBRID") && complexity === "low" && impactValue !== null && impactValue > 0) {
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
  // Impact: normalized 0-100 from impactValue (0 = no data)
  const hasData = candidate.impactValue !== null && candidate.impactValue > 0;
  const impact = hasData ? Math.min(candidate.impactValue!, 100) : 30;

  // Confidence: 1.0 if real data (>0), 0.5 if none
  const confidence = hasData ? 1.0 : 0.5;

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
  recentTargets: Set<string>,
): ComposedPlan {
  const maxTasks = config.maxTasks;

  // Step 1: Score all candidates
  const scored = candidates.map((c) => {
    const catWeight = config.categoryWeights[c.category] ?? 1.0;
    return { ...c, score: scoreCandidate(c, catWeight) };
  });

  // Step 2: Exclude duplicates
  const eligible: typeof scored = [];
  const excluded: Array<(typeof scored)[0] & { exclusionReason: string }> = [];

  for (const c of scored) {
    const targetKey = c.targetUrl ?? c.targetKeyword ?? c.title;
    if (recentTargets.has(targetKey)) {
      excluded.push({ ...c, exclusionReason: `Duplicada: "${targetKey}" ejecutada en los últimos 3 meses` });
    } else {
      eligible.push(c);
    }
  }

  // Step 3: Separate prerequisites (install_package that unblocks others)
  const prerequisites = eligible.filter((c) => c.isPrerequisite);
  const regular = eligible.filter((c) => !c.isPrerequisite);

  // Sort regular by type then score
  const typeOrder: Record<CandidateType, number> = { urgent: 0, easy_win: 1, strategic: 2 };
  regular.sort((a, b) => {
    const typeDiff = typeOrder[a.type] - typeOrder[b.type];
    if (typeDiff !== 0) return typeDiff;
    return b.score - a.score;
  });

  // Step 4: Select
  const selected: Array<(typeof scored)[0] & { selectionReason: string }> = [];
  const categoryCounts: Record<string, number> = {};
  let humanMinutesTotal = 0;

  function trySelect(c: (typeof scored)[0], reason: string): boolean {
    if (selected.length >= maxTasks) return false;
    if (humanMinutesTotal + c.humanMinutes > config.humanMinutesCap) {
      excluded.push({ ...c, exclusionReason: `Supera tope humano: ${humanMinutesTotal}+${c.humanMinutes} > ${config.humanMinutesCap} min` });
      return false;
    }
    selected.push({ ...c, selectionReason: reason });
    humanMinutesTotal += c.humanMinutes;
    categoryCounts[c.category] = (categoryCounts[c.category] ?? 0) + 1;
    return true;
  }

  const isSelected = (id: string) => selected.some((s) => s.id === id);

  // 4.0: Prerequisites first (before quotas, don't consume strategic slot)
  for (const c of prerequisites) {
    const unblocksStr = c.unblocks?.length ? ` — desbloquea ${c.unblocks.length} tareas` : "";
    trySelect(c, `Prerrequisito: ${c.evidenceSummary}${unblocksStr}`);
  }

  // Compute CAPS (not fill targets) based on remaining slots after prerequisites
  const remainingSlots = maxTasks - selected.length;
  const urgentCap = Math.ceil(remainingSlots * config.mix.urgentCap);
  const easyWinCap = Math.ceil(remainingSlots * config.mix.easyWinTarget);
  const strategicCap = Math.ceil(remainingSlots * config.mix.strategicTarget);

  // Track how many of each type we've taken
  let urgentsTaken = 0;
  let easyWinsTaken = 0;
  let strategicsTaken = 0;

  function typeCapReached(type: CandidateType): boolean {
    if (type === "urgent") return urgentsTaken >= urgentCap;
    if (type === "easy_win") return easyWinsTaken >= easyWinCap;
    if (type === "strategic") return strategicsTaken >= strategicCap;
    return false;
  }

  function trackType(type: CandidateType): void {
    if (type === "urgent") urgentsTaken++;
    else if (type === "easy_win") easyWinsTaken++;
    else if (type === "strategic") strategicsTaken++;
  }

  // 4a: Urgents (up to cap)
  for (const c of regular) {
    if (c.type !== "urgent") continue;
    if (urgentsTaken >= urgentCap) {
      excluded.push({ ...c, exclusionReason: `Tope urgentes (${urgentCap})` });
      continue;
    }
    if (trySelect(c, `Urgente (score=${c.score.toFixed(1)}, ${c.evidenceSummary})`)) {
      trackType("urgent");
    }
  }

  // 4b: Category minimums — only within type caps
  for (const [cat, min] of Object.entries(config.categoryMinimums)) {
    const current = categoryCounts[cat] ?? 0;
    if (current >= (min ?? 0)) continue;

    const catCandidates = regular.filter((c) => c.category === cat && !isSelected(c.id));
    catCandidates.sort((a, b) => b.score - a.score);

    for (const c of catCandidates) {
      if ((categoryCounts[cat] ?? 0) >= (min ?? 0)) break;
      if (typeCapReached(c.type)) continue; // respect type cap even for minimums
      const typeLabel = c.type === "urgent" ? "urgente" : c.type === "easy_win" ? "easy win" : "estratégica";
      if (trySelect(c, `Mínimo categoría ${cat}, ${typeLabel} (score=${c.score.toFixed(1)})`)) {
        trackType(c.type);
      }
    }
  }

  // 4c: Easy wins (up to cap)
  for (const c of regular) {
    if (c.type !== "easy_win" || isSelected(c.id)) continue;
    if (easyWinsTaken >= easyWinCap) break;
    if (selected.length >= maxTasks) break;
    if (trySelect(c, `Easy win (score=${c.score.toFixed(1)}, ${c.evidenceSummary})`)) {
      trackType("easy_win");
    }
  }

  // 4d: Strategic (up to cap)
  for (const c of regular) {
    if (c.type !== "strategic" || isSelected(c.id)) continue;
    if (strategicsTaken >= strategicCap) break;
    if (selected.length >= maxTasks) break;
    if (trySelect(c, `Estratégica (score=${c.score.toFixed(1)}, ${c.evidenceSummary})`)) {
      trackType("strategic");
    }
  }

  // 4e: Remaining → excluded with specific reason
  for (const c of eligible) {
    if (isSelected(c.id) || excluded.some((e) => e.id === c.id)) continue;
    const reason = typeCapReached(c.type)
      ? `Tope ${c.type} alcanzado`
      : `Cuota llena (${selected.length}/${maxTasks})`;
    excluded.push({ ...c, exclusionReason: reason });
  }

  // Stats: computed from ALL selected (including those entered via category minimums)
  const prerequisiteCount = selected.filter((s) => s.isPrerequisite).length;
  const freeSlots = maxTasks - selected.length;
  const missingByType = {
    urgent: Math.max(0, urgentCap - urgentsTaken),
    easyWin: Math.max(0, easyWinCap - easyWinsTaken),
    strategic: Math.max(0, strategicCap - strategicsTaken),
  };

  return {
    selected,
    excluded,
    blocked,
    stats: {
      totalCandidates: candidates.length,
      selected: selected.length,
      excluded: excluded.length,
      blocked: blocked.length,
      urgentCount: urgentsTaken,
      easyWinCount: easyWinsTaken,
      strategicCount: strategicsTaken,
      prerequisiteCount,
      freeSlots,
      missingByType,
      humanMinutesTotal,
      humanMinutesCap: config.humanMinutesCap,
      byCategory: categoryCounts,
    },
  };
}
