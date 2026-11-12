#!/usr/bin/env npx tsx
/**
 * Data migration: resolve deprecated actionType aliases to canonical values.
 *
 * Rules:
 * - edit_page_widgets → edit_page_text
 * - create_landing_from_template → create_landing
 * - upload_media → add_image
 * - generate_image → add_image
 * - verify_tracking → verify_analytics
 * - update_post → refresh_content IF target is blog post; else → other + NEEDS_DEFINITION
 * - Unknown actionType → other + NEEDS_DEFINITION
 *
 * USO:
 *   npx tsx scripts/migrate-action-types.ts          # dry-run
 *   npx tsx scripts/migrate-action-types.ts --apply   # apply
 */

import { PrismaClient } from "@prisma/client";

const STATIC_ALIASES: Record<string, string> = {
  edit_page_widgets: "edit_page_text",
  create_landing_from_template: "create_landing",
  upload_media: "add_image",
  generate_image: "add_image",
  verify_tracking: "verify_analytics",
};

// From the catalog
const VALID_TYPES = new Set([
  "create_blog", "update_meta", "create_landing", "keyword_research",
  "schema", "internal_links", "edit_page_text", "add_image",
  "verify_indexation", "fix_redirect", "verify_analytics",
  "optimize_alt_text", "configure_sitemap", "improve_speed",
  "setup_gbp", "audit_duplicate", "optimize_images", "configure_robots",
  "configure_canonical", "link_building", "fix_headings", "fix_broken_links",
  "refresh_content", "add_faq", "aeo_readiness", "merge_content",
  "add_human_evidence", "security_fix", "other",
]);

function isBlogTarget(task: { title: string; category: string; sourceRef: unknown }): boolean {
  const t = task.title.toLowerCase();
  const cat = task.category.toLowerCase();
  if (cat === "blog" || cat === "articulo") return true;
  if (/blog|artículo|articulo|post/.test(t)) return true;
  const ref = task.sourceRef as Record<string, unknown> | null;
  if (ref?.module === "contenido" || ref?.module === "blog") return true;
  return false;
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  if (dryRun) console.log("🔍 DRY RUN\n");

  const prisma = new PrismaClient();
  const counts: Record<string, number> = {};

  try {
    const tasks = await prisma.planTask.findMany({
      where: { actionType: { not: null } },
      select: { id: true, actionType: true, title: true, category: true, sourceRef: true, status: true },
    });

    console.log(`Total tasks with actionType: ${tasks.length}\n`);

    for (const task of tasks) {
      const at = task.actionType!;

      // Already valid
      if (VALID_TYPES.has(at)) continue;

      // Static alias
      if (STATIC_ALIASES[at]) {
        const newType = STATIC_ALIASES[at];
        const key = `${at} → ${newType}`;
        counts[key] = (counts[key] ?? 0) + 1;

        if (!dryRun) {
          await prisma.planTask.update({
            where: { id: task.id },
            data: { actionType: newType },
          });
          await prisma.classificationEvent.create({
            data: {
              taskId: task.id,
              originalType: at,
              finalType: newType,
              actor: "migration",
              reason: `Alias estático: ${at} → ${newType}`,
            },
          });
        }
        continue;
      }

      // update_post → context-dependent
      if (at === "update_post") {
        if (isBlogTarget(task)) {
          counts["update_post → refresh_content (blog)"] = (counts["update_post → refresh_content (blog)"] ?? 0) + 1;
          if (!dryRun) {
            await prisma.planTask.update({
              where: { id: task.id },
              data: { actionType: "refresh_content" },
            });
            await prisma.classificationEvent.create({
              data: {
                taskId: task.id,
                originalType: at,
                finalType: "refresh_content",
                actor: "migration",
                reason: "update_post con target blog → refresh_content",
              },
            });
          }
        } else {
          counts["update_post → other (NEEDS_DEFINITION)"] = (counts["update_post → other (NEEDS_DEFINITION)"] ?? 0) + 1;
          if (!dryRun) {
            await prisma.planTask.update({
              where: { id: task.id },
              data: {
                actionType: "other",
                status: task.status === "DONE" || task.status === "VOIDED" ? task.status : "NEEDS_DEFINITION",
              },
            });
            await prisma.classificationEvent.create({
              data: {
                taskId: task.id,
                originalType: at,
                finalType: "other",
                actor: "migration",
                reason: "update_post sin target blog identificable → other + NEEDS_DEFINITION",
              },
            });
          }
        }
        continue;
      }

      // Unknown actionType
      counts[`${at} → other (unknown)`] = (counts[`${at} → other (unknown)`] ?? 0) + 1;
      if (!dryRun) {
        await prisma.planTask.update({
          where: { id: task.id },
          data: {
            actionType: "other",
            status: task.status === "DONE" || task.status === "VOIDED" ? task.status : "NEEDS_DEFINITION",
          },
        });
        await prisma.classificationEvent.create({
          data: {
            taskId: task.id,
            originalType: at,
            finalType: "other",
            actor: "migration",
            reason: `actionType desconocido: ${at} → other + NEEDS_DEFINITION`,
          },
        });
      }
    }

    console.log("─── Conteo por migración ───");
    for (const [key, count] of Object.entries(counts)) {
      console.log(`  ${key}: ${count}`);
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`\nTotal: ${total} tareas ${dryRun ? "necesitan" : ""} migración`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
