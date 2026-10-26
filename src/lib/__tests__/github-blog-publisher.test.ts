import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildMdxContent,
  hasSection,
  parseBlogCategories,
  updateCatalogSchemas,
  updateSiteState,
  commitFiles,
  type BlogArticleData,
} from "../github-blog-publisher";

// ─── buildMdxContent ────────────────────────────────────────────────────────

describe("buildMdxContent", () => {
  it("generates valid MDX with all fields", () => {
    const data: BlogArticleData = {
      titulo: "CCTV para Empresas",
      slug: "cctv-para-empresas",
      categoria: "Seguridad",
      tags: ["cctv", "empresas", "monterrey"],
      extracto: "Guía completa de CCTV para empresas en Monterrey.",
      cuerpo: "## Introducción\n\nContenido del artículo.",
      autor: "Brainet",
    };

    const mdx = buildMdxContent(data);

    expect(mdx).toContain('titulo: "CCTV para Empresas"');
    expect(mdx).toContain("slug: cctv-para-empresas");
    expect(mdx).toContain('categoria: "Seguridad"');
    expect(mdx).toContain('tags: ["cctv", "empresas", "monterrey"]');
    expect(mdx).toContain('extracto: "Guía completa de CCTV');
    expect(mdx).toContain('autor: "Brainet"');
    expect(mdx).toContain("fecha_publicacion:");
    expect(mdx).toContain("## Introducción");
    // No borrador field
    expect(mdx).not.toContain("borrador");
    expect(mdx).not.toContain("draft");
  });

  it("escapes double quotes in YAML values", () => {
    const data: BlogArticleData = {
      titulo: 'Artículo con "comillas"',
      slug: "articulo-comillas",
      categoria: "General",
      extracto: "Extracto con \"comillas\" internas",
      cuerpo: "Body",
      autor: "Test",
    };

    const mdx = buildMdxContent(data);
    expect(mdx).toContain('titulo: "Artículo con \\"comillas\\""');
  });

  it("omits tags when empty", () => {
    const data: BlogArticleData = {
      titulo: "Sin tags",
      slug: "sin-tags",
      categoria: "General",
      extracto: "Sin tags",
      cuerpo: "Body",
      autor: "Test",
    };

    const mdx = buildMdxContent(data);
    expect(mdx).not.toContain("tags:");
  });

  it("includes imagen_portada when provided", () => {
    const data: BlogArticleData = {
      titulo: "Con imagen",
      slug: "con-imagen",
      categoria: "General",
      extracto: "Extracto",
      cuerpo: "Body",
      autor: "Test",
      imagen_portada: "/blog/con-imagen/portada.webp",
    };

    const mdx = buildMdxContent(data);
    expect(mdx).toContain('imagen_portada: "/blog/con-imagen/portada.webp"');
  });

  it("defaults autor to 'Equipo editorial' when empty", () => {
    const data: BlogArticleData = {
      titulo: "Test",
      slug: "test",
      categoria: "General",
      extracto: "Extracto",
      cuerpo: "Body",
      autor: "",
    };

    const mdx = buildMdxContent(data);
    expect(mdx).toContain('autor: "Equipo editorial"');
  });
});

// ─── hasSection ─────────────────────────────────────────────────────────────

