#!/usr/bin/env npx tsx
/**
 * Normaliza headings en docs/catalog-schemas.md de clientes Next.js activos.
 *
 * Formato canónico:
 *   ## Blog
 *   **Estado:** Implementado
 *
 * Variantes que normaliza:
 *   "## Blog — Implementado" → "## Blog\n**Estado:** Implementado"
 *   "## Blog (listo)"        → "## Blog\n**Estado:** Implementado"
 *   "## Blog: activo"        → "## Blog\n**Estado:** Implementado"
 *
 * Aplica a: Blog, Landing Pages, Micrositios.
 *
 * USO:
 *   npx tsx scripts/normalize-catalog-schemas.ts          # dry-run
 *   npx tsx scripts/normalize-catalog-schemas.ts --apply   # commit changes
 */

import { PrismaClient } from "@prisma/client";
import {
  readGitHubFile,
  commitFiles,
} from "../src/lib/github-blog-publisher";

const SECTIONS = ["Blog", "Landing Pages", "Micrositios"];

// Pattern: ## SectionName followed by optional separator + status text
// Captures: (1) section name, (2) optional status suffix
const HEADING_PATTERNS = SECTIONS.map((name) => ({
  name,
  regex: new RegExp(
    `^(## ${name})\\s*(?:[—\\-:(]\\s*(.+?))?\\s*$`,
    "gm"
  ),
}));

function normalizeSchemas(content: string): { normalized: string; changes: string[] } {
  let result = content;
  const changes: string[] = [];

  for (const { name, regex } of HEADING_PATTERNS) {
    result = result.replace(regex, (_match, heading: string, suffix?: string) => {
      if (!suffix) return heading; // already canonical

      changes.push(`"${_match.trim()}" → "## ${name}" + **Estado:** line`);

      // Check if the suffix indicates "not implemented"
      const isNotImplemented = /no implementado|pendiente/i.test(suffix);
      const estado = isNotImplemented ? "No implementado" : "Implementado";

      return `## ${name}\n**Estado:** ${estado}`;
    });
  }

  return { normalized: result, changes };
}

async function main() {
  const dryRun = !process.argv.includes("--apply");

  if (dryRun) {
    console.log("🔍 DRY RUN — no se harán cambios. Usa --apply para commitear.\n");
  }

  const prisma = new PrismaClient();
  const pat = process.env.GITHUB_PAT_CLIENT_REPOS;
  if (!pat) {
    console.error("GITHUB_PAT_CLIENT_REPOS no configurado");
    process.exit(1);
  }

  try {
    // Find all Next.js sites with active clients
    const sites = await prisma.site.findMany({
      where: {
        platform: "NEXTJS",
        githubRepo: { not: null },
      },
      include: { client: { select: { name: true } } },
    });

    console.log(`Encontrados ${sites.length} sitios Next.js activos.\n`);

    const results: Array<{ site: string; status: string }> = [];

    for (const site of sites) {
      const label = `${site.client.name} (${site.githubRepo})`;
      const [owner, repo] = (site.githubRepo ?? "").split("/");
      if (!owner || !repo) {
        results.push({ site: label, status: "❌ githubRepo inválido" });
        continue;
      }

      try {
        const content = await readGitHubFile(owner, repo, "docs/catalog-schemas.md", pat, site.defaultBranch);

        if (!content) {
          results.push({ site: label, status: "📄 sin archivo catalog-schemas.md" });
          continue;
        }

        const { normalized, changes } = normalizeSchemas(content);

        if (changes.length === 0) {
          results.push({ site: label, status: "✅ ya normalizado" });
          continue;
        }

        if (dryRun) {
          results.push({ site: label, status: `🔄 ${changes.length} cambios: ${changes.join("; ")}` });
        } else {
          await commitFiles(
            owner,
            repo,
            site.defaultBranch,
            [{ path: "docs/catalog-schemas.md", content: normalized }],
            `chore: normalizar headings catalog-schemas.md [cerebro-seo]`,
            pat
          );
          results.push({ site: label, status: `✅ normalizado (${changes.length} cambios)` });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ site: label, status: `❌ ${msg.slice(0, 100)}` });
      }
    }

    console.log("\n─── Resultados ───");
    for (const r of results) {
      console.log(`${r.status}  ${r.site}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
