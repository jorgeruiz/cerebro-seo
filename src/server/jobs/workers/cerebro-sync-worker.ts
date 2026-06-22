/**
 * Worker: Sync de clientes desde Notion → Cerebro SEO.
 *
 * Lee directamente de Notion (BD "Clientes Actuales") con lista blanca de Estado.
 * Solo importa clientes con Estado ∈ {Activo, En Pausa}.
 * Upsert por cerebroClientId (= notionPageId sin dashes).
 * Clientes locales que ya no aparecen en el sync → status PAUSED (ocultos, no borrados).
 *
 * Frecuencia: cada 6 horas vía BullMQ scheduler.
 */
import { Worker } from "bullmq";
import { redisBullMQ } from "@/lib/redis";
import { prisma } from "@/lib/db";
import { getClientsFromNotion } from "@/lib/notion-direct";
import { ClientStatus, SeoPlan } from "@prisma/client";

const ESTADO_MAP: Record<string, ClientStatus> = {
  "Activo": ClientStatus.ACTIVE,
  "En Pausa": ClientStatus.PAUSED,
};

const worker = new Worker(
  "sync",
  async (job) => {
    if (job.name !== "sync:cerebro") return;

    console.log("[cerebro-sync] Starting client sync from Notion...");
    const start = Date.now();

    const notionClients = await getClientsFromNotion();

    // Guard: si Notion devuelve vacío, no desactivar todo — posible error de API
    if (notionClients.length === 0) {
      console.warn("[cerebro-sync] Received empty client list from Notion — skipping to avoid mass deactivation");
      await prisma.jobLog.create({
        data: { jobName: "sync:cerebro", status: "success", attempts: 1 },
      });
      return;
    }

    const notionIds = notionClients.map((c) => c.notionPageId);
    let created = 0;
    let updated = 0;
    let deactivated = 0;

    // Upsert cada cliente por cerebroClientId (= notionPageId)
    for (const nc of notionClients) {
      const status = ESTADO_MAP[nc.estado] ?? ClientStatus.PAUSED;

      const existing = await prisma.client.findUnique({
        where: { cerebroClientId: nc.notionPageId },
        include: { sites: { take: 1 } },
      });

      if (!existing) {
        // Crear nuevo cliente + site
        await prisma.client.create({
          data: {
            cerebroClientId: nc.notionPageId,
            name: nc.name,
            domain: nc.domain,
            plan: SeoPlan.BASIC,
            status,
            services: nc.services,
            sites: {
              create: {
                url: nc.domain.startsWith("http") ? nc.domain : `https://${nc.domain}`,
                gscProperty: nc.gscProperty ?? null,
                ga4Property: nc.ga4PropertyId ?? null,
              },
            },
          },
        });
        created++;
      } else {
        // Actualizar campos que viven en Notion — NO tocar gscProperty/ga4Property locales
        await prisma.client.update({
          where: { cerebroClientId: nc.notionPageId },
          data: {
            name: nc.name,
            domain: nc.domain,
            status,
            services: nc.services,
          },
        });
        updated++;
      }
    }

    // Ocultar clientes locales que ya no pasan el filtro de Notion
    // (pasaron a Cancelado, Proyecto, Consultoría, o fueron eliminados)
    const { count } = await prisma.client.updateMany({
      where: {
        cerebroClientId: { not: null, notIn: notionIds },
        status: ClientStatus.ACTIVE,
      },
      data: { status: ClientStatus.PAUSED },
    });
    deactivated = count;

    const durationMs = Date.now() - start;
    console.log(
      `[cerebro-sync] Done in ${durationMs}ms — ${notionClients.length} from Notion, created: ${created}, updated: ${updated}, deactivated: ${deactivated}`
    );

    await prisma.jobLog.create({
      data: { jobName: "sync:cerebro", status: "success", attempts: 1 },
    });
  },
  { connection: redisBullMQ, concurrency: 1 }
);

worker.on("error", (err) => {
  console.error("[cerebro-sync] Worker error:", err);
});

export { worker as cerebroSyncWorker };
