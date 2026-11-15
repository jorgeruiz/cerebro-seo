import { describe, it, expect } from "vitest";
import { normalizeUrl } from "../plan-bridge";

describe("normalizeUrl", () => {
  it("full URL → path only", () => {
    expect(normalizeUrl("https://www.dominio.mx/ruta/")).toBe("/ruta");
  });

  it("relative path stays as path", () => {
    expect(normalizeUrl("/ruta")).toBe("/ruta");
  });

  it("domain+path → path only", () => {
    expect(normalizeUrl("dominio.mx/ruta")).toBe("/ruta");
  });

  it("home page (full URL with slash)", () => {
    expect(normalizeUrl("https://dominio.mx/")).toBe("/");
  });

  it("home page (full URL without slash)", () => {
    expect(normalizeUrl("https://dominio.mx")).toBe("/");
  });

  it("strips trailing slash (non-home)", () => {
    expect(normalizeUrl("/servicios/cctv/")).toBe("/servicios/cctv");
  });

  it("lowercases", () => {
    expect(normalizeUrl("https://Example.COM/Ruta")).toBe("/ruta");
  });

  it("decodes percent-encoding", () => {
    expect(normalizeUrl("/qu%C3%A9-es-la-bio")).toBe("/qué-es-la-bio");
  });

  it("all forms of the same URL match", () => {
    const forms = [
      "https://www.dominio.mx/ruta/",
      "/ruta",
      "dominio.mx/ruta",
      "http://dominio.mx/ruta/",
    ];
    const normalized = forms.map(normalizeUrl);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe("/ruta");
  });

  it("home page matches across forms", () => {
    const forms = [
      "https://www.dominio.mx/",
      "https://dominio.mx",
      "/",
    ];
    const normalized = forms.map(normalizeUrl);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe("/");
  });
});
