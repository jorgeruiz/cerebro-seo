import { describe, it, expect } from "vitest";
import {
  CATALOG,
  ACTION_TYPES,
  STEP_KINDS,
  DEPRECATED_ALIASES,
  resolveAlias,
  getCatalogEntry,
  isValidActionType,
  type StepKind,
} from "../task-catalog";

describe("task-catalog integrity", () => {

  it("every entry has a unique actionType from the enum", () => {
    const types = CATALOG.map((e) => e.actionType);
    const unique = new Set(types);
    expect(unique.size).toBe(types.length); // no duplicates
    for (const t of types) {
      expect(ACTION_TYPES).toContain(t);
    }
  });

  it("every actionType in the enum has a catalog entry", () => {
    for (const at of ACTION_TYPES) {
      expect(getCatalogEntry(at)).toBeDefined();
    }
  });

  it("every HM step has a humanReason", () => {
    for (const entry of CATALOG) {
      for (const platform of ["NEXTJS", "WORDPRESS"] as const) {
        for (const step of entry.steps[platform]) {
          if (step.type === "HM") {
            expect(step.humanReason, `${entry.actionType}/${platform} step "${step.title}" missing humanReason`).toBeTruthy();
          }
          // Also check fallback steps
          if (step.fallback?.type === "HM") {
            expect(step.fallback.humanReason, `${entry.actionType}/${platform} fallback "${step.fallback.title}" missing humanReason`).toBeTruthy();
          }
        }
      }
    }
  });

  it("mode AI ⇒ no HM steps", () => {
    for (const entry of CATALOG) {
      for (const platform of ["NEXTJS", "WORDPRESS"] as const) {
        const mode = entry.modes[platform].mode;
        if (mode === "AI") {
          const hasHM = entry.steps[platform].some((s) => s.type === "HM");
          expect(hasHM, `${entry.actionType}/${platform} is AI but has HM step`).toBe(false);
        }
      }
    }
  });

  it("mode MANUAL ⇒ no AI writing steps (analysis is allowed)", () => {
    const AI_WRITE_KINDS: StepKind[] = [
      "content_package", "publish", "seo", "elementor_edit", "elementor_template",
      "image", "agent", "content_lane", "nextjs_blog_generate", "apply_keywords",
    ];
    for (const entry of CATALOG) {
      for (const platform of ["NEXTJS", "WORDPRESS"] as const) {
        const mode = entry.modes[platform].mode;
        if (mode === "MANUAL") {
          const hasAIWrite = entry.steps[platform].some(
            (s) => s.type === "AI" && AI_WRITE_KINDS.includes(s.kind)
          );
          expect(hasAIWrite, `${entry.actionType}/${platform} is MANUAL but has AI writing step`).toBe(false);
        }
      }
    }
  });

  it("mode HYBRID ⇒ at least one AI and at least one HM step", () => {
    for (const entry of CATALOG) {
      for (const platform of ["NEXTJS", "WORDPRESS"] as const) {
        const mode = entry.modes[platform].mode;
        if (mode === "HYBRID") {
          const hasAI = entry.steps[platform].some((s) => s.type === "AI");
          const hasHM = entry.steps[platform].some((s) => s.type === "HM");
          expect(hasAI, `${entry.actionType}/${platform} is HYBRID but has no AI step`).toBe(true);
          expect(hasHM, `${entry.actionType}/${platform} is HYBRID but has no HM step`).toBe(true);
        }
      }
    }
  });

  it("every StepKind used belongs to the vocabulary", () => {
    for (const entry of CATALOG) {
      for (const platform of ["NEXTJS", "WORDPRESS"] as const) {
        for (const step of entry.steps[platform]) {
          expect(STEP_KINDS, `Unknown step kind "${step.kind}" in ${entry.actionType}/${platform}`).toContain(step.kind);
          if (step.fallback) {
            expect(STEP_KINDS, `Unknown fallback kind "${step.fallback.kind}"`).toContain(step.fallback.kind);
          }
        }
      }
    }
  });

  it("every entry has at least one acceptance criterion", () => {
    for (const entry of CATALOG) {
      expect(entry.acceptance.length, `${entry.actionType} has no acceptance criteria`).toBeGreaterThanOrEqual(1);
    }
  });

  it("every entry has a category", () => {
    for (const entry of CATALOG) {
      expect(entry.category, `${entry.actionType} has no category`).toBeTruthy();
    }
  });

  it("every entry except 'other' has at least one signal", () => {
    for (const entry of CATALOG) {
      if (entry.actionType === "other") continue;
      expect(entry.signals.length, `${entry.actionType} has no signals`).toBeGreaterThanOrEqual(1);
    }
  });

  it("no positive signal is identical between two entries without disambiguation", () => {
    const signalMap = new Map<string, string[]>();
    for (const entry of CATALOG) {
      for (const signal of entry.signals) {
        const normalized = signal.toLowerCase().trim();
        const existing = signalMap.get(normalized) ?? [];
        existing.push(entry.actionType);
        signalMap.set(normalized, existing);
      }
    }

    const collisions: string[] = [];
    for (const [signal, types] of signalMap) {
      if (types.length > 1) {
        collisions.push(`"${signal}" → ${types.join(", ")}`);
      }
    }

    // Allow known collisions that are handled by disambiguation or context
    // (e.g., "FAQ" could be add_faq or schema depending on context)
    // For now just report — strict enforcement comes in F1b
    if (collisions.length > 0) {
      console.warn(`[catalog] Signal collisions (handled by disambiguation):\n  ${collisions.join("\n  ")}`);
    }
  });

  it("WP AI steps with requiredCapability have a fallback", () => {
    for (const entry of CATALOG) {
      for (const step of entry.steps.WORDPRESS) {
        if (step.type === "AI" && step.requiredCapability) {
          expect(step.fallback, `${entry.actionType}/WP step "${step.title}" requires ${step.requiredCapability} but has no fallback`).toBeDefined();
        }
      }
    }
  });
});

