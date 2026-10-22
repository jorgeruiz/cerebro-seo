/**
 * fix-brainet-routes.ts
 *
 * Deriva changedRoutes de los archivos realmente commiteados en el PR #1 de Brainet
 * y los escribe en los PlanTaskRun correspondientes.
 *
 * Uso:
 *   DATABASE_URL="postgres://cerebro:CerebroClick2026%23@76.13.121.6:5432/cerebro" \
 *   GITHUB_PAT_CLIENT_REPOS="..." \
 *   npx tsx scripts/fix-brainet-routes.ts
 *
 * (Requiere que el puerto 5432 esté expuesto o que corras el script dentro del VPS/contenedor)
 *
 * Si no tienes acceso directo a la BD, copia el SQL generado y ejecútalo en pgWeb o
 * en el contenedor:  docker exec -it <cerebro-seo-container> npx tsx scripts/fix-brainet-routes.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PAT = process.env.GITHUB_PAT_CLIENT_REPOS!;
const REPO = "jorgeruiz/brainet";
const BRANCH = "plan/brainet-2026-10"; // rama original del plan

// ── Mapeo archivo → ruta en el sitio ──────────────────────────────────────────
function fileToRoute(filePath: string): string | null {
  // content/blog/slug.mdx → /blog/slug
  const blogMatch = filePath.match(/^content\/blog\/(.+)\.mdx$/);
  if (blogMatch) return `/blog/${blogMatch[1]}`;

  // app/(es)/ruta/page.tsx → /ruta  (strip route group)
  const appMatch = filePath.match(/^app\/(?:\([^)]+\)\/)?(.+)\/page\.tsx$/);
  if (appMatch) return `/${appMatch[1]}`;

  // src/app/ruta/page.tsx → /ruta
  const srcAppMatch = filePath.match(/^src\/app\/(?:\([^)]+\)\/)?(.+)\/page\.tsx$/);
  if (srcAppMatch) return `/${srcAppMatch[1]}`;

  return null;
}

// ── Fetch GitHub API ───────────────────────────────────────────────────────────
async function ghFetch(path: string) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${PAT}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status}`);
  return res.json();
}

async function main() {
  // 1. Get all commits in the plan branch vs main
  const commits: { sha: string; commit: { message: string } }[] = await ghFetch(
    `/repos/${REPO}/compare/main...${encodeURIComponent(BRANCH)}`
  ).then((c: any) => c.commits ?? []);

  console.log(`Found ${commits.length} commits in branch`);

  // Also include commits from merged PR #1
  const prCommits: { sha: string; commit: { message: string } }[] = await ghFetch(
    `/repos/${REPO}/pulls/1/commits?per_page=100`
  );
  const allCommits = [...prCommits, ...commits];

  // 2. Build taskId → files map from commit messages
  const taskFiles: Record<string, Set<string>> = {};

  for (const commit of allCommits) {
    const msg = commit.commit.message;
    const taskMatch = msg.match(/\[task:([a-z0-9]+)\]/);
    if (!taskMatch) continue;
    const taskPrefix = taskMatch[1]; // first 8 chars of task ID

    const filesData: { files: { filename: string; status: string }[] } = await ghFetch(
      `/repos/${REPO}/commits/${commit.sha}`
    );

    for (const file of filesData.files ?? []) {
      if (file.status === "removed") continue;
      const route = fileToRoute(file.filename);
      if (!route) continue;
      if (!taskFiles[taskPrefix]) taskFiles[taskPrefix] = new Set();
      taskFiles[taskPrefix].add(route);
    }
  }

  console.log("\nDerived routes per task prefix:");
  for (const [prefix, routes] of Object.entries(taskFiles)) {
    console.log(`  ${prefix}: ${Array.from(routes).join(", ")}`);
  }

  // 3. Find tasks in DB that match these prefixes
  for (const [prefix, routes] of Object.entries(taskFiles)) {
    const tasks = await prisma.planTask.findMany({
      where: { id: { startsWith: prefix } },
      include: {
        runs: { where: { status: "SUCCEEDED" }, select: { id: true, changedRoutes: true } },
        plan: { select: { branchName: true } },
      },
    });

    if (tasks.length === 0) {
      console.log(`\n⚠ No task found with prefix ${prefix}`);
      continue;
    }

    for (const task of tasks) {
      console.log(`\nTask ${task.id.slice(0, 8)} "${task.title.slice(0, 50)}"`);
      console.log(`  Plan branch: ${task.plan?.branchName}`);

      for (const run of task.runs) {
        const existing = run.changedRoutes;
        const newRoutes = Array.from(new Set([...existing, ...Array.from(routes)]));
        if (newRoutes.length === existing.length && newRoutes.every(r => existing.includes(r))) {
          console.log(`  Run ${run.id.slice(0, 8)}: already has routes ${existing.join(", ")}`);
          continue;
        }
        await prisma.taskRun.update({
          where: { id: run.id },
          data: { changedRoutes: newRoutes },
        });
        console.log(`  Run ${run.id.slice(0, 8)}: updated ${existing.join(",") || "(empty)"} → ${newRoutes.join(", ")}`);
      }
    }
  }

  // 4. Check production URLs
  const brainet_url = "https://www.brainet.pro";
  console.log("\n── HTTP check de producción ──────────────────────────────────");
  const allRoutes = Array.from(new Set(Object.values(taskFiles).flatMap(s => Array.from(s))));
  for (const route of allRoutes) {
    try {
      const res = await fetch(`${brainet_url}${route}`, { redirect: "follow", signal: AbortSignal.timeout(8000) });
      const icon = res.status === 200 ? "✅" : res.status < 400 ? "⚠ " : "❌";
      console.log(`  ${icon} ${res.status} ${brainet_url}${route}`);
    } catch (e) {
      console.log(`  ❌ ERROR ${brainet_url}${route}: ${(e as Error).message}`);
    }
  }

  console.log("\nDone.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
