/**
 * Dispara manualmente un Site Audit para un cliente.
 *
 * Uso desde shell del contenedor o local:
 *   tsx scripts/trigger-audit.ts <clientId> [quick|complete]
 *
 * Default: mode=complete (crawl + PageSpeed mobile + desktop)
 * quick: solo PageSpeed mobile de la homepage (~15s)
 */

import { Queue } from "bullmq";
import { prisma } from "../src/lib/db";
import { redisBullMQ } from "../src/lib/redis";

const clientId = process.argv[2];
const mode = process.argv[3] === "quick" ? "quick" : "complete";

if (!clientId) {
  console.error("Uso: tsx scripts/trigger-audit.ts <clientId> [quick|complete]");
  process.exit(1);
}

async function main() {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true, name: true, status: true,
      sites: { take: 1, select: { url: true } },
    },
  });

  if (!client) {
    console.error(`Cliente no encontrado: ${clientId}`);
    process.exit(1);
  }

  if (client.status !== "ACTIVE") {
    console.error(`Cliente ${client.name} no está activo (status: ${client.status})`);
    process.exit(1);
  }

  const siteUrl = client.sites[0]?.url;
  if (!siteUrl) {
    console.error(`Cliente ${client.name} no tiene sitio configurado`);
    process.exit(1);
  }

  console.log(`Encolando audit ${mode} para: ${client.name} (${clientId})`);
  console.log(`Site: ${siteUrl}`);

  const dataCollectionQueue = new Queue("data-collection", { connection: redisBullMQ });

  const jobName = mode === "quick" ? "crawler:audit-quick" : "crawler:audit";
  const job = await dataCollectionQueue.add(
    jobName,
    { clientId, mode },
    {
      jobId: `audit-manual:${clientId}:${mode}:${new Date().toISOString().slice(0, 19)}`,
    }
  );

  console.log(`Job encolado: ${job.id}`);
  console.log(`El worker procesará el job en breve.`);
  console.log(`\nPara ver el resultado:`);
  console.log(`  SELECT id, type, status, "scoreOverall", "pagesCrawled", "completedAt"`);
  console.log(`  FROM "Audit" WHERE "clientId" = '${clientId}' ORDER BY "date" DESC LIMIT 3;`);

  await dataCollectionQueue.close();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
