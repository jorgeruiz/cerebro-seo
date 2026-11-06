import { describe, it, expect } from "vitest";
import { validateTaskCoherence } from "../task-coherence";

describe("validateTaskCoherence", () => {
  describe("actionType vs title", () => {
    it("auto-corrects actionType when title clearly says 'landing' but actionType is keyword_research", () => {
      const result = validateTaskCoherence({
        title: "Crear landing /seguridad-electronica/cctv-monterrey — keyword local de mayor volumen",
        objective: "Crear página de servicio",
        actionType: "keyword_research",
        category: "keyword",
        targetKeyword: "cctv monterrey",
        kind: "CONTENT",
      });

      expect(result.actionType).toBe("create_landing");
      expect(result.category).toBe("landing");
      expect(result.issues.some((i) => i.field === "actionType" && i.autoFixed)).toBe(true);
    });

    it("auto-corrects actionType when title says 'artículo blog' but actionType is create_landing", () => {
      const result = validateTaskCoherence({
        title: "Redactar artículo de blog sobre CCTV empresarial",
        objective: "Blog post informativo",
        actionType: "create_landing",
        category: "landing",
        targetKeyword: "cctv empresarial",
        kind: "CONTENT",
      });

      expect(result.actionType).toBe("create_blog");
      expect(result.category).toBe("blog");
    });

    it("does NOT change actionType when title casually mentions 'keyword' without research intent", () => {
      const result = validateTaskCoherence({
        title: "Crear landing para keyword local CCTV",
        objective: "Crear página",
        actionType: "create_landing",
        category: "landing",
        targetKeyword: "cctv",
        kind: "CONTENT",
      });

      // Should stay create_landing — "keyword" is just context, not the action
      expect(result.actionType).toBe("create_landing");
    });

    it("detects keyword_research when title explicitly says 'investigar keywords'", () => {
      const result = validateTaskCoherence({
        title: "Investigar keywords prioritarias para el sitio",
        objective: "Seleccionar 25 keywords",
        actionType: null,
        category: "contenido",
        targetKeyword: null,
        kind: "CONTENT",
      });

      expect(result.actionType).toBe("keyword_research");
    });
  });

  describe("fills missing actionType", () => {
    it("detects create_blog from title", () => {
      const result = validateTaskCoherence({
        title: "Redactar artículo sobre mantenimiento preventivo",
        objective: "Blog post",
        actionType: null,
        category: "content",
        targetKeyword: null,
        kind: "CONTENT",
      });

      expect(result.actionType).toBe("create_blog");
      expect(result.issues.some((i) => i.field === "actionType" && i.autoFixed)).toBe(true);
    });

    it("detects update_meta from title", () => {
      const result = validateTaskCoherence({
        title: "Optimizar meta title y description de /servicios",
        objective: "Mejorar SEO on-page",
        actionType: null,
        category: "seo",
        targetKeyword: "servicios industriales",
        kind: "CODE",
      });

      expect(result.actionType).toBe("update_meta");
    });
  });

  describe("category correction", () => {
    it("fixes category='content' to match actionType", () => {
      const result = validateTaskCoherence({
        title: "Blog sobre CCTV",
        objective: "Artículo informativo",
        actionType: "create_blog",
        category: "content",
        targetKeyword: "cctv",
        kind: "CONTENT",
      });

      expect(result.category).toBe("blog");
      expect(result.issues.some((i) => i.field === "category" && i.autoFixed)).toBe(true);
    });

    it("fixes category='contenido' to match actionType", () => {
      const result = validateTaskCoherence({
        title: "Landing de servicios",
        objective: "Crear página",
        actionType: "create_landing",
        category: "contenido",
        targetKeyword: "servicios",
        kind: "CONTENT",
      });

      expect(result.category).toBe("landing");
    });
  });

  describe("targetKeyword validation", () => {
    it("warns about long keyword but does not block", () => {
      const result = validateTaskCoherence({
        title: "Blog sobre algo",
        objective: "Artículo",
        actionType: "create_blog",
        category: "blog",
        targetKeyword: "servicios de instalación de sistemas de cámaras de seguridad CCTV para empresas industriales en monterrey",
        kind: "CONTENT",
      });

      expect(result.blocked).toBe(false);
      expect(result.issues.some((i) => i.field === "targetKeyword")).toBe(true);
    });

    it("extracts keyword from quoted title when missing", () => {
      const result = validateTaskCoherence({
        title: "Crear blog 'CCTV para Empresas en Monterrey'",
        objective: "Artículo",
        actionType: "create_blog",
        category: "blog",
        targetKeyword: null,
        kind: "CONTENT",
      });

      expect(result.targetKeyword).toBe("CCTV para Empresas en Monterrey");
      expect(result.issues.some((i) => i.field === "targetKeyword" && i.autoFixed)).toBe(true);
    });
  });

  describe("no issues on clean task", () => {
    it("returns no issues when everything matches", () => {
      const result = validateTaskCoherence({
        title: "Optimizar meta tags de /servicios",
        objective: "Mejorar posicionamiento",
        actionType: "update_meta",
        category: "meta",
        targetKeyword: "servicios industriales",
        kind: "CODE",
      });

      expect(result.issues.length).toBe(0);
      expect(result.blocked).toBe(false);
      expect(result.actionType).toBe("update_meta");
      expect(result.category).toBe("meta");
    });
  });
});
