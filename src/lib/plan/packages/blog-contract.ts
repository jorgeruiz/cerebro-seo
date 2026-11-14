/**
 * Blog Contract — single source of truth for the blog structure.
 *
 * Every piece of code that reads or writes blog content imports from here:
 * - github-blog-publisher.ts (publishes MDX + cover image)
 * - image-executor.ts (saves generated images)
 * - blog-bootstrap.ts (installs the structure)
 * - memory-classifier.ts / plan-gates.ts (detects if blog is installed)
 * - agent-permissions.ts (restricts writes to content paths)
 * - repo-manager.ts (scans existing blog routes)
 */

// ─── Paths ──────────────────────────────────────────────────────────────────

/** Where blog MDX articles live. Slug replaces {slug}. */
export const BLOG_CONTENT_DIR = "content/blog";
export const BLOG_CONTENT_PATH = (slug: string) => `content/blog/${slug}.mdx`;

/** Alternative content dirs (some projects use src/content/blog). */
export const BLOG_CONTENT_ALT_DIRS = ["src/content/blog"];

/** Where cover images live. One directory per slug. */
export const BLOG_COVER_DIR = (slug: string) => `public/blog/${slug}`;
export const BLOG_COVER_PATH = (slug: string) => `public/blog/${slug}/portada.webp`;
export const BLOG_COVER_RELATIVE = (slug: string) => `/blog/${slug}/portada.webp`;

/** Allowed write prefixes for content-only agent permissions. */
export const BLOG_WRITE_PREFIXES = ["content/blog/", "public/blog/"];

// ─── Frontmatter ────────────────────────────────────────────────────────────

/** The frontmatter fields the publisher writes. */
export interface BlogFrontmatter {
  titulo: string;
  slug: string;
  categoria: string;
  tags?: string[];
  extracto: string;
  imagen_portada?: string;
  autor: string;
  fecha_publicacion: string; // YYYY-MM-DD
}

/** Required fields (Zod-like description for the install prompt). */
export const FRONTMATTER_SCHEMA_DOC = `
titulo: string (título del artículo)
slug: string (URL-safe, sin acentos)
categoria: string (categoría del blog, e.g. "seguridad", "productos")
tags: string[] (opcional, para filtros)
extracto: string (150-200 chars, para meta description y listado)
imagen_portada: string (ruta relativa a /public, e.g. "/blog/{slug}/portada.webp")
autor: string (nombre del autor)
fecha_publicacion: string (YYYY-MM-DD)
`.trim();

// ─── Catalog Schemas Section ────────────────────────────────────────────────

/**
 * Heading format for catalog-schemas.md.
 * Compatible with existing sites: "## Blog" or "## Blog — Implementado".
 * The detector accepts any of these.
 */
export const CATALOG_SECTION_HEADING = "## Blog";

/** Regex to detect the Blog heading (tolerant: accepts decorators). */
export const CATALOG_SECTION_REGEX = /^##\s+Blog\s*(?:$|[—\-:(])/im;

/** Marker that the section is NOT ready. */
export const NOT_IMPLEMENTED_REGEX = /no\s*implementado|pendiente/i;

/**
 * Template for the ## Blog section in catalog-schemas.md.
 * The install prompt tells the agent to add this.
 */
export const CATALOG_SECTION_TEMPLATE = `
## Blog

**Estado:** Implementado

### Frontmatter

\`\`\`yaml
${FRONTMATTER_SCHEMA_DOC}
\`\`\`

### Rutas

- Contenido: \`${BLOG_CONTENT_DIR}/{slug}.mdx\`
- Portada: \`public/blog/{slug}/portada.webp\`
- Página lista: \`app/blog/page.tsx\` (o \`app/(es)/blog/page.tsx\` según route group)
- Página artículo: \`app/blog/[slug]/page.tsx\`
`.trim();

// ─── Route Detection ────────────────────────────────────────────────────────

/** Possible locations for the blog list page in a Next.js project. */
export const BLOG_ROUTE_CANDIDATES = [
  "app/blog/page.tsx",
  "app/(es)/blog/page.tsx",
  "src/app/blog/page.tsx",
  "src/app/(es)/blog/page.tsx",
];

/** Possible locations for the blog article page. */
export const BLOG_SLUG_ROUTE_CANDIDATES = [
  "app/blog/[slug]/page.tsx",
  "app/(es)/blog/[slug]/page.tsx",
  "src/app/blog/[slug]/page.tsx",
  "src/app/(es)/blog/[slug]/page.tsx",
];
