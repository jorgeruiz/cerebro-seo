/**
 * Dispara manualmente el InsightsAgent para un cliente.
 *
 * Uso desde Easypanel Console (Shell del contenedor):
 *   tsx scripts/trigger-insights.ts <clientId>
 *
 * Útil para probar el piloto sin esperar al cron de las 6 AM.
 * NO exponer esto como endpoint HTTP — usa el script local.
 */

import { Queue } from "bullmq";
import { prisma } from "../src/lib/db";
import { redisBullMQ } from "../src/lib/redis";

const clientId = process.argv[2];

if (!clientId) {
  console.error("Uso: tsx scripts/trigger-insights.ts <clientId>");
  process.exit(1);
}

async function main() {
  // Verificar que el cliente existe
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, services: true, status: true },
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

  console.log(`Encolando InsightsAgent para: ${client.name} (${clientId})`);

  const aiAnalysisQueue = new Queue("ai-analysis", { connection: redisBullMQ });

  const job = await aiAnalysisQueue.add(
    "insights:generate",
    { clientId, trigger: "scheduled" },
    {
      // jobId único por fecha para no duplicar si ya corrió hoy
      jobId: `insights-manual:${clientId}:${new Date().toISOString().slice(0, 10)}:${Date.now()}`,
    }
  );

  console.log(`Job encolado: ${job.id}`);
  console.log(`El worker procesará el job en breve. Verifica en logs del servidor.`);
  console.log(`Para ver el resultado en BD:`);
  console.log(`  SELECT id, type, severity, title, "generatedAt" FROM "Insight" WHERE "clientId" = '${clientId}' ORDER BY "generatedAt" DESC LIMIT 5;`);

  await aiAnalysisQueue.close();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
