import { describe, it, expect } from "vitest";
import { resolveKeyword, extractQuotedKeyword, sanitizeKeyword } from "../keyword-resolver";

describe("extractQuotedKeyword", () => {
  it("extracts from single quotes", () => {
    expect(extractQuotedKeyword("Redactar artículo 'Piso Vinílico para Oficinas'")).toBe("Piso Vinílico para Oficinas");
  });

  it("extracts from curly quotes", () => {
    expect(extractQuotedKeyword("Crear blog \u201CCCTV para Empresas\u201D")).toBe("CCTV para Empresas");
  });

  it("extracts from double quotes", () => {
    expect(extractQuotedKeyword('Publicar "Control de Acceso Biométrico"')).toBe("Control de Acceso Biométrico");
  });

  it("returns null when no quotes", () => {
    expect(extractQuotedKeyword("Optimizar meta tags")).toBeNull();
  });
});

describe("sanitizeKeyword", () => {
  it("strips instruction verbs", () => {
    expect(sanitizeKeyword("Redactar y publicar artículo sobre CCTV empresas")).toBe("sobre CCTV empresas");
  });

  it("handles simple keyword", () => {
    expect(sanitizeKeyword("piso vinílico monterrey")).toBe("piso vinílico monterrey");
  });

  it("strips multiple prefixes", () => {
    expect(sanitizeKeyword("Crear blog de seguridad electrónica")).toBe("seguridad electrónica");
  });
});

describe("resolveKeyword", () => {
  it("prefers payload keyword", () => {
    expect(resolveKeyword("piso vinílico", "backup keyword", "Tarea larga")).toBe("piso vinílico");
  });

  it("falls back to targetKeyword", () => {
    expect(resolveKeyword(undefined, "control de acceso", "Tarea larga")).toBe("control de acceso");
  });

  it("falls back to quoted text in title", () => {
    expect(resolveKeyword(undefined, null, "Redactar artículo 'Piso Vinílico para Oficinas en Monterrey'")).toBe("Piso Vinílico para Oficinas en Monterrey");
  });

  it("falls back to sanitized title if short enough", () => {
    expect(resolveKeyword(undefined, null, "Crear blog sobre CCTV empresas")).toBe("sobre CCTV empresas");
  });

  it("returns null for extremely long titles with no keyword", () => {
    const longTitle = "Redactar y publicar artículo sobre un tema que es demasiado largo para ser una keyword razonable y que no tiene comillas ni nada útil para extraer";
    expect(resolveKeyword(undefined, null, longTitle)).toBeNull();
  });

  it("ignores empty payload keyword", () => {
    expect(resolveKeyword("", "backup", "title")).toBe("backup");
  });

  it("ignores very short payload keyword", () => {
    expect(resolveKeyword("ab", "backup keyword", "title")).toBe("backup keyword");
  });
});
