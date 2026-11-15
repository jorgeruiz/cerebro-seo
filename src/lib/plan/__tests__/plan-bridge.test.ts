import { describe, it, expect } from "vitest";
import { normalizeUrl } from "../plan-bridge";

describe("normalizeUrl", () => {
  it("strips https://", () => {
    expect(normalizeUrl("https://example.com/ruta")).toBe("example.com/ruta");
  });

  it("strips http://", () => {
    expect(normalizeUrl("http://example.com/ruta")).toBe("example.com/ruta");
  });

  it("strips www.", () => {
    expect(normalizeUrl("https://www.example.com/ruta")).toBe("example.com/ruta");
  });

  it("strips trailing slash", () => {
    expect(normalizeUrl("https://example.com/ruta/")).toBe("example.com/ruta");
  });

  it("lowercases", () => {
    expect(normalizeUrl("https://Example.COM/Ruta")).toBe("example.com/ruta");
  });

  it("/ruta normalizes to /ruta, domain+path normalizes to domain/path", () => {
    // These are different — the bridge iterates all delta keys and normalizes both sides
    expect(normalizeUrl("/ruta/")).toBe("/ruta");
    expect(normalizeUrl("https://www.dominio.com/ruta")).toBe("dominio.com/ruta");
    // Same domain+path matches
    expect(normalizeUrl("https://www.dominio.com/ruta/")).toBe(normalizeUrl("http://dominio.com/ruta"));
  });

  it("relative path normalizes consistently", () => {
    expect(normalizeUrl("/servicios/cctv/")).toBe("/servicios/cctv");
  });

  it("handles bare domain", () => {
    expect(normalizeUrl("https://www.example.com/")).toBe("example.com");
  });
});
