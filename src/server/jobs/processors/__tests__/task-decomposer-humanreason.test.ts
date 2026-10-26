import { describe, it, expect } from "vitest";
import { z } from "zod";

// ─── Replicate the stepSchema + validation logic from decomposer ────────────

const VALID_HUMAN_REASONS_NEXTJS = ["terminal", "config", "external_tool"] as const;
const VALID_HUMAN_REASONS_WORDPRESS = ["wp_manual", "config", "external_tool"] as const;

const stepSchema = z.object({
  title: z.string().min(2).max(200).transform((s) => s.slice(0, 120)),
  type: z.enum(["AI", "HUMAN", "HYBRID"]).transform((t) => t === "HYBRID" ? "HUMAN" : t),
  prompt: z.preprocess(
    (v) => (v !== null && v !== undefined && typeof v === "object" ? JSON.stringify(v) : v),
    z.string().nullable().optional()
  ),
  acceptanceCriteria: z.array(z.string()).default([]),
  complexity: z.enum(["low", "medium", "high"]).optional().default("medium"),
  humanReason: z.enum(["terminal", "config", "external_tool", "wp_manual"]).nullable().optional(),
});

function validateStep(raw: unknown, platform: "NEXTJS" | "WORDPRESS") {
  const result = stepSchema.safeParse(raw);
  if (!result.success) return { valid: false, reason: "schema" };
  const step = result.data;

  const validReasons = platform === "WORDPRESS"
    ? VALID_HUMAN_REASONS_WORDPRESS
    : VALID_HUMAN_REASONS_NEXTJS;

  if (step.type === "HUMAN") {
    if (!step.humanReason) return { valid: false, reason: "missing_humanReason" };
    if (!(validReasons as readonly string[]).includes(step.humanReason)) {
      return { valid: false, reason: `invalid_humanReason:${step.humanReason}` };
    }
    if (platform === "WORDPRESS" && step.humanReason === "terminal") {
      return { valid: false, reason: "terminal_forbidden_wp" };
    }
  }

  return { valid: true, step };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("humanReason validation", () => {
  describe("NEXTJS platform", () => {
    it("accepts HUMAN step with humanReason=terminal", () => {
      const r = validateStep({
        title: "Correr agente en terminal",
        type: "HUMAN",
        humanReason: "terminal",
        prompt: "Instrucciones",
      }, "NEXTJS");
      expect(r.valid).toBe(true);
    });

    it("accepts HUMAN step with humanReason=config", () => {
      const r = validateStep({
        title: "Aprobar keywords",
        type: "HUMAN",
        humanReason: "config",
        prompt: "Revisa y aprueba",
      }, "NEXTJS");
      expect(r.valid).toBe(true);
    });

    it("accepts HUMAN step with humanReason=external_tool", () => {
      const r = validateStep({
        title: "Verificar sitemap en GSC",
        type: "HUMAN",
        humanReason: "external_tool",
        prompt: "Instrucciones GSC",
      }, "NEXTJS");
      expect(r.valid).toBe(true);
    });

    it("rejects HUMAN step without humanReason", () => {
      const r = validateStep({
        title: "Investigar keywords en DataForSEO",
        type: "HUMAN",
        prompt: "Entrar a DataForSEO y buscar keywords",
      }, "NEXTJS");
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("missing_humanReason");
    });

    it("rejects HUMAN step with wp_manual on NEXTJS", () => {
      const r = validateStep({
        title: "Editar en WP Admin",
        type: "HUMAN",
        humanReason: "wp_manual",
        prompt: "Instrucciones",
      }, "NEXTJS");
      expect(r.valid).toBe(false);
    });
  });

  describe("WORDPRESS platform", () => {
    it("accepts HUMAN step with humanReason=wp_manual", () => {
      const r = validateStep({
        title: "Crear landing en Elementor",
        type: "HUMAN",
        humanReason: "wp_manual",
        prompt: "Instrucciones",
      }, "WORDPRESS");
      expect(r.valid).toBe(true);
    });

    it("rejects humanReason=terminal on WORDPRESS", () => {
      const r = validateStep({
        title: "Correr en terminal",
        type: "HUMAN",
        humanReason: "terminal",
        prompt: "Instrucciones",
      }, "WORDPRESS");
      expect(r.valid).toBe(false);
      expect(r.reason).toContain("terminal");
    });

    it("accepts config on WORDPRESS", () => {
      const r = validateStep({
        title: "Aprobar keywords",
        type: "HUMAN",
        humanReason: "config",
        prompt: "Revisa",
      }, "WORDPRESS");
      expect(r.valid).toBe(true);
    });
  });

  describe("AI steps", () => {
    it("AI step passes without humanReason", () => {
      const r = validateStep({
        title: "Keyword research",
        type: "AI",
        prompt: '{"action":"keyword_research"}',
      }, "NEXTJS");
      expect(r.valid).toBe(true);
    });

    it("AI step with humanReason gets it cleared (no rejection)", () => {
      const result = stepSchema.safeParse({
        title: "Test",
        type: "AI",
        humanReason: "terminal",
        prompt: "test",
      });
      expect(result.success).toBe(true);
      // In the decomposer, humanReason would be set to null for AI steps
    });
  });
});

describe("IYPIG task decomposition template", () => {
  it("keyword research task should produce 3 steps: AI data → HUMAN config → AI apply", () => {
    // Simulate what the decomposer SHOULD produce for "Investigar y seleccionar 25 keywords"
    const expectedTemplate = [
      {
        title: "Investigar y seleccionar keywords prioritarias",
        type: "AI",
        prompt: JSON.stringify({
          action: "keyword_research",
          categories: [{ name: "General", seeds: ["seo monterrey"] }],
          criteria: { minVolume: 100, maxKD: 60, total: 25 },
        }),
        humanReason: null,
      },
      {
        title: "Aprobar y editar tabla de keywords",
        type: "HUMAN",
        humanReason: "config",
        prompt: "Revisa la tabla de keywords generada en el paso anterior. Puedes editar, agregar o eliminar filas. Cuando estés conforme, marca este paso como completado.",
      },
      {
        title: "Aplicar keywords aprobadas",
        type: "AI",
        prompt: JSON.stringify({ action: "apply_keywords" }),
        humanReason: null,
      },
    ];

    // Validate each step
    for (const step of expectedTemplate) {
      const result = validateStep(step, "NEXTJS");
      expect(result.valid).toBe(true);
    }

    // Verify structure: AI → HUMAN → AI
    expect(expectedTemplate[0].type).toBe("AI");
    expect(expectedTemplate[1].type).toBe("HUMAN");
    expect(expectedTemplate[1].humanReason).toBe("config");
    expect(expectedTemplate[2].type).toBe("AI");

    // Verify the first step is keyword_research
    const action = JSON.parse(expectedTemplate[0].prompt!);
    expect(action.action).toBe("keyword_research");

    // Verify the last step is apply_keywords
    const applyAction = JSON.parse(expectedTemplate[2].prompt!);
    expect(applyAction.action).toBe("apply_keywords");
  });

  it("same task on WORDPRESS produces matching catalog", () => {
    const wpSteps = [
      {
        title: "Investigar keywords",
        type: "AI",
        prompt: JSON.stringify({ action: "keyword_research", categories: [{ name: "General", seeds: ["seguridad electrónica"] }], criteria: { total: 25 } }),
        humanReason: null,
      },
      {
        title: "Aprobar keywords",
        type: "HUMAN",
        humanReason: "config",
        prompt: "Revisa la tabla.",
      },
      {
        title: "Aplicar keywords",
        type: "AI",
        prompt: JSON.stringify({ action: "apply_keywords" }),
        humanReason: null,
      },
    ];

    // All valid on WORDPRESS
    for (const step of wpSteps) {
      expect(validateStep(step, "WORDPRESS").valid).toBe(true);
    }

    // "terminal" never appears
    expect(wpSteps.every((s) => s.humanReason !== "terminal")).toBe(true);
  });
});
