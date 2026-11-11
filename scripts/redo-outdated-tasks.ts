#!/usr/bin/env npx tsx
/**
 * Batch redo: re-decomposes tasks with outdated or missing generatorVersion.
 *
 * Finds all tasks in ACTIVE/PLANNING plans that:
 * - Have generatorVersion !== current DECOMPOSER_VERSION
 * - OR have no generatorVersion (created before versioning)
 * - AND are NOT already DONE or VOIDED
 *
 * For each: deletes existing steps + runs, resets to PLANNING, re-enqueues decomposition.
 *
 * USO:
 *   npx tsx scripts/redo-outdated-tasks.ts                    # dry-run (all clients)
 *   npx tsx scripts/redo-outdated-tasks.ts --apply            # apply (all clients)
 *   npx tsx scripts/redo-outdated-tasks.ts --client="Quimica" # filter by client name
 *   npx tsx scripts/redo-outdated-tasks.ts --wp-only          # only WordPress sites
 *   npx tsx scripts/redo-outdated-tasks.ts --wp-only --apply  # apply for WP only
 */

import { PrismaClient } from "@prisma/client";

const CURRENT_VERSION = "2026-11-11-v1";

async function main() {
  const dryRun = !process.argv.includes("--apply");
  const wpOnly = process.argv.includes("--wp-only");
  const clientFilter = process.argv.find((a) => a.startsWith("--client="))?.replace("--client=", "") ?? null;

  if (dryRun) console.log("🔍 DRY RUN — usa --apply para ejecutar\n");

  const prisma = new PrismaClient();

  try {
    const tasks = await prisma.planTask.findMany({
      where: {
        status: { notIn: ["DONE", "VOIDED"] },
        plan: { status: { in: ["PLANNING", "ACTIVE", "IN_REVIEW"] } },
        OR: [
          { generatorVersion: null },
          { generatorVersion: { not: CURRENT_VERSION } },
        ],
        ...(wpOnly ? { site: { platform: { in: ["WORDPRESS", "MIGRACION"] } } } : {}),
        ...(clientFilter ? {
          plan: {
            status: { in: ["PLANNING", "ACTIVE", "IN_REVIEW"] },
            client: { name: { contains: clientFilter, mode: "insensitive" as const } },
          },
        } : {}),
      },
      include: {
        plan: { select: { month: true, status: true, client: { select: { name: true, id: true } } } },
        site: { select: { platform: true } },
        _count: { select: { steps: true, runs: true } },
      },
      orderBy: { plan: { month: "desc" } },
    });

    console.log(`Encontradas ${tasks.length} tareas con reglas obsoletas (version ≠ ${CURRENT_VERSION}).\n`);

    let redone = 0;

    for (const task of tasks) {
      const platform = task.site.platform ?? "?";
      const label = `${task.plan.client.name} [${task.plan.month}] (${platform}) "${task.title.slice(0, 60)}"`;
      const version = task.generatorVersion ?? "sin versión";

      console.log(`  ${label}`);
      console.log(`    status=${task.status} | version=${version} | steps=${task._count.steps} | runs=${task._count.runs}`);

      if (!dryRun) {
        // Delete existing steps and runs
        await prisma.taskRun.deleteMany({ where: { taskId: task.id } });
        await prisma.planStep.deleteMany({ where: { taskId: task.id } });

        // Reset task to PLANNING
        await prisma.planTask.update({
          where: { id: task.id },
          data: {
            status: "PLANNING",
            failureReason: null,
            generatorVersion: null,
            commitShas: [],
          },
        });

        // Re-enqueue decomposition
        const { decomposeQueue } = await import("../src/server/jobs/queues");
        await decomposeQueue.add("task:decompose", {
          taskId: task.id,
          clientId: task.plan.client.id,
          candidateId: task.sourceCandidateId ?? "batch-redo",
        });

        console.log(`    → REHECHO (pasos eliminados, re-encolado)`);
      }

      redone++;
    }

    console.log(`\n─── ${redone} tareas ${dryRun ? "necesitan rehacer" : "rehechas"} ───`);

    if (dryRun && redone > 0) {
      console.log(`\nPara aplicar: npx tsx scripts/redo-outdated-tasks.ts --apply${wpOnly ? " --wp-only" : ""}${clientFilter ? ` --client="${clientFilter}"` : ""}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
