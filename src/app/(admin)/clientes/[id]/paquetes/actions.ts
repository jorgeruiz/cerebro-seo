"use server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPackageDefinition } from "@/lib/plan/packages";
import { decomposeQueue } from "@/server/jobs/queues";

/**
 * Create an install_package task in the current active plan.
 */
export async function actionAddPackageToPlan(
  clientId: string,
  siteId: string,
  packageId: string,
): Promise<{ ok: true; taskId: string } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") return { ok: false, error: "Solo administradores." };

  const pkg = getPackageDefinition(packageId);
  if (!pkg) return { ok: false, error: `Paquete "${packageId}" no encontrado.` };
  if (pkg.version === "0") return { ok: false, error: `Paquete "${packageId}" no está activo.` };

  // Find or create active plan for this month
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  let plan = await prisma.monthlyPlan.findFirst({
    where: { clientId, month: yearMonth, status: { in: ["PLANNING", "ACTIVE"] } },
    select: { id: true },
  });

  if (!plan) {
    plan = await prisma.monthlyPlan.create({
      data: {
        clientId,
        month: yearMonth,
        status: "PLANNING",
      },
      select: { id: true },
    });
  }

  // Check for duplicate
  const existing = await prisma.planTask.findFirst({
    where: {
      planId: plan.id,
      actionType: "install_package",
      status: { notIn: ["VOIDED", "FAILED"] },
      sourceRef: { path: ["packageId"], equals: packageId },
    },
    select: { id: true },
  });
  if (existing) return { ok: false, error: `Ya existe una tarea install_package(${packageId}) en el plan.` };

  const taskCount = await prisma.planTask.count({ where: { planId: plan.id } });

  const task = await prisma.planTask.create({
    data: {
      planId: plan.id,
      siteId,
      order: taskCount + 1,
      title: `Instalar paquete: ${pkg.name}`,
      objective: pkg.description,
      prompt: `install_package(${packageId})`,
      kind: "SETUP",
      category: "infrastructure",
      actionType: "install_package",
      priority: 10, // highest priority — blocks other tasks
      effort: "HIGH",
      mode: "HYBRID",
      status: "PLANNING",
      sourceRef: { packageId, module: "packages_ui" },
    },
  });

  // Enqueue decomposition
  await decomposeQueue.add("task:decompose", {
    taskId: task.id,
    clientId,
    candidateId: `package-${packageId}`,
  }, { jobId: `decompose-${task.id}` });

  // Update SitePackage to INSTALLING
  await prisma.sitePackage.upsert({
    where: { siteId_packageId: { siteId, packageId } },
    update: { status: "INSTALLING", installedBy: task.id },
    create: { siteId, packageId, status: "INSTALLING", installedBy: task.id },
  });

  return { ok: true, taskId: task.id };
}
