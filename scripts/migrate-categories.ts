/**
 * Migrate old PlanTask categories to the 6 catalog categories.
 *
 * Old: "meta", "blog", "landing", "schema", "enlazado", "optimizacion",
 *      "keyword", "contenido", "tecnico", "setup", "imagen", "media"
 * New: "technical", "content", "aeo_geo", "authority_local",
 *      "measurement_conversion", "infrastructure"
 *
 * Usage:
 *   npx tsx scripts/migrate-categories.ts          # dry-run
 *   npx tsx scripts/migrate-categories.ts --apply   # apply changes
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CATEGORY_MAP: Record<string, string> = {
  // Old → New
  meta: "technical",
  schema: "technical",
  enlazado: "content",
  optimizacion: "content",
  tecnico: "technical",
  blog: "content",
  landing: "content",
  contenido: "content",
  keyword: "technical",
  setup: "infrastructure",
  imagen: "content",
  media: "content",
};

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`\n=== Category Migration (${apply ? "APPLY" : "DRY-RUN"}) ===\n`);

  const tasks = await prisma.planTask.findMany({
    select: { id: true, category: true, title: true },
  });

  const counts: Record<string, number> = {};
  let toMigrate = 0;

  for (const task of tasks) {
    const mapped = CATEGORY_MAP[task.category];
    if (mapped && mapped !== task.category) {
      counts[`${task.category} → ${mapped}`] = (counts[`${task.category} → ${mapped}`] ?? 0) + 1;
      toMigrate++;
      if (apply) {
        await prisma.planTask.update({
          where: { id: task.id },
          data: { category: mapped },
        });
      }
    }
  }

  console.log(`Total tasks: ${tasks.length}`);
  console.log(`To migrate: ${toMigrate}\n`);
  for (const [key, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${count}`);
  }

  if (!apply && toMigrate > 0) {
    console.log("\nRun with --apply to apply changes.");
  }

  await prisma.$disconnect();
}

main().catch(console.error);
