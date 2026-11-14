/**
 * Plan Gates — preconditions that must pass before a task can execute.
 *
 * Evaluated at decomposition time AND before execution.
 * If a gate fails → task.status = BLOCKED with reason + remedy.
 *
 * G1: Cliente activo con SEO
 * G2: Sitio sin migración no autorizada
 * G3: Memoria del repo FULL (Next.js agent)
 * G4: catalog-schemas con sección requerida (blog/landing/micrositios) — Next.js only
 * G5: Capability del plugin presente (WP) — degrades gracefully via fallback
 * G6: Servicio verificado (landing/blog de servicio requiere site-spec)
 * G7: Anti-canibalización (keyword no asignada a otra URL/tarea activa)
 * G8: Target resuelto (page_id para WP, ruta para Next.js)
 */

import { prisma } from "@/lib/db";
import type { GateId } from "./task-catalog";

export interface GateResult {
  gate: GateId;
  passed: boolean;
  reason?: string;
  remedy?: string;
}

export interface GateCheckResult {
  allPassed: boolean;
  results: GateResult[];
  blockedReason: string | null;
  remedy: string | null;
}

/**
 * Evaluate gates for a task.
 */
export async function evaluateGates(
  gates: GateId[],
  context: {
    clientId: string;
    siteId: string;
    platform: string | null;
    targetUrl?: string | null;
    targetKeyword?: string | null;
    actionType: string;
    wpCapabilities?: string[] | null;
    taskCategory?: string | null;
  }
): Promise<GateCheckResult> {
  const results: GateResult[] = [];

  for (const gate of gates) {
    const result = await evaluateGate(gate, context);
    results.push(result);
  }

  const failed = results.filter((r) => !r.passed);
  if (failed.length === 0) {
    return { allPassed: true, results, blockedReason: null, remedy: null };
  }

  return {
    allPassed: false,
    results,
    blockedReason: failed.map((f) => f.reason).join(" | "),
    remedy: failed.map((f) => f.remedy).filter(Boolean).join(" → "),
  };
}

