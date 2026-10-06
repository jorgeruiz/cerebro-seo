/**
 * Crea una tarea de plan mensual y la encola para ejecución.
 * Hace polling hasta que termine.
 *
 * Uso:
 *   npx tsx scripts/run-task.ts --siteId cm... --title "Agregar JSON-LD" --prompt "Agregar schema LocalBusiness..."
 *   npx tsx scripts/run-task.ts --siteId cm... --title "..." --prompt "..." --mode AI
 */

import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import Redis from "ioredis";

const prisma = new PrismaClient();

function parseArgs(): {
  siteId: string;
  title: string;
  prompt: string;
  mode: "AI" | "HYBRID" | "HUMAN";
} {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  const siteId = get("--siteId");
  const title = get("--title");
  const prompt = get("--prompt");
  const modeRaw = (get("--mode") ?? get("--lane") ?? "AI").toUpperCase();
  // Map old lane values to new mode values
  const MODE_MAP: Record<string, "AI" | "HYBRID" | "HUMAN"> = {
    AUTO: "AI", AI: "AI", ASSISTED: "HYBRID", HYBRID: "HYBRID", MANUAL: "HUMAN", HUMAN: "HUMAN",
  };
  const mode = MODE_MAP[modeRaw] ?? "AI";

  if (!siteId || !title || !prompt) {
    console.error("Uso: npx tsx scripts/run-task.ts --siteId <id> --title <título> --prompt <prompt> [--mode AI]");
    process.exit(1);
  }

  return { siteId, title, prompt, mode };
}

async function main() {
  const { siteId, title, prompt, mode } = parseArgs();

  const site = await prisma.site.findUniqueOrThrow({
    where: { id: siteId },
    include: { client: { select: { id: true, name: true } } },
  });

  if (!site.githubRepo) {
    console.error(`✗ Site ${site.url} no tiene githubRepo configurado.`);
    process.exit(1);
  }

  console.log(`📋 Cliente: ${site.client.name}`);
  console.log(`🌐 Site: ${site.url} (${site.githubRepo})`);
  console.log(`📝 Tarea: ${title}`);
  console.log(`🛤  Mode: ${mode}\n`);

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const plan = await prisma.monthlyPlan.upsert({
    where: { clientId_month: { clientId: site.client.id, month } },
    create: { clientId: site.client.id, month, status: "ACTIVE" },
    update: {},
  });

  const taskCount = await prisma.planTask.count({ where: { planId: plan.id } });

  const task = await prisma.planTask.create({
    data: {
      planId: plan.id,
      siteId,
      order: taskCount + 1,
      title,
      objective: title,
      prompt,
      acceptanceCriteria: ["Build pasa sin errores", "Cambios son coherentes con el prompt"],
      mode,
      kind: "CODE",
      category: "manual",
      status: "READY",
    },
  });

  console.log(`✓ Tarea creada: ${task.id}`);

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error("✗ REDIS_URL no definido");
    process.exit(1);
  }

  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue("plan-task-execution", { connection: redis });

  await queue.add("plan-task", { taskId: task.id });
  console.log(`✓ Job encolado. Esperando resultado...\n`);

  const startTime = Date.now();
  const maxWait = 15 * 60 * 1000;

  while (Date.now() - startTime < maxWait) {
    await new Promise((r) => setTimeout(r, 5_000));

    const updated = await prisma.planTask.findUniqueOrThrow({
      where: { id: task.id },
      include: { runs: { orderBy: { startedAt: "desc" }, take: 1 } },
    });

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    process.stdout.write(`\r⏳ ${elapsed}s — status: ${updated.status}`);

    if (["DONE", "FAILED", "VOIDED"].includes(updated.status)) {
      console.log("\n");

      if (updated.status === "DONE") {
        console.log(`✅ Tarea completada: ${updated.status}`);
      } else {
        console.log(`❌ Tarea falló: ${updated.failureReason ?? updated.voidReason ?? "sin detalle"}`);
      }

      const lastRun = updated.runs[0];
      if (lastRun) {
        console.log(`   Costo: $${lastRun.costUsd?.toString() ?? "?"} USD`);
        console.log(`   Tokens: ${lastRun.inputTokens ?? "?"}in / ${lastRun.outputTokens ?? "?"}out`);
        if (lastRun.error) console.log(`   Error: ${lastRun.error}`);
      }

      await redis.quit();
      await prisma.$disconnect();
      return;
    }
  }

  console.log("\n\n⏰ Timeout — la tarea sigue corriendo en background.");
  await redis.quit();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
