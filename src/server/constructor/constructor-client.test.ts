import { describe, it, expect } from "vitest";
import {
  mapKindToChangeType,
  mapKindToSection,
  isHumanTask,
} from "./constructor-client";

describe("constructor-client mappers", () => {
  describe("mapKindToChangeType", () => {
    it("maps meta → text_update", () => {
      expect(mapKindToChangeType("meta")).toBe("text_update");
    });

    it("maps contenido-blog → add_articulo", () => {
      expect(mapKindToChangeType("contenido-blog")).toBe("add_articulo");
    });

    it("maps contenido-landing → add_page", () => {
      expect(mapKindToChangeType("contenido-landing")).toBe("add_page");
    });

    it("maps contenido-optimizar → text_update", () => {
      expect(mapKindToChangeType("contenido-optimizar")).toBe("text_update");
    });

    it("maps schema → code_change", () => {
      expect(mapKindToChangeType("schema")).toBe("code_change");
    });

    it("maps tecnico → code_change", () => {
      expect(mapKindToChangeType("tecnico")).toBe("code_change");
    });

    it("maps interlinking → code_change", () => {
      expect(mapKindToChangeType("interlinking")).toBe("code_change");
    });

    it("maps setup → null (HUMAN_TASK)", () => {
      expect(mapKindToChangeType("setup")).toBeNull();
    });

    it("maps otro → null (HUMAN_TASK)", () => {
      expect(mapKindToChangeType("otro")).toBeNull();
    });

    it("maps unknown kind → null", () => {
      expect(mapKindToChangeType("unknown")).toBeNull();
    });
  });

  describe("mapKindToSection", () => {
    it("maps meta → Meta tags", () => {
      expect(mapKindToSection("meta")).toBe("Meta tags");
    });

    it("maps schema → Structured Data", () => {
      expect(mapKindToSection("schema")).toBe("Structured Data");
    });

    it("maps interlinking → Internal Links", () => {
      expect(mapKindToSection("interlinking")).toBe("Internal Links");
    });

    it("maps unknown kind → General", () => {
      expect(mapKindToSection("tecnico")).toBe("General");
    });
  });

  describe("isHumanTask", () => {
    it("returns true for setup", () => {
      expect(isHumanTask("setup")).toBe(true);
    });

    it("returns true for otro", () => {
      expect(isHumanTask("otro")).toBe(true);
    });

    it("returns false for meta", () => {
      expect(isHumanTask("meta")).toBe(false);
    });

    it("returns false for contenido-blog", () => {
      expect(isHumanTask("contenido-blog")).toBe(false);
    });

    it("returns true for unknown kind", () => {
      expect(isHumanTask("unknown")).toBe(true);
    });
  });
});
