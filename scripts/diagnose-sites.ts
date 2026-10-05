/**
 * Diagnostica sitios de clientes via GitHub API (sin clonar).
 *
 * Verificaciones:
 * - LOCKFILE_SYNC: compara deps de package.json vs package-lock.json
 * - MEMORY: existencia de docs/site-spec.md, site-map.md, site-state.md, catalog-schemas.md
 * - FRAMEWORK: verifica que Site.framework sea "nextjs"
 *
 * Uso:
 *   GITHUB_PAT_CLIENT_REPOS=ghp_xxx npx tsx scripts/diagnose-sites.ts
 *   GITHUB_PAT_CLIENT_REPOS=ghp_xxx npx tsx scripts/diagnose-sites.ts --check lockfile
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PAT = process.env.GITHUB_PAT_CLIENT_REPOS;
if (!PAT) {
  console.error("GITHUB_PAT_CLIENT_REPOS is required");
  process.exit(1);
}

const args = process.argv.slice(2);
const checkFilter = args.includes("--check")
  ? args[args.indexOf("--check") + 1]
  : null;

interface DiagResult {
  client: string;
  site: string;
  repo: string;
  lockfileSync: "OK" | "OUT_OF_SYNC" | "NO_LOCKFILE" | "ERROR";
  lockfileMissing: string[];
  memory: Record<string, "EXISTS" | "MISSING">;
  framework: string;
}

async function ghFetch(repo: string, path: string): Promise<Response> {
  return fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    headers: {
      Authorization: `Bearer ${PAT}`,
      Accept: "application/vnd.github.raw",
    },
  });
}

async function ghFetchJson(repo: string, path: string): Promise<unknown> {
  const res = await ghFetch(repo, path);
  if (!res.ok) return null;
  return res.json();
}

async function checkLockfileSync(
  repo: string
): Promise<{ status: "OK" | "OUT_OF_SYNC" | "NO_LOCKFILE" | "ERROR"; missing: string[] }> {
  try {
    const pkgJson = (await ghFetchJson(repo, "package.json")) as Record<string, unknown> | null;
    if (!pkgJson) return { status: "ERROR", missing: [] };

    const lockRes = await ghFetch(repo, "package-lock.json");
    if (!lockRes.ok) return { status: "NO_LOCKFILE", missing: [] };
    const lockJson = (await lockRes.json()) as Record<string, unknown>;

    const deps = {
      ...(pkgJson.dependencies as Record<string, string> ?? {}),
      ...(pkgJson.devDependencies as Record<string, string> ?? {}),
    };

    const packages = (lockJson.packages as Record<string, unknown>) ?? {};
    const missing: string[] = [];

    for (const name of Object.keys(deps)) {
      const key = `node_modules/${name}`;
      if (!packages[key]) {
        missing.push(name);
      }
    }

    return {
      status: missing.length > 0 ? "OUT_OF_SYNC" : "OK",
      missing,
    };
  } catch (err) {
    return { status: "ERROR", missing: [] };
  }
}

async function checkMemory(
  repo: string
): Promise<Record<string, "EXISTS" | "MISSING">> {
  const files = [
    "docs/site-spec.md",
    "docs/site-map.md",
    "docs/site-state.md",
    "docs/catalog-schemas.md",
  ];

  const result: Record<string, "EXISTS" | "MISSING"> = {};
  for (const file of files) {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${file}`, {
      headers: { Authorization: `Bearer ${PAT}` },
      method: "HEAD",
    });
    const key = file.split("/").pop()!.replace(".md", "");
    result[key] = res.ok ? "EXISTS" : "MISSING";
  }
  return result;
}

async function main() {
  const sites = await prisma.site.findMany({
    where: {
      githubRepo: { not: null },
      client: { status: "ACTIVE", services: { has: "seo" } },
    },
    include: { client: { select: { name: true } } },
  });

  if (sites.length === 0) {
    console.log("No hay sitios con githubRepo y servicio SEO activo.");
    await prisma.$disconnect();
    return;
  }

  console.log(`🔍 Diagnosticando ${sites.length} sitio(s)...\n`);

  const results: DiagResult[] = [];

  for (const site of sites) {
    const repo = site.githubRepo!;
    process.stdout.write(`  ${site.client.name} (${repo})...`);

    let lockfileSync: DiagResult["lockfileSync"] = "OK";
    let lockfileMissing: string[] = [];
    let memory: Record<string, "EXISTS" | "MISSING"> = {};

    if (!checkFilter || checkFilter === "lockfile") {
      const lockResult = await checkLockfileSync(repo);
      lockfileSync = lockResult.status;
      lockfileMissing = lockResult.missing;
    }

    if (!checkFilter || checkFilter === "memory") {
      memory = await checkMemory(repo);
    }

    results.push({
      client: site.client.name,
      site: site.url,
      repo,
      lockfileSync,
      lockfileMissing,
      memory,
      framework: site.framework ?? "unknown",
    });

    const icon =
      lockfileSync === "OK" ? "✅" : lockfileSync === "OUT_OF_SYNC" ? "❌" : "⚠️";
    console.log(` ${icon} lockfile:${lockfileSync}`);
  }

  // Print table
  console.log("\n" + "=".repeat(80));
  console.log("RESULTADO\n");

  console.log(
    "| Cliente | Repo | Lockfile | Missing | Memory | Framework |"
  );
  console.log("|---|---|---|---|---|---|");

  for (const r of results) {
    const memStatus = Object.values(r.memory).every((v) => v === "EXISTS")
      ? "FULL"
      : Object.entries(r.memory)
          .filter(([, v]) => v === "MISSING")
          .map(([k]) => k)
          .join(",") || "N/A";

    console.log(
      `| ${r.client} | ${r.repo} | ${r.lockfileSync} | ${r.lockfileMissing.length > 0 ? r.lockfileMissing.slice(0, 3).join(", ") + (r.lockfileMissing.length > 3 ? ` +${r.lockfileMissing.length - 3}` : "") : "-"} | ${memStatus} | ${r.framework} |`
    );
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
