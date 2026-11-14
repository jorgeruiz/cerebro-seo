/**
 * Blog Bootstrap Package — enables create_blog and refresh_content for Next.js sites.
 *
 * All paths and schemas come from blog-contract.ts (single source of truth).
 */

import type { PackageDefinition, PackageContext, PreflightResult, DetectResult, VerifyResult } from "./index";
import {
  BLOG_CONTENT_DIR,
  BLOG_ROUTE_CANDIDATES,
  CATALOG_SECTION_REGEX,
  CATALOG_SECTION_TEMPLATE,
  NOT_IMPLEMENTED_REGEX,
  FRONTMATTER_SCHEMA_DOC,
} from "./blog-contract";

async function fetchFile(repo: string, path: string, pat?: string): Promise<string | null> {
  const headers: Record<string, string> = { Accept: "application/vnd.github.raw" };
  if (pat) headers.Authorization = `Bearer ${pat}`;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      headers, signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return res.text();
  } catch { return null; }
}

async function fileExists(repo: string, path: string, pat?: string): Promise<boolean> {
  const headers: Record<string, string> = {};
  if (pat) headers.Authorization = `Bearer ${pat}`;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      headers, method: "HEAD", signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch { return false; }
}

/**
 * Detect whether the blog bootstrap is installed in a repo.
 * This is the SINGLE detector — used by G4, memory-classifier, and the package UI.
 */
export async function detectBlogBootstrap(ctx: PackageContext): Promise<DetectResult> {
  const pat = ctx.pat ?? process.env.GITHUB_PAT_CLIENT_REPOS;

  // Check 1: catalog-schemas.md has ## Blog heading (not marked "No implementado")
  const catalogSchemas = await fetchFile(ctx.githubRepo, "docs/catalog-schemas.md", pat);
  if (!catalogSchemas) {
    return { installed: false, details: "catalog-schemas.md no existe" };
  }

  const headingMatch = catalogSchemas.match(CATALOG_SECTION_REGEX);
  if (!headingMatch) {
    return { installed: false, details: "catalog-schemas.md no tiene seccion ## Blog" };
  }

  // Extract the Blog section text
  const startIdx = headingMatch.index!;
  const rest = catalogSchemas.slice(startIdx);
  const nextH2 = rest.match(/\n(?=## )/);
  const sectionText = nextH2 ? rest.slice(0, nextH2.index!) : rest;

  if (NOT_IMPLEMENTED_REGEX.test(sectionText.slice(0, 200))) {
    return { installed: false, details: "## Blog marcado como no implementado" };
  }

  // Check 2: /blog route exists
  let routeFound = false;
  for (const candidate of BLOG_ROUTE_CANDIDATES) {
    if (await fileExists(ctx.githubRepo, candidate, pat)) {
      routeFound = true;
      break;
    }
  }
  if (!routeFound) {
    return { installed: false, details: "Ruta /blog no existe en el repo" };
  }

  return { installed: true, version: "1" };
}

export const blogBootstrap: PackageDefinition = {
  id: "blog_bootstrap",
  name: "Bootstrap de Blog",
  description: "Estructura de blog para Next.js: rutas, MDX, sitemap, catalog-schemas ## Blog",
  platforms: ["NEXTJS"],
  version: "1",
  enables: ["create_blog", "refresh_content"],

  async preflight(ctx: PackageContext): Promise<PreflightResult> {
    const missing: string[] = [];
    const pat = ctx.pat ?? process.env.GITHUB_PAT_CLIENT_REPOS;

    if (!ctx.githubRepo) {
      missing.push("Repositorio GitHub no conectado");
      return { ready: false, missing };
    }

    const siteSpec = await fetchFile(ctx.githubRepo, "docs/site-spec.md", pat);
    if (!siteSpec || siteSpec.trim().length < 100) {
      missing.push("docs/site-spec.md no existe o esta vacio");
    }

    const siteMap = await fetchFile(ctx.githubRepo, "docs/site-map.md", pat);
    if (!siteMap || siteMap.trim().length < 50) {
      missing.push("docs/site-map.md no existe o esta vacio");
    }

    return { ready: missing.length === 0, missing };
  },

  detect: detectBlogBootstrap,

  installSteps: [
    {
      kind: "agent",
      title: "Instalar estructura de blog (rutas, MDX, sitemap, catalog-schemas)",
      type: "AI",
      prompt: `Instala la infraestructura de blog en este proyecto Next.js. Lee CLAUDE.md y DESIGN.md primero.

CONTRATO (no negociable):
- Contenido MDX en: ${BLOG_CONTENT_DIR}/{slug}.mdx
- Imagenes de portada en: public/blog/{slug}/portada.webp
- Frontmatter obligatorio:
${FRONTMATTER_SCHEMA_DOC}

PASOS:
1. Detectar el route group del sitio (busca app/(es)/ o app/ o src/app/).
   Usar el MISMO route group que ya usa el sitio.
2. Crear la pagina de lista: {routeGroup}/blog/page.tsx
3. Crear la pagina de articulo: {routeGroup}/blog/[slug]/page.tsx
4. Crear el directorio ${BLOG_CONTENT_DIR}/ con un .gitkeep
5. Configurar MDX si el proyecto no lo tiene (@next/mdx o contentlayer)
6. Agregar /blog al sitemap (app/sitemap.ts o equivalente)
7. Agregar a docs/catalog-schemas.md:

${CATALOG_SECTION_TEMPLATE}

NO HACER:
- No crear articulos de ejemplo (solo la estructura)
- No modificar el diseno existente del sitio
- No instalar paquetes nuevos sin verificar que el proyecto no los tenga ya
- No tocar rutas que no sean /blog`,
    },
    {
      kind: "review",
      title: "Revisar estructura y aprobar",
      type: "HM",
      humanReason: "Verificar que la estructura de blog es compatible con el diseno del sitio.",
    },
  ],

  async verify(ctx: PackageContext): Promise<VerifyResult> {
    const issues: string[] = [];
    const detection = await detectBlogBootstrap(ctx);
    if (!detection.installed) {
      issues.push(`detect fallo: ${detection.details}`);
    }
    return { passed: issues.length === 0, issues };
  },
};
