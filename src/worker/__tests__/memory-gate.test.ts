import { describe, it, expect } from "vitest";
import {
  isMemoryComplete,
  isMemoryReadyForCode,
  isMemoryReadyForContent,
  contentCategoryForTask,
  type MemoryStatus,
  type CatalogSections,
} from "../memory-classifier";

describe("isMemoryComplete (legacy)", () => {
  it("blocks when any file is ABSENT", () => {
    const s: MemoryStatus = { "site-spec": "FULL", "site-map": "FULL", "site-state": "FULL", "catalog-schemas": "ABSENT" };
    expect(isMemoryComplete(s)).toBe(false);
  });

  it("passes when all FULL", () => {
    const s: MemoryStatus = { "site-spec": "FULL", "site-map": "FULL", "site-state": "FULL", "catalog-schemas": "FULL" };
    expect(isMemoryComplete(s)).toBe(true);
  });
});

describe("isMemoryReadyForCode", () => {
  it("passes with site-spec, site-map, site-state FULL (ignores catalog-schemas)", () => {
    const s: MemoryStatus = { "site-spec": "FULL", "site-map": "FULL", "site-state": "FULL", "catalog-schemas": "ABSENT" };
    const result = isMemoryReadyForCode(s);
    expect(result.ready).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("blocks when site-spec is ABSENT", () => {
    const s: MemoryStatus = { "site-spec": "ABSENT", "site-map": "FULL", "site-state": "FULL", "catalog-schemas": "FULL" };
    const result = isMemoryReadyForCode(s);
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("site-spec (ABSENT)");
  });

  it("blocks when site-map is TEMPLATE", () => {
    const s: MemoryStatus = { "site-spec": "FULL", "site-map": "TEMPLATE", "site-state": "FULL", "catalog-schemas": "FULL" };
    const result = isMemoryReadyForCode(s);
    expect(result.ready).toBe(false);
    expect(result.missing).toContain("site-map (TEMPLATE)");
  });
});

describe("isMemoryReadyForContent", () => {
  const fullBase: MemoryStatus = { "site-spec": "FULL", "site-map": "FULL", "site-state": "FULL", "catalog-schemas": "FULL" };
  const noSchemas: MemoryStatus = { ...fullBase, "catalog-schemas": "ABSENT" };

  it("blocks CONTENT blog when catalog-schemas is ABSENT", () => {
    const cat: CatalogSections = { blog: false, landing: false, micrositios: false };
    const result = isMemoryReadyForContent(noSchemas, cat, "blog");
    expect(result.ready).toBe(false);
    expect(result.missing.some(m => m.includes("catalog-schemas"))).toBe(true);
  });

  it("blocks CONTENT blog when catalog-schemas exists but has no ## Blog section", () => {
    const cat: CatalogSections = { blog: false, landing: true, micrositios: false };
    const result = isMemoryReadyForContent(fullBase, cat, "blog");
    expect(result.ready).toBe(false);
    expect(result.missing.some(m => m.includes("## Blog"))).toBe(true);
  });

  it("passes CONTENT blog when catalog-schemas has ## Blog", () => {
    const cat: CatalogSections = { blog: true, landing: false, micrositios: false };
    const result = isMemoryReadyForContent(fullBase, cat, "blog");
    expect(result.ready).toBe(true);
  });

  it("blocks CONTENT landing when catalog-schemas has no ## Landing Pages", () => {
    const cat: CatalogSections = { blog: true, landing: false, micrositios: false };
    const result = isMemoryReadyForContent(fullBase, cat, "landing");
    expect(result.ready).toBe(false);
    expect(result.missing.some(m => m.includes("## Landing Pages"))).toBe(true);
  });

  it("passes CONTENT landing when catalog-schemas has ## Landing Pages", () => {
    const cat: CatalogSections = { blog: false, landing: true, micrositios: false };
    const result = isMemoryReadyForContent(fullBase, cat, "landing");
    expect(result.ready).toBe(true);
  });

  it("also checks base requirements (site-spec etc)", () => {
    const broken: MemoryStatus = { "site-spec": "ABSENT", "site-map": "FULL", "site-state": "FULL", "catalog-schemas": "FULL" };
    const cat: CatalogSections = { blog: true, landing: true, micrositios: true };
    const result = isMemoryReadyForContent(broken, cat, "blog");
    expect(result.ready).toBe(false);
    expect(result.missing.some(m => m.includes("site-spec"))).toBe(true);
  });
});

describe("contentCategoryForTask", () => {
  it("detects blog", () => {
    expect(contentCategoryForTask("blog")).toBe("blog");
    expect(contentCategoryForTask("articulo")).toBe("blog");
  });

  it("detects landing", () => {
    expect(contentCategoryForTask("landing")).toBe("landing");
  });

  it("returns null for code/setup/tecnico", () => {
    expect(contentCategoryForTask("tecnico")).toBeNull();
    expect(contentCategoryForTask("meta")).toBeNull();
    expect(contentCategoryForTask("schema")).toBeNull();
  });
});

describe("task-processor gate uses granular checks", () => {
  it("source code checks both AI and HYBRID with granular gate", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const source = readFileSync(join(__dirname, "..", "task-processor.ts"), "utf-8");

    expect(source).toContain("contentCategoryForTask");
    expect(source).toContain("isMemoryReadyForContent");
    expect(source).toContain("isMemoryReadyForCode");
    expect(source).toContain("detectCatalogSections");
    expect(source).toContain('task.mode === "AI" || task.mode === "HYBRID"');
  });
});
