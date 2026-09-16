import { describe, it, expect } from "vitest";
import { validateNextSteps } from "../validation";

describe("validateNextSteps", () => {
  it("valid step with all fields → success", () => {
    const result = validateNextSteps([
      {
        titulo: "Optimizar meta de /servicios",
        descripcion: "La página tiene CTR bajo",
        categoria: "oportunidad",
        prioridad: 2,
        seccionDestino: "trafico-paginas",
        evidencia: "CTR 1.2%, pos #5",
        esfuerzo: "bajo",
        impacto: "alto",
        kind: "meta",
        targetUrl: "/servicios",
        keywords: ["servicios"],
      },
    ]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].kind).toBe("meta");
    }
  });

  it("valid step without new fields (backward compat) → success", () => {
    const result = validateNextSteps([
      {
        titulo: "Old plan step",
        descripcion: "From before v2",
        categoria: "mejora",
        prioridad: 3,
        evidencia: "Some data",
      },
    ]);
    expect(result.success).toBe(true);
  });

  it("valid step with null new fields → success", () => {
    const result = validateNextSteps([
      {
        titulo: "Step with nulls",
        descripcion: "All new fields null",
        categoria: "urgente",
        prioridad: 1,
        evidencia: "Data point",
        esfuerzo: null,
        impacto: null,
        kind: null,
        targetUrl: null,
        keywords: null,
      },
    ]);
    expect(result.success).toBe(true);
  });

  it("invalid categoria → failure", () => {
    const result = validateNextSteps([
      {
        titulo: "Bad step",
        descripcion: "desc",
        categoria: "inexistente",
        prioridad: 2,
        evidencia: "data",
      },
    ]);
    expect(result.success).toBe(false);
  });

  it("invalid kind → failure", () => {
    const result = validateNextSteps([
      {
        titulo: "Bad kind",
        descripcion: "desc",
        categoria: "oportunidad",
        prioridad: 2,
        evidencia: "data",
        kind: "link-building",
      },
    ]);
    expect(result.success).toBe(false);
  });

  it("prioridad out of range → failure", () => {
    const result = validateNextSteps([
      {
        titulo: "Bad prio",
        descripcion: "desc",
        categoria: "mejora",
        prioridad: 10,
        evidencia: "data",
      },
    ]);
    expect(result.success).toBe(false);
  });

  it("invalid seccionDestino → failure", () => {
    const result = validateNextSteps([
      {
        titulo: "Bad section",
        descripcion: "desc",
        categoria: "mejora",
        prioridad: 2,
        seccionDestino: "nonexistent-section",
        evidencia: "data",
      },
    ]);
    expect(result.success).toBe(false);
  });

  it("empty array → success", () => {
    const result = validateNextSteps([]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(0);
  });

  it("not an array → failure", () => {
    const result = validateNextSteps({ steps: [] });
    expect(result.success).toBe(false);
  });

  it("all valid kinds accepted", () => {
    const kinds = ["meta", "contenido-blog", "contenido-landing", "schema", "tecnico", "otro"];
    for (const kind of kinds) {
      const result = validateNextSteps([
        {
          titulo: `Step with kind ${kind}`,
          descripcion: "desc",
          categoria: "mejora",
          prioridad: 3,
          evidencia: "data",
          kind,
        },
      ]);
      expect(result.success).toBe(true);
    }
  });

  it("all valid esfuerzos accepted", () => {
    for (const esfuerzo of ["bajo", "medio", "alto"]) {
      const result = validateNextSteps([
        {
          titulo: "Step",
          descripcion: "desc",
          categoria: "mejora",
          prioridad: 3,
          evidencia: "data",
          esfuerzo,
        },
      ]);
      expect(result.success).toBe(true);
    }
  });
});
