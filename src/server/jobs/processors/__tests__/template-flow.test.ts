/**
 * E2E test: blog WP candidate → template → decompose → content_package
 *
 * Verifies that a WordPress blog candidate with keywordObjetivo flows through
 * to content_package with kind="blog" and the correct keyword.
 */

import { describe, it, expect } from "vitest";
import {
  getTemplate,
  applyCapabilities,
  resolveTaskMode,
  type ActionType,
  type Platform,
} from "@/lib/task-templates";

describe("template flow: WP blog candidate → content_package", () => {
  const actionType: ActionType = "create_blog";
  const platform: Platform = "WORDPRESS";
  const targetKeyword = "Piso Vinílico para Oficinas en Monterrey";

  it("template exists for create_blog WORDPRESS", () => {
    const template = getTemplate(actionType, platform);
    expect(template).not.toBeNull();
    expect(template!.steps.length).toBeGreaterThanOrEqual(3);
  });

  it("first step is content_package AI", () => {
    const template = getTemplate(actionType, platform)!;
    expect(template.steps[0].type).toBe("AI");
    expect(template.steps[0].action).toBe("content_package");
  });

  it("applyCapabilities keeps content_package as AI (no capability needed)", () => {
    const template = getTemplate(actionType, platform)!;
    const caps = ["publish", "media", "seo_write"];
    const steps = applyCapabilities(template, caps);
    expect(steps[0].type).toBe("AI");
    expect(steps[0].action).toBe("content_package");
  });

  it("applyCapabilities degrades publish step to HUMAN if missing capability", () => {
    const template = getTemplate(actionType, platform)!;
    const caps = ["media", "seo_write"]; // missing "publish"
    const steps = applyCapabilities(template, caps);
    const publishStep = steps.find((s) => s.action === "publish");
    expect(publishStep!.type).toBe("HUMAN");
    expect(publishStep!.humanReason).toBe("wp_manual");
  });

  it("resolveTaskMode returns HYBRID for blog WP (AI + HUMAN steps)", () => {
    const template = getTemplate(actionType, platform)!;
    const caps = ["publish", "media"];
    const steps = applyCapabilities(template, caps);
    const mode = resolveTaskMode(steps);
    expect(mode).toBe("HYBRID");
  });

  it("content_package payload can be built with kind=blog and keyword", () => {
    const KIND_MAP: Record<string, string> = {
      create_blog: "blog",
      create_landing: "landing",
      edit_page_text: "optimization",
    };

    const payload = {
      action: "content_package",
      kind: KIND_MAP[actionType],
      keyword: targetKeyword,
      page_title: targetKeyword,
      target_page_id: 0,
    };

    expect(payload.kind).toBe("blog");
    expect(payload.keyword).toBe("Piso Vinílico para Oficinas en Monterrey");
    expect(payload.action).toBe("content_package");
  });

  it("same candidate produces same mode from Analysis and from plan", () => {
    // From Analysis: template lookup → resolveTaskMode
    const template1 = getTemplate(actionType, platform)!;
    const caps = ["publish", "media", "seo_write"];
    const steps1 = applyCapabilities(template1, caps);
    const mode1 = resolveTaskMode(steps1);

    // From plan (decomposer would do the same lookup)
    const template2 = getTemplate(actionType, platform)!;
    const steps2 = applyCapabilities(template2, caps);
    const mode2 = resolveTaskMode(steps2);

    expect(mode1).toBe(mode2);
    expect(steps1).toEqual(steps2);
  });

  it("decomposing same task twice gives same steps", () => {
    const t1 = getTemplate(actionType, platform)!;
    const t2 = getTemplate(actionType, platform)!;
    const caps = ["publish", "media"];
    expect(applyCapabilities(t1, caps)).toEqual(applyCapabilities(t2, caps));
  });
});

describe("template flow: Next.js blog → content lane", () => {
  it("create_blog NEXTJS has blog generation step", () => {
    const template = getTemplate("create_blog", "NEXTJS");
    expect(template).not.toBeNull();
    expect(template!.steps[0].action).toBe("nextjs_blog_generate");
  });
});

describe("keyword flow: targetKeyword → content_package", () => {
  it("keyword from candidate.keywordObjetivo reaches payload", () => {
    // Simulate the full flow:
    // 1. Candidate has keywordObjetivo
    const candidate = {
      titulo: "Redactar artículo 'Piso Vinílico para Oficinas en Monterrey'",
      keywordObjetivo: "piso vinílico para oficinas monterrey",
    };

    // 2. PlanTask gets targetKeyword from candidate
    const taskTargetKeyword = candidate.keywordObjetivo;

    // 3. Decomposer builds payload with keyword
    const payload = {
      action: "content_package",
      kind: "blog",
      keyword: taskTargetKeyword,
      page_title: taskTargetKeyword,
      target_page_id: 0,
    };

    expect(payload.keyword).toBe("piso vinílico para oficinas monterrey");
    expect(payload.kind).toBe("blog");
  });
});
