/**
 * Close stale TaskRuns that are RUNNING on tasks that are BLOCKED/FAILED/DONE.
 *
 * Usage:
 *   npx tsx scripts/close-stale-runs.ts           # dry-run
 *   npx tsx scripts/close-stale-runs.ts --apply   # close them
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`\n=== Close Stale Runs (${apply ? "APPLY" : "DRY-RUN"}) ===\n`);

  const staleRuns = await prisma.taskRun.findMany({
    where: {
      status: "RUNNING",
      task: { status: { in: ["BLOCKED", "FAILED", "DONE", "VOIDED", "WAITING_HUMAN"] } },
    },
    select: {
      id: true,
      startedAt: true,
      task: { select: { id: true, title: true, status: true } },
    },
  });

  console.log(`Found ${staleRuns.length} stale RUNNING runs:\n`);

  for (const run of staleRuns) {
    console.log(`  Run ${run.id.slice(0, 8)} | Task "${run.task.title.slice(0, 50)}" (${run.task.status}) | Started ${run.startedAt.toISOString().slice(0, 16)}`);
    if (apply) {
      await prisma.taskRun.update({
        where: { id: run.id },
        data: { status: "FAILED", logTail: "Cerrado por close-stale-runs script", finishedAt: new Date() },
      });
    }
  }

  if (!apply && staleRuns.length > 0) {
    console.log("\nRun with --apply to close them.");
  }
  if (apply && staleRuns.length > 0) {
    console.log(`\nClosed ${staleRuns.length} stale runs.`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
