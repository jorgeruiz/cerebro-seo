/**
 * POST /api/admin/fix-plan-routes?planId=xxx
 *
 * Admin-only endpoint that derives changedRoutes from GitHub commit file diffs
 * and writes them into TaskRun records for a given plan.
 *
 * Protected by: ADMIN session OR ADMIN_SECRET query param.
 *
 * Usage:
 *   curl -X POST "https://seo.clicksociety.mx/api/admin/fix-plan-routes?planId=xxx&secret=<ADMIN_SECRET>"
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

function fileToRoute(filePath: string): string | null {
  const blogMatch = filePath.match(/^content\/blog\/(.+)\.mdx$/);
  if (blogMatch) return `/blog/${blogMatch[1]}`;

  const appMatch = filePath.match(/^app\/(?:\([^)]+\)\/)?(.+)\/page\.[jt]sx?$/);
  if (appMatch) return `/${appMatch[1]}`;

  const srcAppMatch = filePath.match(/^src\/app\/(?:\([^)]+\)\/)?(.+)\/page\.[jt]sx?$/);
  if (srcAppMatch) return `/${srcAppMatch[1]}`;

  return null;
}

async function ghFetch(path: string, pat: string) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status} ${await res.text().then(t => t.slice(0, 100))}`);
  return res.json();
}

export async function POST(req: NextRequest) {
  // Auth: ADMIN session or ADMIN_SECRET query param
  const secret = req.nextUrl.searchParams.get("secret");
  const adminSecret = process.env.ADMIN_SECRET;

  if (!adminSecret || secret !== adminSecret) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const planId = req.nextUrl.searchParams.get("planId");
  if (!planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });

  const pat = process.env.GITHUB_PAT_CLIENT_REPOS;
  if (!pat) return NextResponse.json({ error: "GITHUB_PAT_CLIENT_REPOS not set" }, { status: 500 });

  const plan = await prisma.monthlyPlan.findUnique({
    where: { id: planId },
    include: {
      tasks: {
        include: {
          runs: { where: { status: "SUCCEEDED" }, select: { id: true, changedRoutes: true } },
        },
      },
    },
  });

  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  if (!plan.branchName) return NextResponse.json({ error: "Plan has no branchName" }, { status: 400 });

  const site = await prisma.site.findFirst({
    where: { client: { monthlyPlans: { some: { id: planId } } } },
    select: { githubRepo: true, url: true },
  });

  if (!site?.githubRepo) return NextResponse.json({ error: "No githubRepo on site" }, { status: 400 });

  const repo = site.githubRepo;
  const branch = plan.branchName;
  const log: string[] = [];

  log.push(`Plan: ${planId} | Branch: ${branch} | Repo: ${repo}`);

  // 1. Get commits in plan branch (compare vs main/default)
  const defaultBranch = (await prisma.site.findFirst({
    where: { client: { monthlyPlans: { some: { id: planId } } } },
    select: { defaultBranch: true },
  }))?.defaultBranch ?? "main";

  const compareData: { commits: { sha: string; commit: { message: string } }[] } = await ghFetch(
    `/repos/${repo}/compare/${defaultBranch}...${encodeURIComponent(branch)}`,
    pat
  ).catch(() => ({ commits: [] }));

  // Also try PR commits if plan has a PR number
  let prCommits: { sha: string; commit: { message: string } }[] = [];
  if (plan.prNumber) {
    prCommits = await ghFetch(`/repos/${repo}/pulls/${plan.prNumber}/commits?per_page=100`, pat)
      .catch(() => []);
  }

  const seen = new Set<string>();
  const allCommits: { sha: string; commit: { message: string } }[] = [];
  for (const c of [...(compareData.commits ?? []), ...prCommits]) {
    if (!seen.has(c.sha)) { seen.add(c.sha); allCommits.push(c); }
  }

  log.push(`Found ${allCommits.length} commits`);

  // 2. Build taskId → routes map
  const taskRoutes: Record<string, Set<string>> = {};

  for (const commit of allCommits) {
    const msg = commit.commit.message;
    const taskMatch = msg.match(/\[task:([a-z0-9]+)\]/);
    if (!taskMatch) continue;
    const taskId = taskMatch[1];

    const commitData: { files?: { filename: string; status: string }[] } = await ghFetch(
      `/repos/${repo}/commits/${commit.sha}`,
      pat
    ).catch(() => ({ files: [] }));

    for (const file of commitData.files ?? []) {
      if (file.status === "removed") continue;
      const route = fileToRoute(file.filename);
      if (!route) continue;
      if (!taskRoutes[taskId]) taskRoutes[taskId] = new Set();
      taskRoutes[taskId].add(route);
    }
  }

  log.push(`Derived routes per task:`);
  for (const [tid, routes] of Object.entries(taskRoutes)) {
    log.push(`  ${tid.slice(0, 12)}: ${Array.from(routes).join(", ")}`);
  }

  // 3. Update TaskRun.changedRoutes
  const updates: { runId: string; old: string[]; new: string[] }[] = [];

  for (const task of plan.tasks) {
    // Match by full ID or by prefix (for old 8-char commits)
    const routes = taskRoutes[task.id] ?? Object.entries(taskRoutes).find(([k]) => task.id.startsWith(k))?.[1];
    if (!routes || routes.size === 0) continue;

    for (const run of task.runs) {
      const existing = run.changedRoutes;
      const merged = Array.from(new Set([...existing, ...Array.from(routes)]));
      if (merged.length === existing.length && merged.every(r => existing.includes(r))) {
        log.push(`  Run ${run.id.slice(0, 8)}: already up to date (${existing.join(", ")})`);
        continue;
      }
      await prisma.taskRun.update({ where: { id: run.id }, data: { changedRoutes: merged } });
      updates.push({ runId: run.id, old: existing, new: merged });
      log.push(`  Run ${run.id.slice(0, 8)}: ${existing.join(",") || "(empty)"} → ${merged.join(", ")}`);
    }
  }

  // 4. HTTP check production URLs
  const httpResults: { route: string; status: number | string }[] = [];
  if (site.url) {
    const baseUrl = site.url.startsWith("http") ? site.url.replace(/\/$/, "") : `https://${site.url}`;
    const allRoutes = Array.from(new Set(Object.values(taskRoutes).flatMap(s => Array.from(s))));
    log.push(`\nHTTP check (${baseUrl}):`);
    for (const route of allRoutes) {
      try {
        const r = await fetch(`${baseUrl}${route}`, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(10_000) });
        httpResults.push({ route, status: r.status });
        log.push(`  ${r.ok ? "✅" : "❌"} ${r.status} ${route}`);
      } catch (e) {
        httpResults.push({ route, status: "ERROR" });
        log.push(`  ❌ ERROR ${route}: ${(e as Error).message}`);
      }
    }
  }

  return NextResponse.json({ ok: true, updates: updates.length, httpResults, log });
}
