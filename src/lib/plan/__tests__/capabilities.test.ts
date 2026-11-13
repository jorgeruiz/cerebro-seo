import { describe, it, expect } from "vitest";
import { resolveStepsWithCapabilities, hasCapability } from "../capabilities";

describe("resolveStepsWithCapabilities (G5 fallback)", () => {
  const steps = [
    { kind: "seo", title: "Generar meta tags", type: "AI" as const, requiredCapability: "seo_write",
      fallback: { kind: "wp_manual", title: "Aplicar metas en Yoast", type: "HM" as const, humanReason: "Plugin sin capability." } },
    { kind: "review", title: "Revisar", type: "HM" as const },
  ];

  it("uses primary step when capability is present", () => {
    const resolved = resolveStepsWithCapabilities(steps, ["GET /seo/{id}", "POST /seo/{id}"]);
    expect(resolved[0].type).toBe("AI");
    expect((resolved[0] as { kind: string }).kind).toBe("seo");
  });

  it("uses fallback when capability is absent", () => {
    const resolved = resolveStepsWithCapabilities(steps, ["GET /pages"]);
    expect(resolved[0].type).toBe("HM");
    expect((resolved[0] as { kind: string }).kind).toBe("wp_manual");
  });

  it("uses fallback for all capability-dependent steps when capabilities is null", () => {
    const resolved = resolveStepsWithCapabilities(steps, null);
    expect(resolved[0].type).toBe("HM");
    expect((resolved[0] as { kind: string }).kind).toBe("wp_manual");
  });

  it("keeps non-capability steps unchanged regardless of capabilities", () => {
    const resolved = resolveStepsWithCapabilities(steps, null);
    expect(resolved[1].type).toBe("HM");
    expect((resolved[1] as { kind: string }).kind).toBe("review");
  });
});

describe("hasCapability", () => {
  it("matches seo_write to POST /seo/{id}", () => {
    expect(hasCapability("seo_write", ["POST /seo/{id}"])).toBe(true);
  });

  it("matches publish to POST /publish", () => {
    expect(hasCapability("publish", ["POST /publish", "GET /pages"])).toBe(true);
  });

  it("matches media to POST /media", () => {
    expect(hasCapability("media", ["POST /media"])).toBe(true);
  });

  it("returns false for unknown capability", () => {
    expect(hasCapability("unknown_cap", ["POST /seo/{id}"])).toBe(false);
  });

  it("'seo' as catalog capability is not a direct key (use seo_write)", () => {
    // 'seo' is a pluginName of seo_write, not a catalog key
    expect(hasCapability("seo", ["POST /seo/{id}"])).toBe(false);
    // The correct catalog key is seo_write
    expect(hasCapability("seo_write", ["seo"])).toBe(true);
  });
});
