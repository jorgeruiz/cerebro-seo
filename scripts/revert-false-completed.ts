/**
 * Revert falsely completed tasks (page_id=0) to FAILED.
 *
 * Usage:
 *   npx tsx scripts/revert-false-completed.ts --plan=<planId>  # dry-run
 *   npx tsx scripts/revert-false-completed.ts --plan=<planId> --apply
 *
 * Finds tasks marked DONE with SEO stagedChange where page_id=0,
 * and reverts them to FAILED with reason.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const planArg = process.argv.find((a) => a.startsWith("--plan="));
  const apply = process.argv.includes("--apply");

  if (!planArg) {
    console.log("Usage: npx tsx scripts/revert-false-completed.ts --plan=<planId> [--apply]");
    process.exit(1);
  }

  const planId = planArg.replace("--plan=", "");
  console.log(`\n=== Revert False Completed (${apply ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`Plan: ${planId}\n`);

  const tasks = await prisma.planTask.findMany({
    where: { planId, status: "DONE" },
    include: { steps: { select: { id: true, stagedChange: true } } },
  });

  let reverted = 0;
  for (const task of tasks) {
    for (const step of task.steps) {
      const sc = step.stagedChange as { type?: string; page_id?: number } | null;
      if (sc?.type === "seo" && (sc.page_id === 0 || sc.page_id === undefined)) {
        console.log(`  ${task.title} → page_id=${sc.page_id ?? "undefined"}`);
        if (apply) {
          await prisma.planTask.update({
            where: { id: task.id },
            data: {
              status: "FAILED",
              completedAt: null,
              failureReason: "Revertido: page_id=0, metas no se aplicaron en el sitio",
            },
          });
        }
        reverted++;
        break;
      }
    }
  }

  console.log(`\nReverted: ${reverted}/${tasks.length} tasks`);
  if (!apply && reverted > 0) console.log("Run with --apply to apply changes.");

  await prisma.$disconnect();
}

main().catch(console.error);
