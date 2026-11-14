/**
 * Blog Bootstrap Package — enables create_blog and refresh_content for Next.js sites.
 *
 * Installs: blog routes, MDX support, sitemap entries, catalog-schemas ## Blog section.
 * Detection: heading `## Blog` in catalog-schemas.md AND /blog route exists in repo.
 */

import type { PackageDefinition, PackageContext, PreflightResult, DetectResult, VerifyResult } from "./index";

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
  const headers: Record<string, string> = { Accept: "application/json" };
  if (pat) headers.Authorization = `Bearer ${pat}`;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      headers, method: "HEAD", signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch { return false; }
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

    // Requires: repo connected + memory files (site-spec, site-map, site-state)
    if (!ctx.githubRepo) {
      missing.push("Repositorio GitHub no conectado");
      return { ready: false, missing };
    }

    const siteSpec = await fetchFile(ctx.githubRepo, "docs/site-spec.md", pat);
    if (!siteSpec || siteSpec.trim().length < 100) {
      missing.push("docs/site-spec.md no existe o está vacío");
    }

    const siteMap = await fetchFile(ctx.githubRepo, "docs/site-map.md", pat);
    if (!siteMap || siteMap.trim().length < 50) {
      missing.push("docs/site-map.md no existe o está vacío");
    }

    return { ready: missing.length === 0, missing };
  },

  async detect(ctx: PackageContext): Promise<DetectResult> {
    const pat = ctx.pat ?? process.env.GITHUB_PAT_CLIENT_REPOS;

    // Check 1: catalog-schemas.md has ## Blog heading with Estado: Implementado
    const catalogSchemas = await fetchFile(ctx.githubRepo, "docs/catalog-schemas.md", pat);
    if (!catalogSchemas) {
      return { installed: false, details: "catalog-schemas.md no existe" };
    }

    const headings = catalogSchemas.match(/^##\s+.+$/gm) ?? [];
    const blogHeading = headings.find((h) => /^##\s+Blog\s*(?:$|[—\-:(])/i.test(h));
    if (!blogHeading) {
      return { installed: false, details: "catalog-schemas.md no tiene sección ## Blog" };
    }

    // Check for "No implementado" marker
    const blogSection = catalogSchemas.split(/^##\s/m).find((s) => /^Blog\s/i.test(s)) ?? "";
    if (/no\s*implementado|pendiente/i.test(blogSection.slice(0, 200))) {
      return { installed: false, details: "## Blog marcado como no implementado" };
    }

    // Check 2: /blog route exists (app/blog/page.tsx or app/(es)/blog/page.tsx)
    const blogRouteExists = await fileExists(ctx.githubRepo, "app/blog/page.tsx", pat)
      || await fileExists(ctx.githubRepo, "app/(es)/blog/page.tsx", pat)
      || await fileExists(ctx.githubRepo, "src/app/blog/page.tsx", pat)
      || await fileExists(ctx.githubRepo, "src/app/(es)/blog/page.tsx", pat);

    if (!blogRouteExists) {
      return { installed: false, details: "Ruta /blog no existe en el repo" };
    }

    return { installed: true, version: "1" };
  },

  installSteps: [
    {
      kind: "agent",
      title: "Instalar estructura de blog (rutas, MDX, sitemap, catalog-schemas)",
      type: "AI",
      prompt: `Instala la infraestructura de blog en este proyecto Next.js. Lee CLAUDE.md y DESIGN.md primero.

ALCANCE:
1. Crear app/blog/page.tsx (o app/(es)/blog/page.tsx según el route group del sitio) — lista de artículos
2. Crear app/blog/[slug]/page.tsx — página individual de artículo
3. Crear content/blog/ directorio para archivos MDX
4. Configurar MDX: next.config con @next/mdx o contentlayer si ya lo usa el proyecto
5. Agregar /blog al sitemap (app/sitemap.ts)
6. Actualizar docs/catalog-schemas.md: agregar sección ## Blog con el schema del frontmatter

NO HACER:
- No crear artículos de ejemplo (solo la estructura)
- No modificar el diseño existente del sitio
- No instalar paquetes nuevos sin verificar que el proyecto no los tenga ya
- No tocar rutas que no sean /blog

VERIFICACIÓN: el build debe pasar y /blog debe responder en el preview.`,
    },
    {
      kind: "review",
      title: "Revisar estructura y aprobar",
      type: "HM",
      humanReason: "Verificar que la estructura de blog es compatible con el diseño del sitio.",
    },
  ],

  async verify(ctx: PackageContext): Promise<VerifyResult> {
    const issues: string[] = [];
    const pat = ctx.pat ?? process.env.GITHUB_PAT_CLIENT_REPOS;

    // Re-run detect
    const detection = await blogBootstrap.detect(ctx);
    if (!detection.installed) {
      issues.push(`detect falló: ${detection.details}`);
    }

    // Check that catalog-schemas has Estado: Implementado
    const catalogSchemas = await fetchFile(ctx.githubRepo, "docs/catalog-schemas.md", pat);
    if (catalogSchemas) {
      const blogSection = catalogSchemas.split(/^##\s/m).find((s) => /^Blog\s/i.test(s)) ?? "";
      if (!/implementado/i.test(blogSection.slice(0, 200))) {
        issues.push("## Blog no tiene **Estado:** Implementado");
      }
    }

    return { passed: issues.length === 0, issues };
  },
};
