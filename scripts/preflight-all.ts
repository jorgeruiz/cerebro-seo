/**
 * Encola un preflight para cada sitio con githubRepo.
 * Preflight = clone → memoria → npm ci --include=dev → build (sin agente, sin commit, sin PR).
 *
 * Uso (dentro del worker container):
 *   npx tsx scripts/preflight-all.ts
 */

import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import Redis from "ioredis";

const prisma = new PrismaClient();

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error("REDIS_URL required");
    process.exit(1);
  }

  const sites = await prisma.site.findMany({
    where: {
      githubRepo: { not: null },
      client: { status: "ACTIVE", services: { has: "seo" } },
      framework: "nextjs",
    },
    include: { client: { select: { id: true, name: true } } },
  });

  if (sites.length === 0) {
    console.log("No sites with githubRepo + SEO + Next.js");
    await prisma.$disconnect();
    return;
  }

  console.log(`📋 ${sites.length} sitio(s) Next.js con SEO activo:\n`);
  for (const s of sites) {
    console.log(`  ${s.client.name} — ${s.githubRepo}`);
  }

  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue("plan-task-execution", { connection: redis });

  // Get or create a plan for each site's client
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  console.log(`\n🚀 Encolando preflight tasks...\n`);

  for (const site of sites) {
    const plan = await prisma.monthlyPlan.upsert({
      where: { clientId_month: { clientId: site.client.id, month } },
      create: { clientId: site.client.id, month, status: "DRAFT" },
      update: {},
    });

    const taskCount = await prisma.planTask.count({ where: { planId: plan.id } });

    const task = await prisma.planTask.create({
      data: {
        planId: plan.id,
        siteId: site.id,
        order: taskCount + 1,
        title: `[PREFLIGHT] ${site.client.name}`,
        objective: "Verificar que el sitio puede compilar y está listo para tareas automatizadas",
        prompt: "PREFLIGHT_ONLY",
        acceptanceCriteria: [],
        lane: "AUTO",
        category: "preflight",
        status: "QUEUED",
      },
    });

    await queue.add("plan-task", { taskId: task.id, preflight: true });
    console.log(`  ✓ ${site.client.name} — task ${task.id}`);
  }

  console.log(`\n⏳ ${sites.length} preflight(s) encolados. Monitorea los logs del worker.`);

  await redis.quit();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
