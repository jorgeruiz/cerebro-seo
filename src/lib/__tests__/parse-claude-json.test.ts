import { describe, it, expect } from "vitest";
import { parseClaudeJson } from "../parse-claude-json";

describe("parseClaudeJson", () => {
  it("parses clean JSON", () => {
    const result = parseClaudeJson('{"h1": "Title", "meta_title": "Meta"}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ h1: "Title", meta_title: "Meta" });
  });

  it("parses JSON with markdown fences", () => {
    const result = parseClaudeJson('```json\n{"h1": "Title"}\n```');
    expect(result.ok).toBe(true);
  });

  it("extracts JSON from text + JSON mixed response", () => {
    const mixed = `Entiendo la corrección, pero debo señalar un problema.

Dicho esto, aquí va el JSON:

{"h1": "Piso Vinílico para Oficinas", "meta_title": "Piso Vinílico Oficinas Monterrey | Guía 2026"}

Espero que esto sea útil.`;
    const result = parseClaudeJson(mixed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as Record<string, string>).h1).toBe("Piso Vinílico para Oficinas");
    }
  });

  it("handles nested JSON objects", () => {
    const nested = '{"sections": [{"h2": "Intro", "text": "Content with \\"quotes\\""}]}';
    const result = parseClaudeJson(nested);
    expect(result.ok).toBe(true);
  });

  it("extracts JSON array", () => {
    const result = parseClaudeJson('Some text [{"title": "Step 1"}, {"title": "Step 2"}] end');
    expect(result.ok).toBe(true);
    if (result.ok) expect(Array.isArray(result.data)).toBe(true);
  });

  it("returns error for text-only response", () => {
    const textOnly = "Entiendo la solicitud pero no puedo generar el JSON porque la keyword excede el límite de caracteres.";
    const result = parseClaudeJson(textOnly);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rawText).toContain("Entiendo");
      expect(result.error).toContain("texto");
    }
  });

  it("returns error for empty response", () => {
    const result = parseClaudeJson("");
    expect(result.ok).toBe(false);
  });

  it("handles keyword of 50 chars in meta_title", () => {
    // The actual use case: long keyword generates valid JSON
    const json = JSON.stringify({
      h1: "Piso Vinílico para Oficinas en Monterrey: Guía Completa",
      meta_title: "Piso Vinílico Oficinas Monterrey | Guía 2026",
    });
    const result = parseClaudeJson(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { meta_title: string };
      expect(data.meta_title.length).toBeLessThanOrEqual(65);
    }
  });
});
