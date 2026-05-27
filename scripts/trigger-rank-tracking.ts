/**
 * Dispara manualmente el RankTrackingAgent para un cliente.
 *
 * Uso desde shell del contenedor o local:
 *   tsx scripts/trigger-rank-tracking.ts <clientId> [priority|bulk]
 *
 * Default: mode=priority (keywords isPriority:true, las más importantes)
 * bulk: keywords isPriority:false (tarda más, más keywords, usa Standard Queue)
 *
 * El job usa Standard Queue de DataForSEO — puede tardar 5-15 min en completar.
 */

import { Queue } from "bullmq";
import { prisma } from "../src/lib/db";
import { redisBullMQ } from "../src/lib/redis";

const clientId = process.argv[2];
const mode = process.argv[3] === "bulk" ? "bulk" : "priority";

if (!clientId) {
  console.error("Uso: tsx scripts/trigger-rank-tracking.ts <clientId> [priority|bulk]");
  process.exit(1);
}

async function main() {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      status: true,
      services: true,
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

  if (!client.services.includes("seo")) {
    console.warn(`Advertencia: ${client.name} no tiene servicio SEO. Continuando de todas formas...`);
  }

  // Contar keywords para informar al usuario
  const kwCount = await prisma.keyword.count({
    where: { clientId, isPriority: mode === "priority" },
  });

  if (kwCount === 0) {
    console.warn(`Cliente ${client.name} no tiene keywords con isPriority:${mode === "priority"}. El job correrá pero se saltará inmediatamente.`);
  }

  console.log(`Encolando RankTracking ${mode} para: ${client.name} (${clientId})`);
  console.log(`Keywords a trackear: ${kwCount} (isPriority: ${mode === "priority"})`);
  console.log(`Costo estimado: $${(kwCount * 0.00195).toFixed(4)} USD`);
  console.log(`Tiempo estimado: 5-15 minutos (Standard Queue DataForSEO)`);

  const dataCollectionQueue = new Queue("data-collection", { connection: redisBullMQ });

  const jobName = mode === "priority" ? "tracking:rankings-priority" : "tracking:rankings-bulk";
  const job = await dataCollectionQueue.add(
    jobName,
    { clientId, mode },
    {
      jobId: `tracking-manual:${clientId}:${mode}:${new Date().toISOString().slice(0, 19)}`,
    }
  );

  console.log(`\nJob encolado: ${job.id}`);
  console.log(`El worker procesará el job. Verifica el progreso en los logs del servidor.`);
  console.log(`\nPara ver los resultados después:`);
  console.log(`  SELECT k.term, kr.position, kr.delta, kr.date`);
  console.log(`  FROM "KeywordRanking" kr`);
  console.log(`  JOIN "Keyword" k ON k.id = kr."keywordId"`);
  console.log(`  WHERE k."clientId" = '${clientId}'`);
  console.log(`  ORDER BY kr.date DESC LIMIT 20;`);

  await dataCollectionQueue.close();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
