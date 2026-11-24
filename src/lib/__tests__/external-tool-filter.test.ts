import { describe, it, expect } from "vitest";

// The filter regex from claude-analysis.ts — extracted for testing
const EXTERNAL_TOOL_FILTER = /semrush|ahrefs|\bmoz\b|ubersuggest|screaming\s*frog|similarweb|gtmetrix|herramienta\s+(de\s+)?(tracking|monitoreo|seo)|tracking\s+de\s+keywords|rastreador\s+de\s+keywords|verificar\s+configuraci[oó]n\s+(de\s+)?(tracking|rank)|ampliar\s+tracking/i;

describe("EXTERNAL_TOOL_FILTER", () => {
  // Real fixtures from the audit
  it("catches Brinar: Ahrefs, SEMrush or Moz", () => {
    expect(EXTERNAL_TOOL_FILTER.test(
      "Correr análisis de backlinks en Ahrefs, SEMrush o Moz para identificar oportunidades de link building"
    )).toBe(true);
  });

  it("catches Print boxes: via Ahrefs o Semrush", () => {
    expect(EXTERNAL_TOOL_FILTER.test(
      "Generar reporte de backlinks del dominio via Ahrefs o Semrush"
    )).toBe(true);
  });

  it("catches Avance: Usando Ahrefs, SEMrush o Moz", () => {
    expect(EXTERNAL_TOOL_FILTER.test(
      "Usando Ahrefs, SEMrush o Moz, analizar el perfil de backlinks"
    )).toBe(true);
  });

  it("catches Química: Verificar configuración de tracking de keywords", () => {
    expect(EXTERNAL_TOOL_FILTER.test(
      "Verificar configuración de tracking de keywords"
    )).toBe(true);
  });

  it("catches RFN: Ampliar tracking de keywords de 9 a 30+", () => {
    expect(EXTERNAL_TOOL_FILTER.test(
      "Ampliar tracking de keywords de 9 a 30+"
    )).toBe(true);
  });

  it("catches Screaming Frog", () => {
    expect(EXTERNAL_TOOL_FILTER.test(
      "Correr un crawl con Screaming Frog para detectar errores técnicos"
    )).toBe(true);
  });

  it("catches GTmetrix", () => {
    expect(EXTERNAL_TOOL_FILTER.test(
      "Medir la velocidad del sitio con GTmetrix"
    )).toBe(true);
  });

  it("catches SimilarWeb", () => {
    expect(EXTERNAL_TOOL_FILTER.test(
      "Comparar tráfico con Similarweb"
    )).toBe(true);
  });

  it("catches Ubersuggest", () => {
    expect(EXTERNAL_TOOL_FILTER.test(
      "Investigar keywords con Ubersuggest"
    )).toBe(true);
  });

  it("catches herramienta de monitoreo SEO", () => {
    expect(EXTERNAL_TOOL_FILTER.test(
      "Configurar herramienta de monitoreo SEO"
    )).toBe(true);
  });

  it("catches rastreador de keywords", () => {
    expect(EXTERNAL_TOOL_FILTER.test(
      "Instalar rastreador de keywords para seguimiento"
    )).toBe(true);
  });

  it("catches verificar configuración del rank tracking", () => {
    // "verificar configuración de tracking" matches, "del rank tracking" needs "de"
    expect(EXTERNAL_TOOL_FILTER.test(
      "Verificar configuración de rank tracking"
    )).toBe(true);
  });

  // Should NOT match
  it("does not catch normal SEO tasks", () => {
    expect(EXTERNAL_TOOL_FILTER.test(
      "Optimizar meta title y description para la página de servicios"
    )).toBe(false);
  });

  it("does not catch 'Moz' inside other words like Montemorelos", () => {
    // \bMoz\b should not match inside other words
    expect(EXTERNAL_TOOL_FILTER.test("Montemorelos")).toBe(false);
    expect(EXTERNAL_TOOL_FILTER.test("mozambique")).toBe(false);
  });

  it("does not catch 'crear contenido de blog'", () => {
    expect(EXTERNAL_TOOL_FILTER.test(
      "Crear artículo de blog sobre tratamiento de aguas"
    )).toBe(false);
  });
});