describe("hasSection", () => {
  it("detects exact ## Blog heading", () => {
    const schemas = "# Catalog\n\n## Blog\n\n**Estado:** Implementado\n\n## Landing Pages";
    expect(hasSection(schemas, "Blog")).toBe(true);
  });

  it("detects ## Blog — Implementado (with decorator)", () => {
    const schemas = "## Blog — Implementado\n\nContenido aquí.";
    expect(hasSection(schemas, "Blog")).toBe(true);
  });

  it("detects ## Blog (listo)", () => {
    const schemas = "## Blog (listo)\n\nContenido.";
    expect(hasSection(schemas, "Blog")).toBe(true);
  });

  it("detects ## Blog - activo", () => {
    const schemas = "## Blog - activo\n\nContenido.";
    expect(hasSection(schemas, "Blog")).toBe(true);
  });

  it("detects ## Blog: configurado", () => {
    const schemas = "## Blog: configurado\n\nContenido.";
    expect(hasSection(schemas, "Blog")).toBe(true);
  });

  it("rejects ## Blog Post (extra word)", () => {
    const schemas = "## Blog Post\n\n**Estado:** Implementado";
    expect(hasSection(schemas, "Blog")).toBe(false);
  });

  it("rejects ## Blogs (plural)", () => {
    const schemas = "## Blogs\n\n**Estado:** Implementado";
    expect(hasSection(schemas, "Blog")).toBe(false);
  });

  it("returns false when section contains 'No implementado'", () => {
    const schemas = "## Blog\n**Estado:** No implementado\n\n## Landing Pages";
    expect(hasSection(schemas, "Blog")).toBe(false);
  });

  it("returns false when **Estado:** says Pendiente", () => {
    const schemas = "## Blog\n**Estado:** Pendiente\n\n## Landing Pages";
    expect(hasSection(schemas, "Blog")).toBe(false);
  });

  it("returns true when body has 'pendientes' but Estado is not Pendiente", () => {
    const schemas = "## Blog\n**Estado:** Implementado\n\n**Categorías existentes:**\n- categorías pendientes de definir\n\n## Landing Pages";
    expect(hasSection(schemas, "Blog")).toBe(true);
  });

  it("returns false when heading itself says Pendiente", () => {
    const schemas = "## Blog — Pendiente\n\nAlgo aquí.";
    expect(hasSection(schemas, "Blog")).toBe(false);
  });

  it("returns false for null schemas", () => {
    expect(hasSection(null, "Blog")).toBe(false);
  });

  it("returns false when section doesn't exist", () => {
    const schemas = "## Landing Pages\n\nContenido.";
    expect(hasSection(schemas, "Blog")).toBe(false);
  });

  it("works for Landing Pages section", () => {
    const schemas = "## Blog\nOK\n\n## Landing Pages\n**Estado:** Implementado";
    expect(hasSection(schemas, "Landing Pages")).toBe(true);
  });

  it("works for Micrositios section", () => {
    const schemas = "## Micrositios — Implementado\n\nContenido.";
    expect(hasSection(schemas, "Micrositios")).toBe(true);
  });
});

// ─── parseBlogCategories ────────────────────────────────────────────────────

describe("parseBlogCategories", () => {
  it("extracts categories from formatted list", () => {
    const schemas = `## Blog
**Categorías existentes:**
- Seguridad
- Redes
- Infraestructura

**Reglas SEO:**`;
    expect(parseBlogCategories(schemas)).toEqual(["Seguridad", "Redes", "Infraestructura"]);
  });

  it("filters out '(ninguna todavía)' marker", () => {
    const schemas = `**Categorías existentes:**
- (ninguna todavía)`;
    expect(parseBlogCategories(schemas)).toEqual([]);
  });

  it("returns empty for null", () => {
    expect(parseBlogCategories(null)).toEqual([]);
  });
});

// ─── updateCatalogSchemas ───────────────────────────────────────────────────

describe("updateCatalogSchemas", () => {
  it("returns null if category already exists", () => {
    const result = updateCatalogSchemas("content", "CCTV", ["CCTV", "Redes"]);
    expect(result).toBeNull();
  });

  it("replaces (ninguna todavía) marker", () => {
    const schemas = `**Categorías existentes:**
- (ninguna todavía)

**Reglas SEO:**`;
    const result = updateCatalogSchemas(schemas, "CCTV", []);
    expect(result).toContain("- CCTV");
    expect(result).not.toContain("(ninguna todavía)");
  });

  it("inserts before **Reglas SEO:** when no marker", () => {
    const schemas = `**Categorías existentes:**
- Seguridad

**Reglas SEO:** ...`;
    const result = updateCatalogSchemas(schemas, "CCTV", ["Seguridad"]);
    expect(result).toContain("- CCTV");
    expect(result).toContain("**Reglas SEO:**");
  });
});

// ─── updateSiteState ────────────────────────────────────────────────────────

describe("updateSiteState", () => {
  it("replaces 'Sin cambios' marker", () => {
    const existing = "# Site State\n\n_Sin cambios registrados aun._";
    const result = updateSiteState(existing, "Mi Artículo", "mi-articulo", "CEREBRO-123");
    expect(result).toContain('Blog: "Mi Artículo" → /blog/mi-articulo (CEREBRO-123)');
    expect(result).not.toContain("_Sin cambios");
  });

  it("appends when no marker", () => {
    const existing = "# Site State\n\n- [2026-10-01] Algo previo";
    const result = updateSiteState(existing, "Nuevo", "nuevo", "REQ-1");
    expect(result).toContain("- [2026-10-01] Algo previo");
    expect(result).toContain('Blog: "Nuevo" → /blog/nuevo (REQ-1)');
  });
});

