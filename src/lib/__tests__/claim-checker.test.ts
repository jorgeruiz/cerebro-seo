import { describe, it, expect } from "vitest";
import { extractAndValidateClaims, type AgentClaim } from "../claim-checker";
import type { ClientContext } from "../client-context";

const baseCtx: ClientContext = {
  name: "Ayrisa",
  identity: "Renta de montacargas en Monterrey",
  learnings: null,
  quarterlyFocus: null,
  verifiedServices: ["renta de montacargas"],
  excludedServices: ["venta de montacargas"],
  confirmedClaims: [],
  warning: null,
};

describe("extractAndValidateClaims", () => {
  it("'con operador' without source → unsourced", () => {
    const text = "Renta de montacargas con operador disponible en Monterrey";
    const result = extractAndValidateClaims(text, [], baseCtx);
    expect(result.hasUnsourced).toBe(true);
    expect(result.unsourced.some((c) => c.text.includes("con operador"))).toBe(true);
  });

  it("'renta' with matching context → sourced", () => {
    const text = "Servicio de renta de montacargas industriales";
    const result = extractAndValidateClaims(text, [], baseCtx);
    // "renta de montacargas" is in verifiedServices → should be sourced
    const rentaClaim = result.claims.find((c) => c.text.includes("renta"));
    expect(rentaClaim?.source).toBe("context");
  });

  it("'venta' triggers unsourced (even though it's in excludedServices)", () => {
    const text = "Venta y renta de montacargas en México";
    const result = extractAndValidateClaims(text, [], baseCtx);
    // "venta" is NOT in verifiedServices (it's excluded) → flagged
    // "venta" triggers the risk pattern
    expect(result.hasUnsourced).toBe(true);
  });

  it("zona coverage → unsourced if not in context", () => {
    const text = "Cobertura en toda la república mexicana";
    const result = extractAndValidateClaims(text, [], baseCtx);
    expect(result.hasUnsourced).toBe(true);
    expect(result.unsourced.length).toBeGreaterThan(0);
  });

  it("time claims → unsourced", () => {
    const text = "Entrega en 24 horas garantizada";
    const result = extractAndValidateClaims(text, [], baseCtx);
    expect(result.hasUnsourced).toBe(true);
  });

  it("cifras → unsourced if not confirmed", () => {
    const text = "Más de 20 años de experiencia en el sector";
    const result = extractAndValidateClaims(text, [], baseCtx);
    expect(result.hasUnsourced).toBe(true);
    expect(result.unsourced.some((c) => c.text.includes("20 años"))).toBe(true);
  });

  it("confirmed claim matches → not unsourced", () => {
    const ctx = {
      ...baseCtx,
      confirmedClaims: [{ claim: "con operador disponible las 24 horas", confirmedAt: "2026-11-15" }],
    };
    const text = "Montacargas con operador disponible";
    const result = extractAndValidateClaims(text, [], ctx);
    // "con operador" is in confirmed claims → sourced
    const opClaim = result.claims.find((c) => c.text.includes("con operador"));
    expect(opClaim?.source).toBe("context");
  });

  it("agent-declared claims are preserved", () => {
    const agentClaims: AgentClaim[] = [
      { text: "renta de montacargas", source: "context", field: "verifiedServices" },
    ];
    const text = "Servicio de renta de montacargas profesional";
    const result = extractAndValidateClaims(text, agentClaims, baseCtx);
    expect(result.claims.some((c) => c.text === "renta de montacargas" && c.source === "context")).toBe(true);
  });

  it("neutral text without risk terms → no unsourced", () => {
    const text = "Soluciones para la industria manufacturera";
    const result = extractAndValidateClaims(text, [], baseCtx);
    expect(result.hasUnsourced).toBe(false);
  });
});
