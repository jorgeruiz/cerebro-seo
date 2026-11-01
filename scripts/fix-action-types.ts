#!/usr/bin/env npx tsx
/**
 * Infer actionType and fix category for tasks missing them.
 *
 * USO:
 *   npx tsx scripts/fix-action-types.ts          # dry-run
 *   npx tsx scripts/fix-action-types.ts --apply   # guardar cambios
 */

import { PrismaClient } from "@prisma/client";

const CATEGORY_FIX: Record<string, string> = {
  content: "contenido",  // was kind.toLowerCase(), fix to proper category
};

function inferActionType(category: string, title: string): string | null {
  const cat = category.toLowerCase();
  const t = title.toLowerCase();

  if (cat === "blog" || /blog|artículo|articulo|post|redactar/.test(t)) return "create_blog";
  if (cat === "meta" || /meta\s*(title|description|tag)|yoast/.test(t)) return "update_meta";
  if (cat === "keyword" || /keyword|palabras?\s*clave/.test(t)) return "keyword_research";
  if (cat === "schema" || /schema|json-?ld/.test(t)) return "schema";
  if (/enlaces?\s*intern|internal\s*link/.test(t)) return "internal_links";
  if (cat === "landing" || /landing/.test(t)) return "create_landing";
  if (/optimizar.*texto|contenido|edit.*page/.test(t)) return "edit_page_text";

  return null;
}

function fixCategory(category: string, actionType: string | null, title: string): string {
  // Fix "content" (from old kind.toLowerCase()) to proper category
  if (CATEGORY_FIX[category]) {
    if (actionType === "create_blog") return "blog";
    if (actionType === "update_meta") return "meta";
    if (actionType === "create_landing") return "landing";
    return CATEGORY_FIX[category];
  }
  return category;
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  if (dryRun) console.log("🔍 DRY RUN\n");

  const prisma = new PrismaClient();

  try {
    const tasks = await prisma.planTask.findMany({
      where: {
        status: { notIn: ["DONE", "VOIDED"] },
        OR: [
          { actionType: null },
          { category: "content" },
        ],
      },
      include: {
        plan: { select: { month: true, client: { select: { name: true } } } },
      },
    });

    console.log(`${tasks.length} tareas a revisar.\n`);
    let fixed = 0;

    for (const task of tasks) {
      const at = inferActionType(task.category, task.title);
      const newCat = fixCategory(task.category, at, task.title);
      const changes: string[] = [];

      if (!task.actionType && at) changes.push(`actionType: null → ${at}`);
      if (newCat !== task.category) changes.push(`category: "${task.category}" → "${newCat}"`);

      if (changes.length > 0) {
        const label = `${task.plan.client.name} [${task.plan.month}] "${task.title}"`;
        console.log(`  ${label}: ${changes.join(", ")}`);
        if (!dryRun) {
          await prisma.planTask.update({
            where: { id: task.id },
            data: {
              ...(at && !task.actionType ? { actionType: at } : {}),
              ...(newCat !== task.category ? { category: newCat } : {}),
            },
          });
        }
        fixed++;
      }
    }

    console.log(`\n─── ${fixed} tareas ${dryRun ? "necesitan cambio" : "corregidas"} ───`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
