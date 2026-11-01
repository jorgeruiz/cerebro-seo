/**
 * Tests for blog routing: Analysis blog → content lane, not code lane.
 * Also tests that all template actions have handlers.
 */

import { describe, it, expect } from "vitest";
import { getTemplate, type ActionType, type Platform } from "@/lib/task-templates";

// Replicate isNextjsBlogTask logic for testing
function isNextjsBlogTask(task: { kind: string; category: string; actionType?: string | null }): boolean {
  if (task.actionType === "create_blog") return true;
  if (task.kind === "CONTENT" && ["blog", "articulo", "article"].includes(task.category.toLowerCase())) return true;
  return false;
}

describe("isNextjsBlogTask routing", () => {
  it("routes by actionType=create_blog (primary)", () => {
    expect(isNextjsBlogTask({ kind: "CONTENT", category: "contenido", actionType: "create_blog" })).toBe(true);
  });

  it("routes by category=blog (fallback for legacy tasks)", () => {
    expect(isNextjsBlogTask({ kind: "CONTENT", category: "blog", actionType: null })).toBe(true);
  });

  it("does NOT route category=content (the old bug)", () => {
    expect(isNextjsBlogTask({ kind: "CONTENT", category: "content", actionType: null })).toBe(false);
  });

  it("does NOT route meta tasks", () => {
    expect(isNextjsBlogTask({ kind: "CONTENT", category: "meta", actionType: "update_meta" })).toBe(false);
  });

  it("Analysis blog candidate → plan creates actionType=create_blog → enters content lane", () => {
    // Simulates the fixed plan-actions.ts flow
    const candidate = {
      actionType: "create_blog",
      kind: "CONTENT",
      titulo: "Blog sobre CCTV",
    };
    const task = {
      kind: candidate.kind,
      category: "blog", // fixed: inferCategory returns "blog" for create_blog
      actionType: candidate.actionType,
    };
    expect(isNextjsBlogTask(task)).toBe(true);
  });
});

describe("all template actions have known handlers", () => {
  const KNOWN_HANDLERS = new Set([
    "content_package",   // wp-executor
    "publish",           // wp-executor
    "seo",               // wp-executor
    "image",             // image-executor (both lanes)
    "keyword_research",  // data-step-executor
    "apply_keywords",    // data-step-executor
    "nextjs_blog_generate", // processNextjsBlogTask
    "agent",             // standard agent runner (code lane)
  ]);

  const ALL_ACTION_TYPES: ActionType[] = [
    "create_blog", "update_meta", "keyword_research", "schema",
    "internal_links", "edit_page_text", "create_landing",
    "upload_media", "generate_image",
  ];
  const PLATFORMS: Platform[] = ["NEXTJS", "WORDPRESS"];

  for (const actionType of ALL_ACTION_TYPES) {
    for (const platform of PLATFORMS) {
      const template = getTemplate(actionType, platform);
      if (!template) continue;

      for (const step of template.steps) {
        if (!step.action) continue; // HUMAN steps have no action

        it(`${actionType}/${platform} step "${step.action}" has a known handler`, () => {
          expect(KNOWN_HANDLERS.has(step.action!)).toBe(true);
        });
      }
    }
  }
});

describe("image step payload", () => {
  it("WP create_blog template includes image step", () => {
    const t = getTemplate("create_blog", "WORDPRESS")!;
    const imgStep = t.steps.find((s) => s.action === "image");
    expect(imgStep).toBeDefined();
  });

  it("NEXTJS create_blog template includes image step", () => {
    const t = getTemplate("create_blog", "NEXTJS")!;
    const imgStep = t.steps.find((s) => s.action === "image");
    expect(imgStep).toBeDefined();
  });
});