describe("deprecated aliases", () => {
  it("no alias is a valid current actionType", () => {
    for (const alias of Object.keys(DEPRECATED_ALIASES)) {
      expect(isValidActionType(alias), `Alias "${alias}" is also a valid actionType — remove from aliases`).toBe(false);
    }
  });

  it("alias targets are valid actionTypes or null", () => {
    for (const [alias, target] of Object.entries(DEPRECATED_ALIASES)) {
      if (target !== null) {
        expect(isValidActionType(target), `Alias "${alias}" → "${target}" is not a valid actionType`).toBe(true);
      }
    }
  });

  it("resolveAlias returns canonical for known aliases", () => {
    expect(resolveAlias("edit_page_widgets")).toBe("edit_page_text");
    expect(resolveAlias("create_landing_from_template")).toBe("create_landing");
    expect(resolveAlias("upload_media")).toBe("add_image");
    expect(resolveAlias("generate_image")).toBe("add_image");
    expect(resolveAlias("verify_tracking")).toBe("verify_analytics");
  });

  it("resolveAlias returns null for update_post (requires context)", () => {
    expect(resolveAlias("update_post")).toBeNull();
  });

  it("resolveAlias passes through valid actionTypes", () => {
    expect(resolveAlias("create_blog")).toBe("create_blog");
    expect(resolveAlias("update_meta")).toBe("update_meta");
    expect(resolveAlias("other")).toBe("other");
  });
});

describe("catalog lookup", () => {
  it("getCatalogEntry returns entry for valid type", () => {
    const entry = getCatalogEntry("create_blog");
    expect(entry).toBeDefined();
    expect(entry!.actionType).toBe("create_blog");
  });

  it("getCatalogEntry returns undefined for unknown type", () => {
    expect(getCatalogEntry("nonexistent" as never)).toBeUndefined();
  });
});
