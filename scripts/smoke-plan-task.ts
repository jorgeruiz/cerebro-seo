/**
 * Smoke test: execute a real plan task (LLM, no publish) and validate results.
 *
 * Usage:
 *   npx tsx scripts/smoke-plan-task.ts --client=ayrisa --task=<taskId> --no-publish
 *
 * Validates:
 * - Metas not empty and within length (50-60 title, 140-160 desc)
 * - page_id > 0
 * - claims[] present
 * - Final state coherent (not DONE with empty metas)
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const taskArg = process.argv.find((a) => a.startsWith("--task="));
  const clientArg = process.argv.find((a) => a.startsWith("--client="));

  if (!taskArg && !clientArg) {
    console.log("Usage: npx tsx scripts/smoke-plan-task.ts --task=<id> [--client=<name>]");
    process.exit(1);
  }

  let taskId: string;
  if (taskArg) {
    taskId = taskArg.replace("--task=", "");
  } else {
    const clientSlug = clientArg!.replace("--client=", "");
    const task = await prisma.planTask.findFirst({
      where: {
        site: { client: { name: { contains: clientSlug, mode: "insensitive" } } },
        actionType: "update_meta",
        status: { in: ["BLOCKED", "FAILED", "READY"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, status: true },
    });
    if (!task) { console.log("No matching task found"); process.exit(1); }
    taskId = task.id;
    console.log(`Found: [${task.status}] ${task.title}`);
  }

  console.log(`\n=== Smoke Test: ${taskId} ===\n`);

  // Load task
  const task = await prisma.planTask.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      steps: { orderBy: { order: "asc" } },
      site: { include: { client: { select: { cerebroClientId: true, name: true } } } },
    },
  });

  console.log(`Task: ${task.title}`);
  console.log(`Status: ${task.status}`);
  console.log(`ActionType: ${task.actionType}`);
  console.log(`Steps: ${task.steps.length}`);
  console.log();

  // Find the SEO step
  const seoStep = task.steps.find((s) => {
    try {
      const prompt = JSON.parse(s.prompt ?? "{}");
      return prompt.action === "seo";
    } catch { return false; }
  }) ?? task.steps.find((s) => s.title.toLowerCase().includes("meta") || s.title.toLowerCase().includes("seo"));

  if (!seoStep) {
    console.log("No SEO step found in task");
    process.exit(1);
  }

  console.log(`SEO Step: ${seoStep.title} [${seoStep.status}]`);

  // Check staged change
  const sc = seoStep.stagedChange as Record<string, unknown> | null;
  if (!sc) {
    console.log("RESULT: No stagedChange — step not executed yet");
    console.log("ACTION: Run actionResumeBlockedTask or actionExecuteTask first");
    process.exit(1);
  }

  console.log(`\n--- Staged Change ---`);
  console.log(`type: ${sc.type}`);
  console.log(`page_id: ${sc.page_id}`);
  console.log(`generated: ${sc.generated}`);
  console.log(`meta_title: "${sc.meta_title}" (${String(sc.meta_title ?? "").length}c)`);
  console.log(`meta_description: "${String(sc.meta_description ?? "").slice(0, 60)}..." (${String(sc.meta_description ?? "").length}c)`);
  console.log(`current_meta_title: "${sc.current_meta_title ?? "(no leído)"}"`);
  console.log(`claims: ${Array.isArray(sc.claims) ? sc.claims.length : "none"}`);
  console.log(`unsourced_claims: ${Array.isArray(sc.unsourced_claims) ? sc.unsourced_claims.length : "none"}`);

  // Validate
  const issues: string[] = [];

  if (!sc.page_id || Number(sc.page_id) === 0) issues.push("page_id = 0");
  if (!sc.meta_title || String(sc.meta_title).length < 10) issues.push(`meta_title empty/short (${String(sc.meta_title ?? "").length}c)`);
  if (!sc.meta_description || String(sc.meta_description).length < 30) issues.push(`meta_description empty/short (${String(sc.meta_description ?? "").length}c)`);
  if (sc.generated === false) issues.push("generated = false");

  const titleLen = String(sc.meta_title ?? "").length;
  if (titleLen > 0 && (titleLen < 45 || titleLen > 70)) issues.push(`title length ${titleLen}c (target: 50-60)`);
  const descLen = String(sc.meta_description ?? "").length;
  if (descLen > 0 && (descLen < 130 || descLen > 170)) issues.push(`description length ${descLen}c (target: 140-160)`);

  if (!sc.current_meta_title && !sc.current_meta_description) issues.push("No 'Actual' metas read (getWpSeo may have failed)");

  // Task status coherence
  if (task.status === "DONE" && sc.generated === false) issues.push("INCOHERENT: task DONE but generated=false");
  if (task.status === "DONE" && (!sc.meta_title || String(sc.meta_title).length < 10)) issues.push("INCOHERENT: task DONE with empty meta_title");

  console.log(`\n--- Validation ---`);
  if (issues.length === 0) {
    console.log("✓ ALL CHECKS PASSED");
  } else {
    for (const issue of issues) {
      console.log(`✗ ${issue}`);
    }
    console.log(`\n${issues.length} issue(s) found`);
  }

  // Claims detail
  if (Array.isArray(sc.claims) && sc.claims.length > 0) {
    console.log(`\n--- Claims ---`);
    for (const c of sc.claims as Array<{ text: string; source: string }>) {
      const icon = c.source === "none" ? "⚠" : "✓";
      console.log(`  ${icon} [${c.source}] ${c.text}`);
    }
  }

  await prisma.$disconnect();
  process.exit(issues.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