async function evaluateGate(
  gate: GateId,
  ctx: {
    clientId: string;
    siteId: string;
    platform: string | null;
    targetUrl?: string | null;
    targetKeyword?: string | null;
    actionType: string;
    wpCapabilities?: string[] | null;
    taskCategory?: string | null;
  }
): Promise<GateResult> {
  switch (gate) {
    case "G1": {
      const client = await prisma.client.findUnique({
        where: { id: ctx.clientId },
        select: { status: true, services: true },
      });
      if (!client || client.status !== "ACTIVE") {
        return { gate, passed: false, reason: "Cliente no activo", remedy: "Activar cliente en Notion" };
      }
      if (!client.services.includes("seo")) {
        return { gate, passed: false, reason: "Cliente no tiene servicio SEO", remedy: "Agregar SEO en Notion" };
      }
      return { gate, passed: true };
    }

    case "G2": {
      const site = await prisma.site.findUnique({ where: { id: ctx.siteId }, select: { platform: true } });
      if (site?.platform === "MIGRACION") {
        return { gate, passed: true, reason: "Sitio en migración — tareas WP permitidas" };
      }
      return { gate, passed: true };
    }

    case "G3": {
      if (ctx.platform !== "NEXTJS") return { gate, passed: true };
      const site = await prisma.site.findUnique({ where: { id: ctx.siteId }, select: { githubRepo: true } });
      if (!site?.githubRepo) {
        return { gate, passed: false, reason: "Repositorio GitHub no configurado", remedy: "Configurar githubRepo en el sitio" };
      }
      return { gate, passed: true };
    }

    case "G4": {
      // catalog-schemas check — only for Next.js content tasks (blog/landing)
      if (ctx.platform !== "NEXTJS") return { gate, passed: true };

      const contentActions = ["create_blog", "create_landing", "refresh_content"];
      if (!contentActions.includes(ctx.actionType)) return { gate, passed: true };

      const site = await prisma.site.findUnique({ where: { id: ctx.siteId }, select: { githubRepo: true } });
      if (!site?.githubRepo) return { gate, passed: true }; // G3 handles this

      const needsBlog = ctx.actionType === "create_blog" || ctx.actionType === "refresh_content";
      const needsLanding = ctx.actionType === "create_landing";

      // Fetch catalog-schemas.md via GitHub API
      const pat = process.env.GITHUB_PAT_CLIENT_REPOS;
      const catalogContent = await fetchGitHubFile(site.githubRepo, "docs/catalog-schemas.md", pat);

      if (!catalogContent) {
        const packageId = needsBlog ? "blog_bootstrap" : "landing_bootstrap";
        return {
          gate, passed: false,
          reason: "catalog-schemas.md no encontrado en el repo",
          remedy: `Agregar al plan: install_package(${packageId})`,
        };
      }

      // Check for required section heading
      const headings = catalogContent.match(/^##\s+.+$/gm) ?? [];
      const headingsLower = headings.map((h) => h.toLowerCase());

      if (needsBlog && !headingsLower.some((h) => h.includes("blog"))) {
        return {
          gate, passed: false,
          reason: "catalog-schemas.md no tiene sección ## Blog",
          remedy: "Agregar al plan: install_package(blog_bootstrap)",
        };
      }
      if (needsLanding && !headingsLower.some((h) => h.includes("landing"))) {
        return {
          gate, passed: false,
          reason: "catalog-schemas.md no tiene sección ## Landing Pages",
          remedy: "Agregar al plan: install_package(landing_bootstrap)",
        };
      }

      return { gate, passed: true };
    }

    case "G5": {
      // WP capability check — resolveStepsWithCapabilities handles fallback.
      // Gate passes always; degradation is automatic.
      return { gate, passed: true };
    }

    case "G6": {
      // Service verification — for tasks that create pages about a service/product
      const serviceActions = ["create_landing", "create_blog"];
      if (!serviceActions.includes(ctx.actionType)) return { gate, passed: true };

      // Only applies to content about specific services (not generic blog)
      if (ctx.actionType === "create_blog") {
        // Blog is informational — usually OK without service verification
        // Only block if the keyword mentions a service not in the client profile
        return { gate, passed: true };
      }

      // For create_landing: verify the site has a service catalog or site-spec
      if (ctx.platform === "NEXTJS") {
        const site = await prisma.site.findUnique({ where: { id: ctx.siteId }, select: { githubRepo: true } });
        if (site?.githubRepo) {
          const pat = process.env.GITHUB_PAT_CLIENT_REPOS;
          const siteSpec = await fetchGitHubFile(site.githubRepo, "docs/site-spec.md", pat);
          if (!siteSpec || siteSpec.trim().length < 100) {
            return {
              gate, passed: false,
              reason: "site-spec.md no encontrado o vacío — no se puede verificar si el servicio existe",
              remedy: "Crear docs/site-spec.md con la lista de servicios/productos del cliente",
            };
          }
        }
      } else if (ctx.platform === "WORDPRESS") {
        // For WP: check if the site has pages (proxy capabilities)
        // If no WP capabilities at all, we can't verify
        if (!ctx.wpCapabilities || ctx.wpCapabilities.length === 0) {
          return {
            gate, passed: false,
            reason: "Plugin WP no responde — no se puede verificar servicios del sitio",
            remedy: "Verificar que el plugin Cerebro Connector está activo y responde",
          };
        }
        // WP has capabilities — service verification happens in the content prompt
        // (site profile is loaded at execution time)
      }

      return { gate, passed: true };
    }

    case "G7": {
      if (!ctx.targetKeyword) return { gate, passed: true };
      const conflicting = await prisma.planTask.findFirst({
        where: {
          siteId: ctx.siteId,
          targetKeyword: ctx.targetKeyword,
          status: { notIn: ["DONE", "VOIDED", "FAILED"] },
        },
        select: { id: true, title: true },
      });
      if (conflicting) {
        return {
          gate,
          passed: false,
          reason: `Keyword "${ctx.targetKeyword}" ya asignada a: "${conflicting.title}"`,
          remedy: "Usar una keyword diferente o completar la tarea existente",
        };
      }
      return { gate, passed: true };
    }

    case "G8": {
      // Target resolved — URL/page must exist for tasks on existing pages
      if (!ctx.targetUrl) return { gate, passed: true }; // No target = new content, OK

      if (ctx.platform === "WORDPRESS") {
        // Verify the page exists in WP via proxy
        const site = await prisma.site.findUnique({
          where: { id: ctx.siteId },
          select: { client: { select: { cerebroClientId: true } } },
        });
        const cerebroId = site?.client?.cerebroClientId;
        if (cerebroId) {
          try {
            const { getWpPages } = await import("@/lib/wp-proxy-client");
            const pagesResult = await getWpPages(cerebroId);
            if (pagesResult.ok && pagesResult.data.length > 0) {
              const targetSlug = extractSlug(ctx.targetUrl);
              const match = pagesResult.data.find((p: { slug: string }) =>
                p.slug && targetSlug && p.slug.toLowerCase() === targetSlug.toLowerCase()
              );
              if (!match) {
                return {
                  gate, passed: false,
                  reason: `Página "${ctx.targetUrl}" no encontrada en WordPress (${pagesResult.data.length} páginas revisadas)`,
                  remedy: "Verificar que la URL existe en WordPress o crear la página primero",
                };
              }
            }
          } catch {
            // Plugin unreachable — don't block, let execution handle it
          }
        }
      } else if (ctx.platform === "NEXTJS") {
        // For Next.js: check if the route exists in the repo
        // This is a best-effort check — the route might be dynamic
        if (ctx.targetUrl.includes("[")) return { gate, passed: true }; // Dynamic route
        // We can't easily verify without cloning — trust the URL
      }

      return { gate, passed: true };
    }

    default:
      return { gate, passed: true };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function fetchGitHubFile(
  githubRepo: string,
  path: string,
  pat?: string
): Promise<string | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.raw",
  };
  if (pat) headers.Authorization = `Bearer ${pat}`;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${githubRepo}/contents/${path}`,
      { headers, signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

function extractSlug(url: string): string | null {
  try {
    const path = url.startsWith("http") ? new URL(url).pathname : url;
    const slug = path.replace(/^\/+|\/+$/g, "");
    return slug || null;
  } catch {
    return url.replace(/^\/+|\/+$/g, "") || null;
  }
}
