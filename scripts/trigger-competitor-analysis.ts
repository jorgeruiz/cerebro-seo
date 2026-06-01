/**
 * Disparar análisis de competidores manualmente para un cliente.
 *
 * Uso:
 *   npx tsx scripts/trigger-competitor-analysis.ts <clientId>
 *   npx tsx scripts/trigger-competitor-analysis.ts all   # todos los clientes SEO activos
 */

import { Queue } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue("data-collection", { connection });

async function main() {
  const arg = process.argv[2];

  if (!arg) {
    console.error("Usage: npx tsx scripts/trigger-competitor-analysis.ts <clientId|all>");
    process.exit(1);
  }

  if (arg === "all") {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const clients = await prisma.client.findMany({
      where: { status: "ACTIVE", services: { has: "seo" } },
      select: { id: true, name: true },
    });
    await prisma.$disconnect();

    console.log(`Encolando análisis de competidores para ${clients.length} clientes...`);
    for (const client of clients) {
      await queue.add(
        "analysis:competitors",
        { clientId: client.id },
        { jobId: `manual-competitors-${client.id}-${Date.now()}` }
      );
      console.log(`  ✓ ${client.name} (${client.id})`);
    }
  } else {
    await queue.add(
      "analysis:competitors",
      { clientId: arg },
      { jobId: `manual-competitors-${arg}-${Date.now()}` }
    );
    console.log(`✓ Job encolado para cliente ${arg}`);
  }

  await queue.close();
  await connection.quit();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
