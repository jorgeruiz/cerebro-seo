import { describe, it, expect } from "vitest";
import {
  validateCandidates,
  generateSetupCandidates,
  enforceModeRules,
  analysisResultSchema,
} from "../analysis-candidates";

describe("analysis-candidates", () => {
  describe("validateCandidates", () => {
    it("validates a correct candidate", () => {
      const { valid, dropped } = validateCandidates([{
        titulo: "Optimizar meta description de /servicios",
        descripcion: "La description actual tiene 180 chars, excede el límite de 155.",
        kind: "CODE",
        mode: "AI",
        modeReason: "Cambio de texto en metadata, totalmente automatizable.",
        priority: 2,
        effort: "LOW",
        impactoEsperado: "Mejorar CTR de la página de servicios",
        justificacion: "GSC muestra CTR de 1.2% con 500 impresiones/mes",
        keywordObjetivo: "servicios industriales",
        urlObjetivo: "/servicios",
        fuente: "signal",
      }]);
      expect(valid).toHaveLength(1);
      expect(dropped).toBe(0);
      expect(valid[0].id).toBeTruthy(); // UUID assigned
      expect(valid[0].kind).toBe("CODE");
    });

    it("drops candidate with invalid kind", () => {
      const { valid, dropped } = validateCandidates([{
        titulo: "Test",
        descripcion: "Test description here",
        kind: "INVALID",
        mode: "AI",
        modeReason: "test reason here",
        priority: 1,
        effort: "LOW",
        impactoEsperado: "test impact",
        justificacion: "test justification",
        fuente: "signal",
      }]);
      expect(valid).toHaveLength(0);
      expect(dropped).toBe(1);
    });

    it("drops candidate with missing required fields", () => {
      const { valid, dropped } = validateCandidates([{
        titulo: "Test",
        // missing descripcion, kind, mode, etc.
      }]);
      expect(valid).toHaveLength(0);
      expect(dropped).toBe(1);
    });

    it("keeps valid candidates when one is invalid", () => {
      const { valid, dropped } = validateCandidates([
        {
          titulo: "Valid candidate",
          descripcion: "This is a valid description",
          kind: "CONTENT",
          mode: "HYBRID",
          modeReason: "Needs human review for images",
          priority: 3,
          effort: "MEDIUM",
          impactoEsperado: "New traffic from blog",
          justificacion: "Keyword gap detected",
          fuente: "contentplan",
        },
        { titulo: "bad" }, // invalid
      ]);
      expect(valid).toHaveLength(1);
      expect(dropped).toBe(1);
      expect(valid[0].titulo).toBe("Valid candidate");
    });

    it("handles empty array", () => {
      const { valid, dropped } = validateCandidates([]);
      expect(valid).toHaveLength(0);
      expect(dropped).toBe(0);
    });

    it("validates all fuente values", () => {
      const sources = ["signal", "contentplan", "analisis", "setup", "pendiente-anterior"] as const;
      for (const fuente of sources) {
        const { valid } = validateCandidates([{
          titulo: `Test ${fuente}`,
          descripcion: "Description for testing",
          kind: "CODE",
          mode: "AI",
          modeReason: "Automated change",
          priority: 1,
          effort: "LOW",
          impactoEsperado: "Mejorar posicionamiento",
          justificacion: "Test justification data",
          fuente,
        }]);
        expect(valid).toHaveLength(1);
      }
    });
  });

  describe("generateSetupCandidates", () => {
    it("generates no candidates when all preconditions met", () => {
      const candidates = generateSetupCandidates({
        hasKeywords: true,
        hasCompetitors: true,
        hasGsc: true,
        hasSiteAudit: true,
        keywordCount: 10,
        competitorCount: 3,
      });
      expect(candidates).toHaveLength(0);
    });

    it("generates keyword setup when no keywords", () => {
      const candidates = generateSetupCandidates({
        hasKeywords: false,
        hasCompetitors: true,
        hasGsc: true,
        hasSiteAudit: true,
        keywordCount: 0,
        competitorCount: 3,
      });
      expect(candidates).toHaveLength(1);
      expect(candidates[0].fuente).toBe("setup");
      expect(candidates[0].mode).toBe("HUMAN");
      expect(candidates[0].titulo).toContain("keyword");
    });

    it("generates all setup candidates when nothing configured", () => {
      const candidates = generateSetupCandidates({
        hasKeywords: false,
        hasCompetitors: false,
        hasGsc: false,
        hasSiteAudit: false,
        keywordCount: 0,
        competitorCount: 0,
      });
      expect(candidates).toHaveLength(3); // keywords, competitors, GSC (not audit because hasKeywords=false)
      expect(candidates.every((c) => c.fuente === "setup")).toBe(true);
      expect(candidates.every((c) => c.mode === "HUMAN")).toBe(true);
    });

    it("generates audit setup when keywords exist but no audit", () => {
      const candidates = generateSetupCandidates({
        hasKeywords: true,
        hasCompetitors: true,
        hasGsc: true,
        hasSiteAudit: false,
        keywordCount: 5,
        competitorCount: 2,
      });
      expect(candidates).toHaveLength(1);
      expect(candidates[0].titulo).toContain("audit");
    });
  });

  describe("enforceModeRules", () => {
    it("forces performance tasks to HYBRID", () => {
      // enforceModeRules imported at top
      const candidate = {
        id: "test", titulo: "Reducir TBT de 1,270ms a 200ms", descripcion: "Bundle optimization and lazy loading",
        kind: "CODE" as const, mode: "AI" as const, modeReason: "Code change", priority: 1, effort: "HIGH" as const,
        impactoEsperado: "Better CWV", justificacion: "TBT too high", fuente: "signal" as const,
      };
      const result = enforceModeRules(candidate);
      expect(result.mode).toBe("HYBRID");
      expect(result.modeReason).toContain("Lighthouse");
    });

    it("does not change AI mode for non-performance tasks", () => {
      // enforceModeRules imported at top
      const candidate = {
        id: "test", titulo: "Agregar meta description a /servicios", descripcion: "Update metadata",
        kind: "CODE" as const, mode: "AI" as const, modeReason: "Simple text change", priority: 2, effort: "LOW" as const,
        impactoEsperado: "Better CTR", justificacion: "Missing description", fuente: "signal" as const,
      };
      const result = enforceModeRules(candidate);
      expect(result.mode).toBe("AI");
    });
  });

  describe("analysisResultSchema", () => {
    function makeCandidate(i: number, kind: "CONTENT" | "CODE") {
      return {
        titulo: `Candidata ${kind} ${i}`,
        descripcion: `Description for ${kind} candidate ${i}`,
        kind,
        mode: kind === "CONTENT" ? "HYBRID" : "AI",
        modeReason: "Test mode reason here",
        priority: i,
        effort: "MEDIUM",
        impactoEsperado: "Expected impact description",
        justificacion: "Test justification data",
        fuente: "analisis",
      };
    }

    it("validates a complete result with 8+ candidatas", () => {
      const candidatas = [
        ...Array.from({ length: 4 }, (_, i) => makeCandidate(i + 1, "CONTENT")),
        ...Array.from({ length: 4 }, (_, i) => makeCandidate(i + 1, "CODE")),
      ];
      const result = analysisResultSchema.safeParse({
        resumenEjecutivo: "Resumen del análisis SEO del cliente",
        oportunidades: [{ titulo: "Opp 1", descripcion: "desc", accion: "action", impacto: "alto" }],
        riesgos: [{ titulo: "Risk 1", descripcion: "desc", urgencia: "alta" }],
        recomendaciones: ["Rec 1"],
        conclusionEstrategica: "Conclusión estratégica del análisis",
        candidatas,
      });
      expect(result.success).toBe(true);
    });

    it("fails with less than 8 candidatas", () => {
      const result = analysisResultSchema.safeParse({
        resumenEjecutivo: "Resumen",
        oportunidades: [],
        riesgos: [],
        recomendaciones: [],
        conclusionEstrategica: "Conclusion",
        candidatas: [makeCandidate(1, "CODE")],
      });
      expect(result.success).toBe(false);
    });

    it("fails when candidatas have invalid mode", () => {
      const result = analysisResultSchema.safeParse({
        resumenEjecutivo: "Resumen",
        oportunidades: [],
        riesgos: [],
        recomendaciones: [],
        conclusionEstrategica: "Conclusion",
        candidatas: [{ titulo: "X", descripcion: "Y", kind: "CODE", mode: "INVALID", modeReason: "R", priority: 1, effort: "LOW", impactoEsperado: "I", justificacion: "J", fuente: "signal" }],
      });
      expect(result.success).toBe(false);
    });
  });
});
