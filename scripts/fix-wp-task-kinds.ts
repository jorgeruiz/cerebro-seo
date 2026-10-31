#!/usr/bin/env npx tsx
/**
 * Corrige el kind de tareas WP abiertas.
 *
 * En WordPress, kind=CODE no tiene sentido (no hay repo).
 * - Técnico/schema/enlazado interno que el plugin resuelve → kind=CONTENT
 * - Lo que requiere WP Admin manual → kind=SETUP
 *
 * USO:
 *   npx tsx scripts/fix-wp-task-kinds.ts          # dry-run
 *   npx tsx scripts/fix-wp-task-kinds.ts --apply   # guardar cambios
 */

import { PrismaClient } from "@prisma/client";

const CATEGORY_TO_KIND: Record<string, "CONTENT" | "SETUP"> = {
  meta: "CONTENT",       // plugin can apply metas
  seo: "CONTENT",        // plugin can apply SEO
  blog: "CONTENT",       // plugin can create drafts
  schema: "SETUP",       // manual in Yoast/Rank Math
  tecnico: "SETUP",      // manual WP Admin
  performance: "SETUP",  // WP Rocket/manual
  internal_links: "SETUP", // manual edit in Elementor
  enlazado: "SETUP",     // manual edit in Elementor
};

async function main() {
  const dryRun = !process.argv.includes("--apply");
  if (dryRun) {
    console.log("🔍 DRY RUN — no se harán cambios. Usa --apply para guardar.\n");
  }

  const prisma = new PrismaClient();

  try {
    const tasks = await prisma.planTask.findMany({
      where: {
        kind: "CODE",
        status: { notIn: ["DONE", "VOIDED"] },
        site: { platform: { in: ["WORDPRESS", "MIGRACION"] } },
      },
      include: {
        site: { select: { platform: true, client: { select: { name: true } } } },
        plan: { select: { month: true } },
      },
    });

    console.log(`Encontradas ${tasks.length} tareas WP con kind=CODE.\n`);

    let fixed = 0;

    for (const task of tasks) {
      const newKind = CATEGORY_TO_KIND[task.category.toLowerCase()] ?? "SETUP";
      const label = `${task.site.client.name} [${task.plan.month}] "${task.title}" (${task.category})`;

      console.log(`  ${label}: CODE → ${newKind}`);

      if (!dryRun) {
        await prisma.planTask.update({
          where: { id: task.id },
          data: { kind: newKind },
        });
      }
      fixed++;
    }

    console.log(`\n─── ${fixed} tareas ${dryRun ? "necesitan" : "corregidas"} ───`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
