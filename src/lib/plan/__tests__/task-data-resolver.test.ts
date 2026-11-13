import { describe, it, expect } from "vitest";
import { validateNoVagueReferences, REQUIRED_EVIDENCE } from "../task-data-resolver";

describe("validateNoVagueReferences", () => {
  it("passes when evidence rows are present", () => {
    const result = validateNoVagueReferences("Configura las URLs con 404", 5);
    expect(result.valid).toBe(true);
    expect(result.vagueMatches).toHaveLength(0);
  });

  it("rejects 'las URLs' without evidence", () => {
    const result = validateNoVagueReferences("Redirigir las URLs con error 404", 0);
    expect(result.valid).toBe(false);
    expect(result.vagueMatches).toContain("las URLs");
  });

  it("rejects 'las keywords' without evidence", () => {
    const result = validateNoVagueReferences("Posicionar las keywords prioritarias", 0);
    expect(result.valid).toBe(false);
    expect(result.vagueMatches).toContain("las keywords");
  });

  it("rejects 'las páginas' without evidence", () => {
    const result = validateNoVagueReferences("Verificar las páginas nuevas", 0);
    expect(result.valid).toBe(false);
    expect(result.vagueMatches).toContain("las páginas");
  });

  it("rejects 'los enlaces' without evidence", () => {
    const result = validateNoVagueReferences("Corregir los enlaces rotos del sitio", 0);
    expect(result.valid).toBe(false);
    expect(result.vagueMatches).toContain("los enlaces");
  });

  it("passes when no collection words are present", () => {
    const result = validateNoVagueReferences("Optimizar la página de servicios", 0);
    expect(result.valid).toBe(true);
  });

  it("collects multiple vague matches", () => {
    const result = validateNoVagueReferences("Redirigir las URLs y actualizar las keywords", 0);
    expect(result.valid).toBe(false);
    expect(result.vagueMatches.length).toBeGreaterThanOrEqual(2);
  });
});

describe("REQUIRED_EVIDENCE", () => {
  it("fix_redirect requires evidence", () => {
    expect(REQUIRED_EVIDENCE.fix_redirect).toBeDefined();
    expect(REQUIRED_EVIDENCE.fix_redirect!.description).toContain("404");
  });

  it("fix_broken_links requires evidence", () => {
    expect(REQUIRED_EVIDENCE.fix_broken_links).toBeDefined();
  });

  it("verify_indexation requires evidence", () => {
    expect(REQUIRED_EVIDENCE.verify_indexation).toBeDefined();
  });

  it("create_blog does NOT require evidence (content is generated)", () => {
    expect(REQUIRED_EVIDENCE.create_blog).toBeUndefined();
  });

  it("keyword_research does NOT require evidence (discovers new ones)", () => {
    expect(REQUIRED_EVIDENCE.keyword_research).toBeUndefined();
  });
});
