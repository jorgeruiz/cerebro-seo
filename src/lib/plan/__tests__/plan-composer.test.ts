import { describe, it, expect } from "vitest";
import {
  composePlan,
  classifyCandidateType,
  scoreCandidate,
  resolveConfig,
  DEFAULT_PLAN_CONFIG,
  NO_URGENCY,
  type ScoredCandidate,
} from "../plan-composer";

const noUrgency = NO_URGENCY;

function makeCandidate(overrides: Partial<ScoredCandidate>): ScoredCandidate {
  return {
    id: `c-${Math.random().toString(36).slice(2, 8)}`,
    title: "Test task",
    actionType: "update_meta",
    category: "technical",
    targetUrl: null,
    targetKeyword: null,
    type: "easy_win",
    score: 50,
    impactBasis: "ctr_impressions",
    impactValue: 50,
    humanMinutes: 0,
    complexity: "low",
    risk: "low",
    evidenceSummary: "test evidence",
    ...overrides,
  };
}

// ─── classifyCandidateType ──────────────────────────────────────────────────

describe("classifyCandidateType", () => {
  it("404 with traffic on THIS target → urgent", () => {
    expect(classifyCandidateType("fix_redirect", "medium", "low", "AI", { ...noUrgency, targetHas404WithTraffic: true }, 100)).toBe("urgent");
  });

  it("security critical → urgent", () => {
    expect(classifyCandidateType("security_fix", "high", "medium", "HYBRID", { ...noUrgency, isSecurityCritical: true }, null)).toBe("urgent");
  });

  it("fix_broken_links WITHOUT traffic on target → NOT urgent (strategic)", () => {
    // Per spec §9.6: only urgent if the broken destination had traffic or backlinks
    expect(classifyCandidateType("fix_broken_links", "low", "low", "AI", noUrgency, 50)).toBe("easy_win");
  });

  it("fix_broken_links WITH traffic drop on target → urgent", () => {
    expect(classifyCandidateType("fix_broken_links", "low", "low", "AI", { ...noUrgency, targetHasTrafficDrop: true }, 50)).toBe("urgent");
  });

  it("low risk + AI + low complexity + data → easy_win", () => {
    expect(classifyCandidateType("update_meta", "low", "low", "AI", noUrgency, 80)).toBe("easy_win");
  });

  it("low risk + AI + low complexity + NO data → strategic (not easy win)", () => {
    expect(classifyCandidateType("update_meta", "low", "low", "AI", noUrgency, null)).toBe("strategic");
  });

  it("high complexity → strategic", () => {
    expect(classifyCandidateType("create_landing", "medium", "high", "HYBRID", noUrgency, 60)).toBe("strategic");
  });
});

// ─── composePlan ────────────────────────────────────────────────────────────

