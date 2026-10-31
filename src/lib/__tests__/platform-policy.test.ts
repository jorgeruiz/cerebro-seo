import { describe, it, expect } from "vitest";
import { getPlatformPolicy, isWordPressPlatform } from "../platform-policy";

describe("getPlatformPolicy", () => {
  describe("NEXTJS — must match existing behavior exactly", () => {
    const p = getPlatformPolicy("NEXTJS");

    it("is executable", () => expect(p.executable).toBe(true));
    it("needs repo", () => expect(p.needsRepo).toBe(true));
    it("closes via merge", () => expect(p.closeFlow).toBe("merge"));
    it("uses terminal", () => expect(p.usesTerminal).toBe(true));
    it("has no ineligibility", () => expect(p.ineligibilityReason).toBeNull());
    it("allows terminal humanReason", () => expect(p.humanReasons).toContain("terminal"));
    it("allows config humanReason", () => expect(p.humanReasons).toContain("config"));
    it("allows external_tool humanReason", () => expect(p.humanReasons).toContain("external_tool"));
    it("does NOT allow wp_manual", () => expect(p.humanReasons).not.toContain("wp_manual"));
    it("kind CODE = Código", () => expect(p.kindLabels.CODE).toBe("Código"));
    it("kind CONTENT = Contenido", () => expect(p.kindLabels.CONTENT).toBe("Contenido"));
  });

  describe("WORDPRESS", () => {
    const p = getPlatformPolicy("WORDPRESS");

    it("is executable", () => expect(p.executable).toBe(true));
    it("does NOT need repo", () => expect(p.needsRepo).toBe(false));
    it("closes via wp_publish", () => expect(p.closeFlow).toBe("wp_publish"));
    it("does NOT use terminal", () => expect(p.usesTerminal).toBe(false));
    it("has no ineligibility", () => expect(p.ineligibilityReason).toBeNull());
    it("allows wp_manual", () => expect(p.humanReasons).toContain("wp_manual"));
    it("does NOT allow terminal", () => expect(p.humanReasons).not.toContain("terminal"));
    it("kind CODE = Plugin", () => expect(p.kindLabels.CODE).toBe("Plugin"));
    it("kind CONTENT = Contenido", () => expect(p.kindLabels.CONTENT).toBe("Contenido"));
    it("kind SETUP = Manual", () => expect(p.kindLabels.SETUP).toBe("Manual"));
  });

  describe("MIGRACION", () => {
    const p = getPlatformPolicy("MIGRACION");

    it("is executable", () => expect(p.executable).toBe(true));
    it("does NOT need repo", () => expect(p.needsRepo).toBe(false));
    it("closes via wp_publish", () => expect(p.closeFlow).toBe("wp_publish"));
    it("has ineligibility note", () => expect(p.ineligibilityReason).toContain("migración"));
  });

  describe("OTRO", () => {
    const p = getPlatformPolicy("OTRO");

    it("is NOT executable", () => expect(p.executable).toBe(false));
    it("closeFlow is null", () => expect(p.closeFlow).toBeNull());
    it("has ineligibility", () => expect(p.ineligibilityReason).toContain("no reconocida"));
  });

  describe("null (undetected)", () => {
    const p = getPlatformPolicy(null);

    it("is NOT executable", () => expect(p.executable).toBe(false));
    it("has ineligibility", () => expect(p.ineligibilityReason).toContain("no detectada"));
    it("no humanReasons", () => expect(p.humanReasons.length).toBe(0));
  });
});

describe("isWordPressPlatform", () => {
  it("WORDPRESS → true", () => expect(isWordPressPlatform("WORDPRESS")).toBe(true));
  it("MIGRACION → true", () => expect(isWordPressPlatform("MIGRACION")).toBe(true));
  it("NEXTJS → false", () => expect(isWordPressPlatform("NEXTJS")).toBe(false));
  it("null → false", () => expect(isWordPressPlatform(null)).toBe(false));
});
