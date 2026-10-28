#!/usr/bin/env npx tsx
/**
 * Recalcula task.mode desde los pasos reales para planes activos.
 *
 * USO:
 *   npx tsx scripts/recalc-task-modes.ts          # dry-run
 *   npx tsx scripts/recalc-task-modes.ts --apply   # guardar cambios
 */

import { PrismaClient } from "@prisma/client";

function resolveTaskMode(steps: Array<{ type: string }>): "AI" | "HYBRID" | "HUMAN" {
  if (steps.length === 0) return "HUMAN";
  const hasAI = steps.some((s) => s.type === "AI");
  const hasHuman = steps.some((s) => s.type === "HUMAN");
  if (hasAI && hasHuman) return "HYBRID";
  if (hasAI) return "AI";
  return "HUMAN";
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  if (dryRun) {
    console.log("🔍 DRY RUN — no se harán cambios. Usa --apply para guardar.\n");
  }

  const prisma = new PrismaClient();

  try {
    const tasks = await prisma.planTask.findMany({
      where: {
        plan: { status: { in: ["PLANNING", "ACTIVE", "IN_REVIEW"] } },
        status: { notIn: ["DONE", "VOIDED"] },
      },
      include: {
        steps: { select: { type: true }, orderBy: { order: "asc" } },
        plan: { select: { month: true, client: { select: { name: true } } } },
      },
    });

    console.log(`Encontradas ${tasks.length} tareas en planes activos.\n`);

    let changed = 0;

    for (const task of tasks) {
      const derived = resolveTaskMode(task.steps);
      const label = `${task.plan.client.name} [${task.plan.month}] "${task.title}"`;

      if (derived !== task.mode) {
        console.log(`🔄 ${label}: ${task.mode} → ${derived} (${task.steps.length} pasos: ${task.steps.map((s) => s.type).join(",")})`);
        if (!dryRun) {
          await prisma.planTask.update({
            where: { id: task.id },
            data: { mode: derived, modeReason: `Recalculado desde ${task.steps.length} pasos` },
          });
        }
        changed++;
      } else {
        console.log(`  ✅ ${label}: ${task.mode} (correcto)`);
      }
    }

    console.log(`\n─── Resultado: ${changed} tareas ${dryRun ? "necesitan" : ""} cambio de ${tasks.length} total ───`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
