import { describe, it, expect } from "vitest";
import { buildAeoReport, type AeoProbeResult } from "../aeo-readiness";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeProbeResult(overrides?: Partial<AeoProbeResult>): AeoProbeResult {
  return {
    robotsAiBlocked: { status: "pass", blockedBots: [], detail: "OK" },
    contentSignal: { status: "pass", detail: "OK" },
    llmsTxt: { status: "pass", detail: "OK" },
    llmsFullTxt: { status: "pass", detail: "OK" },
    mdRoute: { status: "pass", detail: "OK" },
    contentNegotiation: { status: "pass", detail: "OK" },
    linkHeader: { status: "pass", detail: "OK" },
    linkTag: { status: "pass", detail: "OK" },
    ssrContent: { status: "pass", wordCount: 500, scriptCount: 2, detail: "OK" },
    sitemap: { status: "pass", detail: "OK" },
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildAeoReport", () => {
  it("todos pass → score 100", () => {
    const report = buildAeoReport(makeProbeResult());
    expect(report.score).toBe(100);
    expect(report.checks).toHaveLength(10);
    expect(report.checks.every((c) => c.status === "pass")).toBe(true);
  });

  it("todos fail → score 0", () => {
    const allFail = makeProbeResult({
      robotsAiBlocked: { status: "fail", blockedBots: ["GPTBot"], detail: "blocked" },
      contentSignal: { status: "fail", detail: "no" },
      llmsTxt: { status: "fail", detail: "no" },
      llmsFullTxt: { status: "fail", detail: "no" },
      mdRoute: { status: "fail", detail: "no" },
      contentNegotiation: { status: "fail", detail: "no" },
      linkHeader: { status: "fail", detail: "no" },
      linkTag: { status: "fail", detail: "no" },
      ssrContent: { status: "fail", wordCount: 50, scriptCount: 10, detail: "client-side" },
      sitemap: { status: "fail", detail: "no" },
    });
    const report = buildAeoReport(allFail);
    expect(report.score).toBe(0);
  });

  it("skipped checks salen del denominador", () => {
    // All pass except 2 skipped
    const partial = makeProbeResult({
      llmsFullTxt: { status: "skipped", detail: "skip" },
      linkHeader: { status: "skipped", detail: "skip" },
    });
    const report = buildAeoReport(partial);
    // 8 checks pass out of 8 counted (2 skipped) → 100
    expect(report.score).toBe(100);
  });

  it("mezcla pass/fail/warn/skipped → score intermedio correcto", () => {
    const mixed = makeProbeResult({
      // robots_ai_blocked: fail (weight 2) = 0
      robotsAiBlocked: { status: "fail", blockedBots: ["GPTBot"], detail: "blocked" },
      // ssr_content: warn (weight 2) = 1
      ssrContent: { status: "warn", wordCount: 150, scriptCount: 1, detail: "poco" },
      // content_signal: skipped (weight 1) = excluded
      contentSignal: { status: "skipped", detail: "skip" },
      // llms_txt: pass (weight 1) = 1
      // llms_full_txt: pass (weight 1) = 1
      // md_route: fail (weight 1) = 0
      mdRoute: { status: "fail", detail: "no" },
      // content_negotiation: pass (weight 1) = 1
      // link_header: pass (weight 1) = 1
      // link_tag: pass (weight 1) = 1
      // sitemap: pass (weight 1) = 1
    });
    const report = buildAeoReport(mixed);
    // Total weights (excluding skipped): 2+2+1+1+1+1+1+1+1 = 11
    // Earned: 0 + 1 + 1+1 + 0 + 1+1+1+1 = 7
    // Score: round(7/11 * 100) = 64
    expect(report.score).toBe(64);
  });

  it("warn cuenta como medio peso", () => {
    // Only one check, all others skipped to isolate
    const singleWarn = makeProbeResult({
      robotsAiBlocked: { status: "skipped", blockedBots: [], detail: "skip" },
      contentSignal: { status: "skipped", detail: "skip" },
      llmsTxt: { status: "skipped", detail: "skip" },
      llmsFullTxt: { status: "skipped", detail: "skip" },
      mdRoute: { status: "skipped", detail: "skip" },
      contentNegotiation: { status: "skipped", detail: "skip" },
      linkHeader: { status: "skipped", detail: "skip" },
      linkTag: { status: "skipped", detail: "skip" },
      ssrContent: { status: "warn", wordCount: 150, scriptCount: 1, detail: "poco" },
      sitemap: { status: "skipped", detail: "skip" },
    });
    const report = buildAeoReport(singleWarn);
    // ssr_content weight 2, warn = 1 earned, total = 2 → 50
    expect(report.score).toBe(50);
  });

  it("cada check tiene id, title, fix no vacío", () => {
    const report = buildAeoReport(makeProbeResult());
    for (const check of report.checks) {
      expect(check.id).toBeTruthy();
      expect(check.title).toBeTruthy();
      expect(check.fix).toBeTruthy();
      expect(check.detail).toBeTruthy();
    }
  });

  it("robots_ai_blocked fail → severity critical", () => {
    const blocked = makeProbeResult({
      robotsAiBlocked: { status: "fail", blockedBots: ["GPTBot"], detail: "blocked" },
    });
    const report = buildAeoReport(blocked);
    const robotsCheck = report.checks.find((c) => c.id === "robots_ai_blocked");
    expect(robotsCheck?.severity).toBe("critical");
  });

  it("ssr_content fail → severity high", () => {
    const clientSide = makeProbeResult({
      ssrContent: { status: "fail", wordCount: 30, scriptCount: 12, detail: "JS only" },
    });
    const report = buildAeoReport(clientSide);
    const ssrCheck = report.checks.find((c) => c.id === "ssr_content");
    expect(ssrCheck?.severity).toBe("high");
  });

  it("all skipped → score 0 (edge case)", () => {
    const allSkipped = makeProbeResult({
      robotsAiBlocked: { status: "skipped", blockedBots: [], detail: "skip" },
      contentSignal: { status: "skipped", detail: "skip" },
      llmsTxt: { status: "skipped", detail: "skip" },
      llmsFullTxt: { status: "skipped", detail: "skip" },
      mdRoute: { status: "skipped", detail: "skip" },
      contentNegotiation: { status: "skipped", detail: "skip" },
      linkHeader: { status: "skipped", detail: "skip" },
      linkTag: { status: "skipped", detail: "skip" },
      ssrContent: { status: "skipped", wordCount: 0, scriptCount: 0, detail: "skip" },
      sitemap: { status: "skipped", detail: "skip" },
    });
    const report = buildAeoReport(allSkipped);
    expect(report.score).toBe(0);
  });
});
