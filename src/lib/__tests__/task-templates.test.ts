import { describe, it, expect } from "vitest";
import {
  getTemplate,
  applyCapabilities,
  resolveTaskMode,
  buildModeReason,
  DECOMPOSER_VERSION,
} from "../task-templates";

describe("getTemplate", () => {
  it("returns template for create_blog NEXTJS", () => {
    const t = getTemplate("create_blog", "NEXTJS");
    expect(t).not.toBeNull();
    expect(t!.steps.length).toBeGreaterThanOrEqual(2);
    expect(t!.steps[0].type).toBe("AI");
  });

  it("returns template for create_blog WORDPRESS", () => {
    const t = getTemplate("create_blog", "WORDPRESS");
    expect(t).not.toBeNull();
    expect(t!.steps.some((s) => s.action === "content_package")).toBe(true);
    expect(t!.steps.some((s) => s.action === "publish")).toBe(true);
  });

  it("returns template for keyword_research (same for both platforms)", () => {
    const nx = getTemplate("keyword_research", "NEXTJS");
    const wp = getTemplate("keyword_research", "WORDPRESS");
    expect(nx).not.toBeNull();
    expect(wp).not.toBeNull();
    expect(nx!.steps.length).toBe(3);
    expect(wp!.steps.length).toBe(3);
    // AI → HUMAN → AI pattern
    expect(nx!.steps.map((s) => s.type)).toEqual(["AI", "HUMAN", "AI"]);
  });

  it("returns null for unknown actionType", () => {
    expect(getTemplate("other", "NEXTJS")).toBeNull();
  });
});

describe("applyCapabilities", () => {
  it("degrades AI steps to HUMAN when capability is missing", () => {
    const t = getTemplate("create_blog", "WORDPRESS")!;
    // Missing "publish" capability
    const steps = applyCapabilities(t, ["media", "seo_write"]);
    const publishStep = steps.find((s) => s.action === "publish");
    expect(publishStep!.type).toBe("HUMAN");
    expect(publishStep!.humanReason).toBe("wp_manual");
  });

  it("keeps AI steps when all capabilities present", () => {
    const t = getTemplate("create_blog", "WORDPRESS")!;
    const steps = applyCapabilities(t, ["publish", "media", "seo_write", "update"]);
    const publishStep = steps.find((s) => s.action === "publish");
    expect(publishStep!.type).toBe("AI");
  });

  it("handles seo → seo_write compat for plugins < 1.6.0", () => {
    const t = getTemplate("update_meta", "WORDPRESS")!;
    // Old plugin reports "seo" instead of "seo_write"
    const steps = applyCapabilities(t, ["seo"]);
    expect(steps[0].type).toBe("AI"); // should still be executable
  });

  it("returns steps unchanged for NEXTJS (no capability check)", () => {
    const t = getTemplate("update_meta", "NEXTJS")!;
    const steps = applyCapabilities(t, null);
    expect(steps).toEqual(t.steps);
  });

  it("WP action not in capabilities → HUMAN wp_manual", () => {
    const t = getTemplate("update_meta", "WORDPRESS")!;
    // No seo_write capability
    const steps = applyCapabilities(t, ["publish", "media"]);
    expect(steps[0].type).toBe("HUMAN");
    expect(steps[0].humanReason).toBe("wp_manual");
  });
});

describe("resolveTaskMode", () => {
  it("all AI → AI", () => {
    expect(resolveTaskMode([{ type: "AI" }, { type: "AI" }])).toBe("AI");
  });

  it("all HUMAN → HUMAN", () => {
    expect(resolveTaskMode([{ type: "HUMAN" }])).toBe("HUMAN");
  });

  it("mixed → HYBRID", () => {
    expect(resolveTaskMode([{ type: "AI" }, { type: "HUMAN" }, { type: "AI" }])).toBe("HYBRID");
  });

  it("empty → HUMAN", () => {
    expect(resolveTaskMode([])).toBe("HUMAN");
  });
});

describe("buildModeReason", () => {
  it("describes AI-only steps", () => {
    const reason = buildModeReason([{ type: "AI" }, { type: "AI" }]);
    expect(reason).toContain("2 pasos AI");
  });

  it("describes mixed steps with humanReason", () => {
    const reason = buildModeReason([
      { type: "AI" },
      { type: "HUMAN", humanReason: "config" },
      { type: "AI" },
    ]);
    expect(reason).toContain("2 AI");
    expect(reason).toContain("1 manual");
    expect(reason).toContain("config");
  });
});

describe("deterministic templates", () => {
  it("same candidata produces same mode in analysis and plan", () => {
    const t = getTemplate("create_blog", "WORDPRESS")!;
    const caps = ["publish", "media", "seo_write"];
    const steps = applyCapabilities(t, caps);
    const mode = resolveTaskMode(steps);
    // create_blog WP with all caps → HYBRID (has AI + HUMAN review step)
    expect(mode).toBe("HYBRID");

    // Run again — same result
    const steps2 = applyCapabilities(t, caps);
    const mode2 = resolveTaskMode(steps2);
    expect(mode2).toBe(mode);
    expect(steps2).toEqual(steps);
  });

  it("decomposing same task twice gives same steps", () => {
    const t1 = getTemplate("keyword_research", "NEXTJS")!;
    const t2 = getTemplate("keyword_research", "NEXTJS")!;
    expect(t1.steps).toEqual(t2.steps);
  });
});

describe("DECOMPOSER_VERSION", () => {
  it("is a non-empty string", () => {
    expect(DECOMPOSER_VERSION).toBeTruthy();
    expect(typeof DECOMPOSER_VERSION).toBe("string");
  });
});