describe("composePlan", () => {
  it("selects up to maxTasks", () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      makeCandidate({ id: `c${i}`, category: i < 5 ? "technical" : i < 10 ? "content" : "aeo_geo" })
    );
    const result = composePlan(candidates, [], DEFAULT_PLAN_CONFIG, new Set());
    expect(result.selected.length).toBeLessThanOrEqual(DEFAULT_PLAN_CONFIG.maxTasks);
  });

  it("urgents never exceed cap", () => {
    const urgents = Array.from({ length: 8 }, (_, i) =>
      makeCandidate({ id: `u${i}`, type: "urgent", category: "technical", score: 90 - i })
    );
    const result = composePlan(urgents, [], DEFAULT_PLAN_CONFIG, new Set());
    expect(result.stats.urgentCount).toBeLessThanOrEqual(Math.ceil(DEFAULT_PLAN_CONFIG.maxTasks * DEFAULT_PLAN_CONFIG.mix.urgentCap));
  });

  it("respects category minimums even with better candidates elsewhere", () => {
    // 10 great technical candidates + 1 mediocre aeo_geo
    const candidates = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeCandidate({ id: `t${i}`, category: "technical", score: 90 - i })
      ),
      makeCandidate({ id: "aeo1", category: "aeo_geo", score: 10, type: "strategic" }),
      makeCandidate({ id: "c1", category: "content", score: 20, type: "strategic" }),
      makeCandidate({ id: "c2", category: "content", score: 15, type: "strategic" }),
    ];
    const result = composePlan(candidates, [], DEFAULT_PLAN_CONFIG, new Set());
    expect(result.stats.byCategory["aeo_geo"]).toBeGreaterThanOrEqual(1);
    expect(result.stats.byCategory["content"]).toBeGreaterThanOrEqual(2);
  });

  it("excludes duplicates from recent targets", () => {
    const candidates = [
      makeCandidate({ id: "d1", targetUrl: "/servicios", score: 95 }),
      makeCandidate({ id: "d2", targetUrl: "/contacto", score: 80 }),
    ];
    const recentTargets = new Set(["/servicios"]);
    const result = composePlan(candidates, [], DEFAULT_PLAN_CONFIG, recentTargets);
    expect(result.selected.find((s) => s.id === "d1")).toBeUndefined();
    expect(result.excluded.find((e) => e.id === "d1")?.exclusionReason).toContain("Duplicada");
  });

  it("human minutes cap triggers replacement", () => {
    const config = { ...DEFAULT_PLAN_CONFIG, humanMinutesCap: 30 };
    const candidates = [
      makeCandidate({ id: "h1", humanMinutes: 20, score: 80, category: "technical" }),
      makeCandidate({ id: "h2", humanMinutes: 20, score: 70, category: "content" }),
      makeCandidate({ id: "h3", humanMinutes: 0, score: 60, category: "content" }),
      makeCandidate({ id: "h4", humanMinutes: 0, score: 50, category: "aeo_geo" }),
    ];
    const result = composePlan(candidates, [], config, new Set());
    // h1 (20min) fits, h2 (20min) would exceed 30min cap → excluded
    expect(result.selected.find((s) => s.id === "h2")).toBeUndefined();
    expect(result.excluded.find((e) => e.id === "h2")?.exclusionReason).toContain("tope humano");
  });

  it("is deterministic: same inputs → same output", () => {
    const candidates = [
      makeCandidate({ id: "det1", score: 90, category: "technical" }),
      makeCandidate({ id: "det2", score: 80, category: "content" }),
      makeCandidate({ id: "det3", score: 70, category: "aeo_geo" }),
      makeCandidate({ id: "det4", score: 60, category: "content", type: "strategic" }),
    ];
    const result1 = composePlan(candidates, [], DEFAULT_PLAN_CONFIG, new Set());
    const result2 = composePlan(candidates, [], DEFAULT_PLAN_CONFIG, new Set());
    expect(result1.selected.map((s) => s.id)).toEqual(result2.selected.map((s) => s.id));
    expect(result1.stats).toEqual(result2.stats);
  });

  it("every selected candidate has selectionReason", () => {
    const candidates = [makeCandidate({ id: "r1" })];
    const result = composePlan(candidates, [], DEFAULT_PLAN_CONFIG, new Set());
    for (const s of result.selected) {
      expect(s.selectionReason).toBeTruthy();
      expect(s.selectionReason.length).toBeGreaterThan(5);
    }
  });

  it("every excluded candidate has exclusionReason", () => {
    const candidates = Array.from({ length: 15 }, (_, i) =>
      makeCandidate({ id: `e${i}`, category: "technical" })
    );
    const result = composePlan(candidates, [], DEFAULT_PLAN_CONFIG, new Set());
    for (const e of result.excluded) {
      expect(e.exclusionReason).toBeTruthy();
    }
  });

  // ── F2b adjustments ──────────────────────────────────────────────────

  it("category minimums count toward type quotas in stats", () => {
    // 2 content candidates: 1 easy_win + 1 strategic
    const candidates = [
      makeCandidate({ id: "tech1", category: "technical", type: "easy_win", score: 90 }),
      makeCandidate({ id: "cont1", category: "content", type: "easy_win", score: 50 }),
      makeCandidate({ id: "cont2", category: "content", type: "strategic", score: 40 }),
      makeCandidate({ id: "aeo1", category: "aeo_geo", type: "strategic", score: 30 }),
    ];
    const result = composePlan(candidates, [], DEFAULT_PLAN_CONFIG, new Set());
    // content min=2, aeo_geo min=1 → all 4 selected
    // Stats should reflect: 2 easy_win (tech1 + cont1), 2 strategic (cont2 + aeo1)
    expect(result.stats.easyWinCount).toBe(2);
    expect(result.stats.strategicCount).toBe(2);
    expect(result.selected.length).toBe(4);
  });

  it("install_package prerequisite enters before quotas and doesn't consume strategic", () => {
    const config = { ...DEFAULT_PLAN_CONFIG, maxTasks: 3 };
    const candidates = [
      makeCandidate({
        id: "pkg1", actionType: "install_package", category: "infrastructure",
        type: "strategic", isPrerequisite: true, unblocks: ["blog1"],
        score: 100, evidenceSummary: "Desbloquea: create_blog",
      }),
      makeCandidate({ id: "blog1", category: "content", type: "strategic", score: 60 }),
      makeCandidate({ id: "meta1", category: "technical", type: "easy_win", score: 80 }),
      makeCandidate({ id: "meta2", category: "technical", type: "easy_win", score: 70 }),
    ];
    const result = composePlan(candidates, [], config, new Set());
    // pkg1 enters as prerequisite (doesn't count toward strategic quota)
    expect(result.selected[0].id).toBe("pkg1");
    expect(result.selected[0].selectionReason).toContain("Prerrequisito");
    // strategicCount should NOT include the prerequisite
    expect(result.stats.prerequisiteCount).toBe(1);
    expect(result.stats.strategicCount).toBe(1); // blog1 only
    // Total: 3 (pkg1 + meta1 + blog1 or meta2)
    expect(result.selected.length).toBe(3);
  });

  it("install_package shows what it unblocks", () => {
    const candidates = [
      makeCandidate({
        id: "pkg1", actionType: "install_package", category: "infrastructure",
        type: "strategic", isPrerequisite: true, unblocks: ["b1", "b2"],
        score: 100, evidenceSummary: "Desbloquea: create_blog, refresh_content",
      }),
      makeCandidate({ id: "b1", category: "content", type: "easy_win", score: 50 }),
      makeCandidate({ id: "b2", category: "content", type: "strategic", score: 40 }),
    ];
    const result = composePlan(candidates, [], DEFAULT_PLAN_CONFIG, new Set());
    const pkg = result.selected.find((s) => s.id === "pkg1");
    expect(pkg).toBeDefined();
    expect(pkg!.unblocks).toContain("b1");
    expect(pkg!.unblocks).toContain("b2");
    expect(pkg!.selectionReason).toContain("desbloquea");
  });
});

