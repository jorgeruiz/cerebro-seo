/**
 * Importa githubRepo y vercelProjectId desde un JSON de proyectos.
 *
 * Soporta dos formatos de JSON:
 *   Constructor: [{ "notionClientId": "abc123", "githubRepoUrl": "https://..." }]
 *   site-repos:  [{ "id": "abc123", "name": "Foo", "github_repo_url": "https://..." }]
 *
 * Match por cerebroClientId primero, luego fallback a nombre (case-insensitive).
 *
 * Uso:
 *   npx tsx scripts/import-site-repos.ts data.json
 *   npx tsx scripts/import-site-repos.ts data.json --dry-run
 */

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface NormalizedEntry {
  notionId: string | null;
  name: string | null;
  githubRepoUrl: string;
  vercelProjectId?: string;
}

function parseGithubRepo(url: string): string | null {
  const match = url.match(/github\.com\/([^/]+\/[^/.]+)/);
  return match ? match[1] : null;
}

function normalizeEntries(raw: unknown[]): NormalizedEntry[] {
  return raw.map((entry) => {
    const e = entry as Record<string, unknown>;
    return {
      notionId: (e.notionClientId as string) ?? (e.id as string) ?? null,
      name: (e.name as string) ?? null,
      githubRepoUrl: (e.githubRepoUrl as string) ?? (e.github_repo_url as string) ?? "",
      vercelProjectId: (e.vercelProjectId as string) ?? undefined,
    };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const jsonPath = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");

  if (!jsonPath) {
    console.error("Uso: npx tsx scripts/import-site-repos.ts <archivo.json> [--dry-run]");
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(jsonPath, "utf-8")) as unknown[];
  const entries = normalizeEntries(raw);

  console.log(`📦 ${entries.length} entries en el JSON`);
  if (dryRun) console.log("🔍 Modo --dry-run: no se harán cambios\n");

  // Pre-load all clients for name matching
  const allClients = await prisma.client.findMany({
    include: { sites: { take: 2 } },
  });
  const byNotionId = new Map(allClients.map((c) => [c.cerebroClientId, c]));
  const byNameLower = new Map(allClients.map((c) => [c.name.toLowerCase().trim(), c]));

  let matched = 0;
  let notFound = 0;
  let ambiguous = 0;
  let noRepo = 0;
  let skipped = 0;

  for (const entry of entries) {
    const githubRepo = parseGithubRepo(entry.githubRepoUrl);

    if (!githubRepo) {
      console.log(`  ⚠ ${entry.name ?? entry.notionId}: URL inválida "${entry.githubRepoUrl}"`);
      noRepo++;
      continue;
    }

    // Match: try cerebroClientId first, then name
    let client = entry.notionId
      ? byNotionId.get(entry.notionId.replace(/-/g, "")) ?? null
      : null;
    let matchType = "id";

    if (!client && entry.name) {
      client = byNameLower.get(entry.name.toLowerCase().trim()) ?? null;
      if (client) matchType = "exact-name";

      // Partial name match fallback
      if (!client) {
        const key = entry.name.toLowerCase().trim();
        const partial = Array.from(byNameLower.entries()).find(
          ([k]) => k.includes(key) || key.includes(k)
        );
        if (partial) {
          client = partial[1];
          matchType = "~partial-name";
        }
      }
    }

    if (!client) {
      console.log(`  ✗ ${entry.name ?? entry.notionId}: no encontrado en BD`);
      notFound++;
      continue;
    }

    if (client.sites.length === 0) {
      console.log(`  ✗ ${client.name}: no tiene sites`);
      notFound++;
      continue;
    }

    if (client.sites.length > 1) {
      ambiguous++;
    }

    const site = client.sites[0];

    // Skip if already has the same repo
    if (site.githubRepo === githubRepo) {
      console.log(`  = ${client.name} → ${githubRepo} (already set, skip)`);
      skipped++;
      continue;
    }

    const prevRepo = site.githubRepo ?? "-";
    console.log(
      `  ✓ ${client.name} [${matchType}] → ${githubRepo}` +
        (prevRepo !== "-" ? ` (was: ${prevRepo})` : "") +
        (client.sites.length > 1 ? ` ⚠ ${client.sites.length} sites` : "")
    );

    if (!dryRun) {
      await prisma.site.update({
        where: { id: site.id },
        data: {
          githubRepo,
          vercelProjectId: entry.vercelProjectId ?? site.vercelProjectId,
        },
      });
    }

    matched++;
  }

  console.log(
    `\n📊 Resultado: ${matched} updated, ${skipped} skipped (same), ${notFound} not found, ${ambiguous} ambiguous, ${noRepo} invalid URL`
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