// ─── Blog body validation (mirrors actionPublishNextjsBlog guards) ───────────

describe("blog body validation", () => {
  const htmlBlockRegex = /<(h[1-6]|p|div|ul|ol|blockquote)\b/i;
  const h1Regex = /^# /m;

  it("rejects body with <h1> tag", () => {
    expect(htmlBlockRegex.test("<h1>Title</h1>\n\nContent")).toBe(true);
  });

  it("rejects body with <p> tag", () => {
    expect(htmlBlockRegex.test("Some text\n<p>Paragraph</p>")).toBe(true);
  });

  it("rejects body with <div> tag", () => {
    expect(htmlBlockRegex.test('<div class="container">Content</div>')).toBe(true);
  });

  it("rejects body with <ul> tag", () => {
    expect(htmlBlockRegex.test("<ul><li>Item</li></ul>")).toBe(true);
  });

  it("rejects body with <blockquote>", () => {
    expect(htmlBlockRegex.test("<blockquote>Quote</blockquote>")).toBe(true);
  });

  it("allows inline HTML like <strong>, <em>, <a>", () => {
    const body = "Text with <strong>bold</strong> and <em>italic</em> and <a href='/'>link</a>.";
    expect(htmlBlockRegex.test(body)).toBe(false);
  });

  it("allows pure Markdown", () => {
    const body = "## Section\n\n**Bold** text with [link](/url).\n\n- Item 1\n- Item 2";
    expect(htmlBlockRegex.test(body)).toBe(false);
  });

  it("rejects Markdown H1", () => {
    expect(h1Regex.test("# My Title\n\n## Section")).toBe(true);
  });

  it("allows ## H2 and ### H3", () => {
    expect(h1Regex.test("## Section\n\n### Subsection")).toBe(false);
  });

  it("does not false-positive on # inside text", () => {
    expect(h1Regex.test("Use C# for development")).toBe(false);
  });
});

// ─── commitFiles ────────────────────────────────────────────────────────────

describe("commitFiles", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls GitHub API in correct order: ref → commit → blobs → tree → commit → update ref", async () => {
    const calls: string[] = [];

    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = new URL(url).pathname;
      calls.push(`${method} ${path}`);

      // Mock responses for each step
      if (path.endsWith("/git/refs/heads/main")) {
        return new Response(JSON.stringify({ object: { sha: "ref-sha" } }));
      }
      if (path.includes("/git/commits/ref-sha")) {
        return new Response(JSON.stringify({ tree: { sha: "tree-sha" } }));
      }
      if (path.endsWith("/git/blobs")) {
        return new Response(JSON.stringify({ sha: "blob-sha" }));
      }
      if (path.endsWith("/git/trees")) {
        return new Response(JSON.stringify({ sha: "new-tree-sha" }));
      }
      if (path.endsWith("/git/commits") && method === "POST") {
        return new Response(JSON.stringify({ sha: "new-commit-sha" }));
      }
      if (path.endsWith("/git/refs/heads/main") && method === "PATCH") {
        return new Response(JSON.stringify({ object: { sha: "new-commit-sha" } }));
      }
      return new Response("Not found", { status: 404 });
    }));

    const result = await commitFiles(
      "owner",
      "repo",
      "main",
      [
        { path: "content/blog/test.mdx", content: "# Test" },
        { path: "public/blog/test/portada.webp", content: "base64data", encoding: "base64" },
      ],
      "test commit",
      "fake-pat"
    );

    expect(result.sha).toBe("new-commit-sha");
    expect(calls).toEqual([
      "GET /repos/owner/repo/git/refs/heads/main",
      "GET /repos/owner/repo/git/commits/ref-sha",
      "POST /repos/owner/repo/git/blobs",
      "POST /repos/owner/repo/git/blobs",
      "POST /repos/owner/repo/git/trees",
      "POST /repos/owner/repo/git/commits",
      "PATCH /repos/owner/repo/git/refs/heads/main",
    ]);
  });
});
