/**
 * Crea una tarea de plan mensual y la encola para ejecución.
 * Hace polling hasta que termine.
 *
 * Uso:
 *   npx tsx scripts/run-task.ts --siteId cm... --title "Agregar JSON-LD" --prompt "Agregar schema LocalBusiness..."
 *   npx tsx scripts/run-task.ts --siteId cm... --title "..." --prompt "..." --lane AUTO
 */

import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import Redis from "ioredis";

const prisma = new PrismaClient();

function parseArgs(): {
  siteId: string;
  title: string;
  prompt: string;
  lane: "AUTO" | "ASSISTED" | "MANUAL";
} {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  const siteId = get("--siteId");
  const title = get("--title");
  const prompt = get("--prompt");
  const lane = (get("--lane") ?? "AUTO").toUpperCase() as "AUTO" | "ASSISTED" | "MANUAL";

  if (!siteId || !title || !prompt) {
    console.error("Uso: npx tsx scripts/run-task.ts --siteId <id> --title <título> --prompt <prompt> [--lane AUTO]");
    process.exit(1);
  }

  return { siteId, title, prompt, lane };
}

async function main() {
  const { siteId, title, prompt, lane } = parseArgs();

  // Verificar site
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
  console.log(`🛤  Lane: ${lane}\n`);

  // Obtener o crear MonthlyPlan del mes
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const plan = await prisma.monthlyPlan.upsert({
    where: {
      clientId_month: { clientId: site.client.id, month },
    },
    create: {
      clientId: site.client.id,
      month,
      status: "RUNNING",
    },
    update: {},
  });

  // Contar tareas existentes para el order
  const taskCount = await prisma.planTask.count({ where: { planId: plan.id } });

  // Crear PlanTask
  const task = await prisma.planTask.create({
    data: {
      planId: plan.id,
      siteId,
      order: taskCount + 1,
      title,
      objective: title,
      prompt,
      acceptanceCriteria: ["Build pasa sin errores", "Cambios son coherentes con el prompt"],
      lane,
      category: "manual",
      status: "QUEUED",
    },
  });

  console.log(`✓ Tarea creada: ${task.id}`);

  // Encolar
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error("✗ REDIS_URL no definido");
    process.exit(1);
  }

  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue("plan-task-execution", { connection: redis });

  await queue.add("plan-task", { taskId: task.id });
  console.log(`✓ Job encolado. Esperando resultado...\n`);

  // Polling
  const startTime = Date.now();
  const maxWait = 15 * 60 * 1000; // 15 minutos

  while (Date.now() - startTime < maxWait) {
    await new Promise((r) => setTimeout(r, 5_000));

    const updated = await prisma.planTask.findUniqueOrThrow({
      where: { id: task.id },
      include: { runs: { orderBy: { startedAt: "desc" }, take: 1 } },
    });

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    process.stdout.write(`\r⏳ ${elapsed}s — status: ${updated.status}`);

    if (["PREVIEW", "MERGED", "FAILED", "DISCARDED"].includes(updated.status)) {
      console.log("\n");

      if (updated.status === "PREVIEW" || updated.status === "MERGED") {
        console.log(`✅ Tarea completada: ${updated.status}`);
        if (updated.prUrl) console.log(`   PR: ${updated.prUrl}`);
        if (updated.previewUrl) console.log(`   Preview: ${updated.previewUrl}`);
      } else {
        console.log(`❌ Tarea falló: ${updated.failureReason ?? "sin detalle"}`);
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
