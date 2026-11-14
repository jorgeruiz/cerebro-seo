import { describe, it, expect } from "vitest";
import {
  BLOG_CONTENT_DIR,
  BLOG_CONTENT_PATH,
  BLOG_COVER_PATH,
  BLOG_COVER_RELATIVE,
  BLOG_WRITE_PREFIXES,
  BLOG_ROUTE_CANDIDATES,
  BLOG_SLUG_ROUTE_CANDIDATES,
  CATALOG_SECTION_REGEX,
  CATALOG_SECTION_TEMPLATE,
  NOT_IMPLEMENTED_REGEX,
  FRONTMATTER_SCHEMA_DOC,
} from "../blog-contract";

describe("blog-contract paths", () => {
  it("content dir is content/blog", () => {
    expect(BLOG_CONTENT_DIR).toBe("content/blog");
  });

  it("content path builds correctly", () => {
    expect(BLOG_CONTENT_PATH("mi-articulo")).toBe("content/blog/mi-articulo.mdx");
  });

  it("cover path builds per-slug directory", () => {
    expect(BLOG_COVER_PATH("mi-articulo")).toBe("public/blog/mi-articulo/portada.webp");
  });

  it("cover relative path starts with /blog/", () => {
    expect(BLOG_COVER_RELATIVE("test")).toBe("/blog/test/portada.webp");
  });

  it("write prefixes cover content and public", () => {
    expect(BLOG_WRITE_PREFIXES).toContain("content/blog/");
    expect(BLOG_WRITE_PREFIXES).toContain("public/blog/");
    expect(BLOG_WRITE_PREFIXES).not.toContain("public/images/blog/");
  });
});

describe("blog-contract route candidates", () => {
  it("includes standard and (es) route groups", () => {
    expect(BLOG_ROUTE_CANDIDATES).toContain("app/blog/page.tsx");
    expect(BLOG_ROUTE_CANDIDATES).toContain("app/(es)/blog/page.tsx");
  });

  it("slug candidates match list candidates", () => {
    expect(BLOG_SLUG_ROUTE_CANDIDATES.length).toBe(BLOG_ROUTE_CANDIDATES.length);
  });
});

describe("blog-contract catalog section", () => {
  it("CATALOG_SECTION_REGEX matches '## Blog'", () => {
    expect(CATALOG_SECTION_REGEX.test("## Blog")).toBe(true);
  });

  it("CATALOG_SECTION_REGEX matches '## Blog — Implementado'", () => {
    expect(CATALOG_SECTION_REGEX.test("## Blog — Implementado")).toBe(true);
  });

  it("CATALOG_SECTION_REGEX rejects '## Blog Post'", () => {
    expect(CATALOG_SECTION_REGEX.test("## Blog Post")).toBe(false);
  });

  it("CATALOG_SECTION_REGEX rejects '## Blogs'", () => {
    expect(CATALOG_SECTION_REGEX.test("## Blogs")).toBe(false);
  });

  it("NOT_IMPLEMENTED_REGEX matches 'no implementado'", () => {
    expect(NOT_IMPLEMENTED_REGEX.test("No implementado")).toBe(true);
    expect(NOT_IMPLEMENTED_REGEX.test("pendiente")).toBe(true);
  });

  it("NOT_IMPLEMENTED_REGEX does not match 'Implementado'", () => {
    expect(NOT_IMPLEMENTED_REGEX.test("Implementado")).toBe(false);
  });

  it("CATALOG_SECTION_TEMPLATE includes frontmatter schema", () => {
    expect(CATALOG_SECTION_TEMPLATE).toContain("titulo: string");
    expect(CATALOG_SECTION_TEMPLATE).toContain("slug: string");
    expect(CATALOG_SECTION_TEMPLATE).toContain("fecha_publicacion");
  });

  it("CATALOG_SECTION_TEMPLATE includes Estado: Implementado", () => {
    expect(CATALOG_SECTION_TEMPLATE).toContain("**Estado:** Implementado");
  });

  it("CATALOG_SECTION_TEMPLATE uses contract paths", () => {
    expect(CATALOG_SECTION_TEMPLATE).toContain(BLOG_CONTENT_DIR);
    expect(CATALOG_SECTION_TEMPLATE).toContain("public/blog/{slug}/portada.webp");
  });
});

describe("blog-contract frontmatter schema", () => {
  it("documents all required fields", () => {
    expect(FRONTMATTER_SCHEMA_DOC).toContain("titulo");
    expect(FRONTMATTER_SCHEMA_DOC).toContain("slug");
    expect(FRONTMATTER_SCHEMA_DOC).toContain("categoria");
    expect(FRONTMATTER_SCHEMA_DOC).toContain("extracto");
    expect(FRONTMATTER_SCHEMA_DOC).toContain("imagen_portada");
    expect(FRONTMATTER_SCHEMA_DOC).toContain("autor");
    expect(FRONTMATTER_SCHEMA_DOC).toContain("fecha_publicacion");
  });
});
