#!/usr/bin/env tsx
/**
 * Dispara manualmente el BacklinksAgent para un cliente.
 *
 * Uso:
 *   npx tsx scripts/trigger-backlinks.ts <clientId>
 *
 * Ejemplo:
 *   npx tsx scripts/trigger-backlinks.ts cltabc123
 */

import { Queue } from "bullmq";
import { redisBullMQ } from "@/lib/redis";
import { prisma } from "@/lib/db";

async function main() {
  const [clientId] = process.argv.slice(2);
  if (!clientId) {
    console.error(
      "Falta clientId. Uso: npx tsx scripts/trigger-backlinks.ts <clientId>"
    );
    process.exit(1);
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) {
    console.error(`Cliente ${clientId} no existe`);
    process.exit(1);
  }

  const queue = new Queue("data-collection", { connection: redisBullMQ });
  const job = await queue.add(
    "analysis:backlinks",
    { clientId },
    { jobId: `manual-backlinks-${clientId}-${Date.now()}` }
  );

  console.log(`✓ Job encolado: ${job.id} (cliente: ${client.name})`);
  console.log(`  Watchear progreso en los logs del worker.`);

  await queue.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
