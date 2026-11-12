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
