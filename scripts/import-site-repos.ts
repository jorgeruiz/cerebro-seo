/**
 * Importa githubRepo y vercelProjectId desde un JSON exportado de Constructor.
 *
 * Formato del JSON:
 * [{ "notionClientId": "abc123", "githubRepoUrl": "https://github.com/owner/name", "vercelProjectId": "prj_xxx" }]
 *
 * Uso:
 *   npx tsx scripts/import-site-repos.ts data.json
 *   npx tsx scripts/import-site-repos.ts data.json --dry-run
 */

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface ImportEntry {
  notionClientId: string;
  githubRepoUrl: string;
  vercelProjectId?: string;
}

function parseGithubRepo(url: string): string | null {
  // "https://github.com/owner/name" or "https://github.com/owner/name.git"
  const match = url.match(/github\.com\/([^/]+\/[^/.]+)/);
  return match ? match[1] : null;
}

async function main() {
  const args = process.argv.slice(2);
  const jsonPath = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");

  if (!jsonPath) {
    console.error("Uso: npx tsx scripts/import-site-repos.ts <archivo.json> [--dry-run]");
    process.exit(1);
  }

  const raw = readFileSync(jsonPath, "utf-8");
  const entries = JSON.parse(raw) as ImportEntry[];

  console.log(`📦 ${entries.length} entries en el JSON`);
  if (dryRun) console.log("🔍 Modo --dry-run: no se harán cambios\n");

  let matched = 0;
  let notFound = 0;
  let ambiguous = 0;
  let noRepo = 0;

  for (const entry of entries) {
    const notionId = entry.notionClientId.replace(/-/g, "");
    const githubRepo = parseGithubRepo(entry.githubRepoUrl);

    if (!githubRepo) {
      console.log(`  ⚠ ${entry.notionClientId}: URL inválida "${entry.githubRepoUrl}"`);
      noRepo++;
      continue;
    }

    const client = await prisma.client.findUnique({
      where: { cerebroClientId: notionId },
      include: { sites: { take: 2 } },
    });

    if (!client) {
      console.log(`  ✗ ${entry.notionClientId}: cliente no encontrado en BD`);
      notFound++;
      continue;
    }

    if (client.sites.length === 0) {
      console.log(`  ✗ ${client.name}: no tiene sites`);
      notFound++;
      continue;
    }

    if (client.sites.length > 1) {
      console.log(`  ⚠ ${client.name}: ${client.sites.length} sites — asignando al primero`);
      ambiguous++;
    }

    const site = client.sites[0];
    console.log(`  ✓ ${client.name} → ${githubRepo}${entry.vercelProjectId ? ` (vercel: ${entry.vercelProjectId})` : ""}`);

    if (!dryRun) {
      await prisma.site.update({
        where: { id: site.id },
        data: {
          githubRepo,
          vercelProjectId: entry.vercelProjectId ?? null,
        },
      });
    }

    matched++;
  }

  console.log(`\n📊 Resultado: ${matched} matched, ${notFound} not found, ${ambiguous} ambiguous, ${noRepo} no repo`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
