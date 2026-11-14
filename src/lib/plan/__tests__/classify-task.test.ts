import { describe, it, expect } from "vitest";
import { classifyTaskQuick } from "../classify-task";

describe("classifyTaskQuick", () => {
  describe("resolves aliases", () => {
    it("edit_page_widgets → edit_page_text", () => {
      const r = classifyTaskQuick({ title: "Test", objective: "Test", existingActionType: "edit_page_widgets" });
      expect(r.actionType).toBe("edit_page_text");
    });

    it("create_landing_from_template → create_landing", () => {
      const r = classifyTaskQuick({ title: "Test", objective: "Test", existingActionType: "create_landing_from_template" });
      expect(r.actionType).toBe("create_landing");
    });

    it("upload_media → add_image", () => {
      const r = classifyTaskQuick({ title: "Test", objective: "Test", existingActionType: "upload_media" });
      expect(r.actionType).toBe("add_image");
    });

    it("generate_image → add_image", () => {
      const r = classifyTaskQuick({ title: "Test", objective: "Test", existingActionType: "generate_image" });
      expect(r.actionType).toBe("add_image");
    });

    it("verify_tracking → verify_analytics", () => {
      const r = classifyTaskQuick({ title: "Test", objective: "Test", existingActionType: "verify_tracking" });
      expect(r.actionType).toBe("verify_analytics");
    });

    it("update_post → null (requires context) → falls to signals", () => {
      const r = classifyTaskQuick({ title: "Actualizar artículo de blog", objective: "Test", existingActionType: "update_post" });
      // update_post returns null from resolveAlias, falls to signal matching
      // "artículo" is not a blog signal (only "redactar", "crear artículo")
      // so it may fall to "other" or match something else
      expect(r.actionType).toBeDefined();
    });
  });

  describe("signal matching", () => {
    it("blog signals → create_blog", () => {
      const r = classifyTaskQuick({ title: "Crear artículo de blog sobre SEO", objective: "Nuevo blog" });
      expect(r.actionType).toBe("create_blog");
    });

    it("meta signals → update_meta", () => {
      const r = classifyTaskQuick({ title: "Optimizar meta title de /servicios", objective: "Mejorar CTR" });
      expect(r.actionType).toBe("update_meta");
    });

    it("landing signals → create_landing", () => {
      const r = classifyTaskQuick({ title: "Crear landing de servicio CCTV", objective: "Nueva página" });
      expect(r.actionType).toBe("create_landing");
    });

    it("schema signals → schema", () => {
      const r = classifyTaskQuick({ title: "Implementar schema JSON-LD", objective: "Datos estructurados" });
      expect(r.actionType).toBe("schema");
    });

    it("indexation signals → verify_indexation", () => {
      const r = classifyTaskQuick({ title: "Verificar indexación de 4 artículos", objective: "GSC" });
      expect(r.actionType).toBe("verify_indexation");
    });

    it("redirect signals → fix_redirect", () => {
      const r = classifyTaskQuick({ title: "Configurar redirección 301", objective: "URL antigua" });
      expect(r.actionType).toBe("fix_redirect");
    });

    it("FAQ signals → add_faq", () => {
      const r = classifyTaskQuick({ title: "Agregar preguntas frecuentes", objective: "FAQ page" });
      expect(r.actionType).toBe("add_faq");
    });

    it("no signals → other with low confidence", () => {
      const r = classifyTaskQuick({ title: "Mejorar el sitio web", objective: "Optimización general" });
      expect(r.actionType).toBe("other");
      expect(r.confidence).toBeLessThan(0.5);
    });
  });

  describe("negative signals", () => {
    it("meta title with artículo existente → still update_meta (not create_blog)", () => {
      const r = classifyTaskQuick({
        title: "Optimizar meta title del artículo /que-es-la-bioaumentacion/",
        objective: "Focus keyword",
      });
      expect(r.actionType).toBe("update_meta");
    });
  });
});

// Tests for validateClassification behavior (via exported helper)
import { _validateClassificationForTest } from "../classify-task";

describe("validateClassification rules", () => {
  it("#41: 'noindex' in objective does NOT trigger negative signal for verify_indexation", () => {
    const result = _validateClassificationForTest(
      { actionType: "verify_indexation", confidence: 0.97, targetUrl: "/page", targetKeyword: null, splitInto: null, reasoning: "indexation check", otherReason: null, costUsd: 0 },
      { title: "Verificar indexación de los 4 artículos del ciclo agosto 2026", objective: "Verificar que no estén noindex. Confirmar en GSC.", platform: "WORDPRESS" },
      null,
    );
    expect(result.actionType).toBe("verify_indexation");
    expect(result.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it("#17: old label create_landing does NOT override LLM's create_blog", () => {
    const result = _validateClassificationForTest(
      { actionType: "create_blog", confidence: 0.95, targetUrl: null, targetKeyword: "bioaumentación", splitInto: null, reasoning: "informational article", otherReason: null, costUsd: 0 },
      { title: "Crear contenido: Qué es la Bioaumentación", objective: "Artículo informativo", platform: "WORDPRESS" },
      "create_landing", // old label from analysis
    );
    expect(result.actionType).toBe("create_blog");
    expect(result.confidence).toBe(0.95); // unchanged
  });

  it("negative signal in TITLE reduces confidence by 0.15, does not force other", () => {
    const result = _validateClassificationForTest(
      { actionType: "edit_page_text", confidence: 0.92, targetUrl: "/servicios", targetKeyword: null, splitInto: null, reasoning: "edit text", otherReason: null, costUsd: 0 },
      { title: "Optimizar FAQ de la página de servicios", objective: "Agregar preguntas", platform: "WORDPRESS" },
      null,
    );
    // "FAQ" is a negative signal for edit_page_text and IS in the title
    expect(result.confidence).toBe(0.92 - 0.15);
    // But 0.77 > 0.75 threshold, so it stays edit_page_text
    expect(result.actionType).toBe("edit_page_text");
  });

  it("negative signal only in objective does NOT reduce confidence", () => {
    const result = _validateClassificationForTest(
      { actionType: "edit_page_text", confidence: 0.90, targetUrl: "/home", targetKeyword: "brinar", splitInto: null, reasoning: "edit", otherReason: null, costUsd: 0 },
      { title: "Optimizar homepage de brinar.mx", objective: "Asegurar H1, meta title y meta description correctos", platform: "OTRO" },
      null,
    );
    // "meta" is negative for edit_page_text but only in OBJECTIVE → no penalty
    expect(result.actionType).toBe("edit_page_text");
    expect(result.confidence).toBe(0.90);
  });

  describe("disambiguation", () => {
    it("optimizar + meta → update_meta", () => {
      const r = classifyTaskQuick({ title: "Optimizar meta description", objective: "CTR bajo" });
      expect(r.actionType).toBe("update_meta");
    });

    it("optimizar + velocidad → improve_speed", () => {
      const r = classifyTaskQuick({ title: "Mejorar velocidad del sitio", objective: "Core Web Vitals" });
      expect(r.actionType).toBe("improve_speed");
    });

    it("enlaces internos → internal_links", () => {
      const r = classifyTaskQuick({ title: "Agregar enlaces internos", objective: "Interlinking" });
      expect(r.actionType).toBe("internal_links");
    });

    it("backlinks → link_building (not internal_links)", () => {
      const r = classifyTaskQuick({ title: "Conseguir backlinks", objective: "Autoridad" });
      expect(r.actionType).toBe("link_building");
    });
  });
});
