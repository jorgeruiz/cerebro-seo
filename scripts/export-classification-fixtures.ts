/**
 * Export real task objectives from production as classification fixtures.
 *
 * Usage (in Easypanel console):
 *   DATABASE_URL="..." npx tsx scripts/export-classification-fixtures.ts
 *
 * Output: scripts/eval/production-fixtures.json
 */

import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();

async function main() {
  const tasks = await prisma.planTask.findMany({
    where: {
      status: { notIn: ["VOIDED"] },
    },
    select: {
      id: true,
      title: true,
      objective: true,
      actionType: true,
      category: true,
      site: { select: { platform: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 60,
  });

  console.log(`Found ${tasks.length} tasks`);

  const fixtures = tasks.map((t, i) => ({
    id: i + 1,
    title: t.title,
    objective: t.objective,
    platform: t.site?.platform ?? "WORDPRESS",
    expected: t.actionType ?? "other",
    status: "por_validar" as const,
    currentActionType: t.actionType,
    category: t.category,
  }));

  // Stats
  const byType = new Map<string, number>();
  for (const f of fixtures) {
    byType.set(f.expected, (byType.get(f.expected) ?? 0) + 1);
  }

  console.log("\nDistribución por actionType:");
  for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(25)} ${count}`);
  }

  const outPath = join(__dirname, "eval", "production-fixtures.json");
  writeFileSync(outPath, JSON.stringify(fixtures, null, 2));
  console.log(`\nExportados a: ${outPath}`);
  console.log("Edita el campo 'expected' para validar y cambia 'status' a 'validado'.");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
