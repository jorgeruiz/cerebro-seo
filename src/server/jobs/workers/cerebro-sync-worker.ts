/**
 * Worker: Sync de clientes desde Cerebro web → Cerebro SEO.
 *
 * ESTADO: Construido pero NO schedulado (2026-05-20).
 * Bloqueador: los endpoints /api/internal/seo/* no existen todavía en Cerebro web.
 * Activar: descomentar el bloque TODO en schedulers.ts cuando los endpoints existan.
 *
 * Frecuencia prevista: cada 6 horas.
 */
import { Worker } from "bullmq";
import { redisBullMQ } from "@/lib/redis";
import { prisma } from "@/lib/db";
import { fetchClientsFromCerebro } from "@/lib/cerebro-bridge";
import { ClientStatus } from "@prisma/client";

const worker = new Worker(
  "sync",
  async (job) => {
    if (job.name !== "sync:cerebro") return;

    console.log("[cerebro-sync] Starting client sync...");
    const start = Date.now();

    const cerebroClients = await fetchClientsFromCerebro();

    // Guardar contra falsos negativos: si Cerebro devuelve vacío, no borrar todo
    if (cerebroClients.length === 0) {
      console.warn("[cerebro-sync] Received empty client list — skipping to avoid mass inactive marking");
      await prisma.jobLog.create({
        data: { jobName: "sync:cerebro", status: "success", attempts: 1 },
      });
      return;
    }

    const cerebroIds = cerebroClients.map((c) => c.id);
    let created = 0;
    let updated = 0;
    let deactivated = 0;

    // Upsert cada cliente recibido desde Cerebro
    for (const cc of cerebroClients) {
      const existing = await prisma.client.findUnique({
        where: { cerebroClientId: cc.id },
        include: { sites: { take: 1 } },
      });

      const status = cc.status === "active" ? ClientStatus.ACTIVE : ClientStatus.PAUSED;

      if (!existing) {
        // Crear nuevo cliente + site
        await prisma.client.create({
          data: {
            cerebroClientId: cc.id,
            name: cc.name,
            domain: cc.domain,
            plan: "BASIC",
            status,
            services: cc.services,
            sites: {
              create: {
                url: `https://${cc.domain}`,
                // gscProperty y ga4Property: NO se pisan si vienen de Cerebro
                // (configuración SEO-específica que vive solo en Cerebro SEO)
                gscProperty: cc.gscProperty ?? null,
                ga4Property: cc.ga4Property ?? null,
              },
            },
          },
        });
        created++;
      } else {
        // Actualizar solo campos que viven en Cerebro — NO tocar gscProperty/ga4Property locales
        await prisma.client.update({
          where: { cerebroClientId: cc.id },
          data: {
            name: cc.name,
            domain: cc.domain,
            status,
            services: cc.services,
          },
        });
        updated++;
      }
    }

    // Marcar como inactive los locales que ya no aparecen en Cerebro
    const { count } = await prisma.client.updateMany({
      where: {
        cerebroClientId: { not: null, notIn: cerebroIds },
        status: ClientStatus.ACTIVE,
      },
      data: { status: ClientStatus.PAUSED },
    });
    deactivated = count;

    const durationMs = Date.now() - start;
    console.log(
      `[cerebro-sync] Done in ${durationMs}ms — created: ${created}, updated: ${updated}, deactivated: ${deactivated}`
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
