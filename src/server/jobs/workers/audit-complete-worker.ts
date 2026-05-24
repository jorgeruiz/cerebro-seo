/**
 * Audit Complete Worker — procesa jobs "crawler:audit".
 *
 * Modo: Crawler completo (50 págs) + PageSpeed mobile + desktop.
 * Costo: $0 (PageSpeed API + Cheerio, sin DataForSEO).
 * Frecuencia: 1ro de cada mes, 1 AM para todos los clientes activos.
 * Timeout elevado: 5 min (el crawl puede tardar 2-3 min en sitios grandes).
 */

import { createWorker } from "./base-worker";
import { runAuditProcessor } from "../processors/audit-processor";

export const auditCompleteWorker = createWorker<
  { clientId: string; mode?: string },
  Awaited<ReturnType<typeof runAuditProcessor>>
>(
  "data-collection",
  async (job) => {
    const { clientId } = job.data;
    return runAuditProcessor({ clientId, mode: "complete" });
  },
  {
    concurrency: 1, // crawl es intensivo — 1 a la vez
  }
);
