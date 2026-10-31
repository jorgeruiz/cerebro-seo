#!/usr/bin/env npx tsx
/**
 * Diagnóstico: lista stagedChange de tareas DONE en planes WP que nunca se aplicaron.
 *
 * USO:
 *   npx tsx scripts/diagnose-wp-staged.ts
 */

import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();

  try {
    // Find WP sites
    const wpSites = await prisma.site.findMany({
      where: { platform: { in: ["WORDPRESS", "MIGRACION"] } },
      include: { client: { select: { name: true, cerebroClientId: true } } },
    });

    console.log(`Encontrados ${wpSites.length} sitios WordPress/Migración.\n`);

    for (const site of wpSites) {
      const plans = await prisma.monthlyPlan.findMany({
        where: { clientId: site.clientId },
        orderBy: { month: "desc" },
        include: {
          tasks: {
            where: { status: "DONE" },
            include: {
              steps: {
                where: { status: "DONE", NOT: { stagedChange: { equals: undefined } } },
                orderBy: { order: "asc" },
              },
            },
          },
        },
      });

      for (const plan of plans) {
        const pendingChanges: Array<{
          task: string;
          step: string;
          type: string;
          detail: string;
        }> = [];

        for (const task of plan.tasks) {
          for (const step of task.steps) {
            const sc = step.stagedChange as Record<string, unknown> | null;
            if (!sc?.type) continue;

            // Check if this change was already applied
            if (sc.type === "elementor" && sc.applied_at) continue;

            if (sc.type === "seo") {
              pendingChanges.push({
                task: task.title,
                step: step.title,
                type: "SEO",
                detail: `page_id=${sc.page_id} title="${(sc.meta_title as string)?.slice(0, 50)}"`,
              });
            } else if (sc.type === "elementor") {
              pendingChanges.push({
                task: task.title,
                step: step.title,
                type: "Elementor",
                detail: `page_id=${sc.page_id} "${sc.page_title}" draft_id=${sc.draft_id}`,
              });
            } else if (sc.type === "blog") {
              pendingChanges.push({
                task: task.title,
                step: step.title,
                type: "Blog",
                detail: `post_id=${sc.post_id} "${sc.title}" ${sc.has_placeholders ? "⚠ PLACEHOLDERS" : ""}`,
              });
            }
          }
        }

        if (pendingChanges.length > 0) {
          const wasPublished = plan.status === "PUBLISHED";
          console.log(
            `\n── ${site.client.name} — Plan ${plan.month} (${plan.status}${wasPublished ? " ✅" : ""}) ──`
          );
          for (const c of pendingChanges) {
            console.log(`  [${c.type}] ${c.task} → ${c.step}: ${c.detail}`);
          }
          console.log(`  Total: ${pendingChanges.length} cambios pendientes`);
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
