import { dataCollectionQueue, aiAnalysisQueue, syncQueue } from "./queues";
import { prisma } from "@/lib/db";

/**
 * Registra todos los cron jobs en BullMQ para cada cliente activo.
 *
 * Los jobs usan jobId determinístico (ej: `rankings-priority:client_xyz`)
 * para garantizar idempotencia — re-llamar a esta función no duplica schedulers.
 *
 * Llamar al startup de la app (desde init.ts).
 */
export async function initSchedulers(): Promise<void> {
  const clients = await prisma.client.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, domain: true },
  });

  console.log(`[schedulers] Registering jobs for ${clients.length} active clients`);

  for (const client of clients) {
    await registerClientJobs(client.id);
  }

  // Jobs globales (no por cliente)
  await registerGlobalJobs();
}

/**
 * Registra los jobs de un cliente específico.
 * Llamar también al crear un nuevo cliente activo.
 */
export async function registerClientJobs(clientId: string): Promise<void> {
  // Rankings priority — diario 3 AM
  await dataCollectionQueue.add(
    "tracking:rankings-priority",
    { clientId, mode: "priority" },
    {
      repeat: { pattern: "0 3 * * *" },
      jobId: `rankings-priority:${clientId}`,
    }
  );

  // Rankings bulk — lunes 4 AM
  await dataCollectionQueue.add(
    "tracking:rankings-bulk",
    { clientId, mode: "bulk" },
    {
      repeat: { pattern: "0 4 * * 1" },
      jobId: `rankings-bulk:${clientId}`,
    }
  );

  // Audit rápido — miércoles 2 AM
  await dataCollectionQueue.add(
    "crawler:audit-quick",
    { clientId, mode: "quick" },
    {
      repeat: { pattern: "0 2 * * 3" },
      jobId: `audit-quick:${clientId}`,
    }
  );

  // Audit completo — 1ro de cada mes, 1 AM
  await dataCollectionQueue.add(
    "crawler:audit",
    { clientId, mode: "full" },
    {
      repeat: { pattern: "0 1 1 * *" },
      jobId: `audit-full:${clientId}`,
    }
  );

  // Insights — diario 6 AM (después de rankings priority)
  await aiAnalysisQueue.add(
    "insights:generate",
    { clientId, trigger: "scheduled", priority: "normal" },
    {
      repeat: { pattern: "0 6 * * *" },
      jobId: `insights:${clientId}`,
    }
  );

  // Backlinks — jueves 5 AM
  await dataCollectionQueue.add(
    "analysis:backlinks",
    { clientId },
    {
      repeat: { pattern: "0 5 * * 4" },
      jobId: `backlinks:${clientId}`,
    }
  );

  // Competidores — días 1 y 15 del mes, 7 AM
  await dataCollectionQueue.add(
    "analysis:competitors",
    { clientId },
    {
      repeat: { pattern: "0 7 1,15 * *" },
      jobId: `competitors:${clientId}`,
    }
  );

  // AI Search Visibility — viernes 6 AM
  await dataCollectionQueue.add(
    "analysis:ai-search",
    { clientId },
    {
      repeat: { pattern: "0 6 * * 5" },
      jobId: `ai-search:${clientId}`,
    }
  );
}

/**
 * Jobs globales que corren independientemente de clientes individuales.
 */
async function registerGlobalJobs(): Promise<void> {
  // Cierre de ciclo — día 1 de cada mes, 2 AM
  // El worker se encarga de iterar por todos los clientes con ciclo activo
  await aiAnalysisQueue.add(
    "cycle:close",
    { runForAllClients: true },
    {
      repeat: { pattern: "0 2 1 * *" },
      jobId: "cycle:close:global",
    }
  );

  // Reporte mensual — día 2, 6 AM
  // Se encola después de que cycle:close haya corrido
  await aiAnalysisQueue.add(
    "report:monthly",
    { runForAllClients: true },
    {
      repeat: { pattern: "0 6 2 * *" },
      jobId: "report:monthly:global",
    }
  );

  // Sync con Cerebro — cada 6 horas
  await syncQueue.add(
    "sync:cerebro",
    {},
    {
      repeat: { pattern: "0 */6 * * *" },
      jobId: "sync:cerebro:global",
    }
  );
}

/**
 * Elimina todos los jobs recurrentes de un cliente.
 * Llamar al pausar o dar de baja a un cliente.
 */
export async function removeClientJobs(clientId: string): Promise<void> {
  const jobIds = [
    `rankings-priority:${clientId}`,
    `rankings-bulk:${clientId}`,
    `audit-quick:${clientId}`,
    `audit-full:${clientId}`,
    `insights:${clientId}`,
    `backlinks:${clientId}`,
    `competitors:${clientId}`,
    `ai-search:${clientId}`,
  ];

  for (const jobId of jobIds) {
    const job =
      (await dataCollectionQueue.getJob(jobId)) ??
      (await aiAnalysisQueue.getJob(jobId));
    if (job) {
      await job.remove();
    }
  }

  console.log(`[schedulers] Removed jobs for client ${clientId}`);
}
