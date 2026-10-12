export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { acquirePlanLock, acquireRepoLock } from "@/worker/plan-lock";
import { redis } from "@/lib/redis";

/**
 * POST /api/terminal/open
 * Body: { planId: string, taskId?: string }
 *
 * Acquires BOTH locks for the entire terminal session:
 * - Plan lock: prevents task AI execution on this plan
 * - Repo lock: prevents preflight/other operations on the shared workspace
 *
 * Both locks auto-renew via their internal timers (every 5 min, TTL 15 min).
 * Lock holders are stored in Redis so handleClose can release them.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Solo administradores." }, { status: 403 });
  }

  const body = (await req.json()) as { planId?: string; taskId?: string };
  if (!body.planId) {
    return NextResponse.json({ error: "planId requerido." }, { status: 400 });
  }

  const plan = await prisma.monthlyPlan.findUnique({
    where: { id: body.planId },
    select: { id: true, status: true, branchName: true, clientId: true },
  });

  if (!plan) {
    return NextResponse.json({ error: "Plan no encontrado." }, { status: 404 });
  }

  // Find the site for repo lock
  const site = await prisma.site.findFirst({
    where: { clientId: plan.clientId },
    select: { githubRepo: true },
  });

  // Check for existing active terminal session
  const existing = await prisma.terminalSession.findFirst({
    where: { planId: body.planId, status: "ACTIVE" },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Ya hay una terminal activa para este plan.", sessionId: existing.id },
      { status: 409 }
    );
  }

  // Acquire plan lock
  const planLock = await acquirePlanLock(body.planId);
  if (!planLock.acquired) {
    return NextResponse.json(
      { error: "El plan está bloqueado por una tarea en ejecución." },
      { status: 409 }
    );
  }

  // Acquire repo lock (if site has a repo)
  let repoLockHolder: string | null = null;
  if (site?.githubRepo) {
    const repoLock = await acquireRepoLock(site.githubRepo);
    if (!repoLock.acquired) {
      await planLock.release();
      return NextResponse.json(
        { error: "El repositorio está ocupado por otra operación (preflight o tarea)." },
        { status: 409 }
      );
    }
    repoLockHolder = repoLock.holder!;
  }

  // Create terminal session
  const ts = await prisma.terminalSession.create({
    data: {
      planId: body.planId,
      taskId: body.taskId ?? null,
      startedById: session.user.email ?? "unknown",
      status: "ACTIVE",
    },
  });

  // Store lock holders for release in handleClose
  await redis.set(`terminal-lock-holder:${ts.id}`, planLock.holder!, "EX", 86400);
  if (repoLockHolder && site?.githubRepo) {
    await redis.set(`terminal-repo-lock-holder:${ts.id}`, repoLockHolder, "EX", 86400);
    await redis.set(`terminal-repo:${ts.id}`, site.githubRepo, "EX", 86400);
  }

  // Record initial activity
  await redis.set(`terminal-activity:${ts.id}`, Date.now().toString(), "EX", 3600);

  return NextResponse.json({ sessionId: ts.id });
}
