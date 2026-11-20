/**
 * Void a specific task by client name + title substring.
 *
 * Usage:
 *   npx tsx scripts/void-task.ts --client=ayrisa --match="home" --reason="CTR real 4.8%" [--apply]
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const clientArg = process.argv.find((a) => a.startsWith("--client="));
  const matchArg = process.argv.find((a) => a.startsWith("--match="));
  const reasonArg = process.argv.find((a) => a.startsWith("--reason="));
  const apply = process.argv.includes("--apply");

  if (!clientArg || !matchArg) {
    console.log("Usage: npx tsx scripts/void-task.ts --client=<name> --match=<title> --reason=<text> [--apply]");
    process.exit(1);
  }

  const clientSlug = clientArg.replace("--client=", "");
  const match = matchArg.replace("--match=", "").toLowerCase();
  const reason = reasonArg?.replace("--reason=", "") ?? "Anulada por script";

  const tasks = await prisma.planTask.findMany({
    where: {
      site: { client: { name: { contains: clientSlug, mode: "insensitive" } } },
      title: { contains: match, mode: "insensitive" },
      status: { notIn: ["VOIDED", "DONE"] },
    },
    select: { id: true, title: true, status: true },
  });

  console.log(`\nFound ${tasks.length} matching tasks:\n`);
  for (const t of tasks) {
    console.log(`  [${t.status}] ${t.title.slice(0, 80)}`);
    if (apply) {
      await prisma.planTask.update({
        where: { id: t.id },
        data: { status: "VOIDED", failureReason: reason },
      });
      console.log(`    → VOIDED: ${reason}`);
    }
  }

  if (!apply && tasks.length > 0) console.log("\nRun with --apply to void them.");
  await prisma.$disconnect();
}

main().catch(console.error);
