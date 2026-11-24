import { describe, it, expect } from "vitest";
import { normalizeDomain } from "../normalize-domain";

describe("normalizeDomain", () => {
  it("extracts domain from full URL", () => {
    expect(normalizeDomain("https://www.example.com/page")).toBe("example.com");
  });

  it("strips www", () => {
    expect(normalizeDomain("www.example.com")).toBe("example.com");
  });

  it("handles plain domain", () => {
    expect(normalizeDomain("example.com")).toBe("example.com");
  });

  it("lowercases", () => {
    expect(normalizeDomain("WWW.ExAmPlE.COM")).toBe("example.com");
  });

  it("strips port and path", () => {
    expect(normalizeDomain("https://example.com:8080/path?q=1")).toBe("example.com");
  });

  it("returns null for empty string", () => {
    expect(normalizeDomain("")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
  });

  it("returns null for IP address", () => {
    expect(normalizeDomain("192.168.1.1")).toBeNull();
  });

  it("returns null for string without dot", () => {
    expect(normalizeDomain("localhost")).toBeNull();
  });

  it("handles http scheme", () => {
    expect(normalizeDomain("http://molinoazteca.com")).toBe("molinoazteca.com");
  });

  it("handles trailing slash", () => {
    expect(normalizeDomain("https://molinoazteca.com/")).toBe("molinoazteca.com");
  });

  it("handles whitespace", () => {
    expect(normalizeDomain("  www.example.com  ")).toBe("example.com");
  });
});