// ─── resolveConfig ──────────────────────────────────────────────────────────

describe("resolveConfig", () => {
  it("returns defaults for null", () => {
    expect(resolveConfig(null)).toEqual(DEFAULT_PLAN_CONFIG);
  });

  it("merges partial overrides", () => {
    const config = resolveConfig({ maxTasks: 8, humanMinutesCap: 120 });
    expect(config.maxTasks).toBe(8);
    expect(config.humanMinutesCap).toBe(120);
    expect(config.mix.urgentCap).toBe(DEFAULT_PLAN_CONFIG.mix.urgentCap);
  });
});

// ─── scoreCandidate ─────────────────────────────────────────────────────────

describe("scoreCandidate", () => {
  it("scores higher with real data than without", () => {
    const withData = makeCandidate({ impactValue: 80 });
    const withoutData = makeCandidate({ impactValue: null });
    expect(scoreCandidate(withData, 1.0)).toBeGreaterThan(scoreCandidate(withoutData, 1.0));
  });

  it("category weight multiplies score", () => {
    const c = makeCandidate({ impactValue: 50 });
    expect(scoreCandidate(c, 1.5)).toBeGreaterThan(scoreCandidate(c, 1.0));
  });

  it("high human minutes penalizes score", () => {
    const low = makeCandidate({ humanMinutes: 0 });
    const high = makeCandidate({ humanMinutes: 60 });
    expect(scoreCandidate(low, 1.0)).toBeGreaterThan(scoreCandidate(high, 1.0));
  });
});
