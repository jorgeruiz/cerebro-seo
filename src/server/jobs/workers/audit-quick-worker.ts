/**
 * Audit Quick Worker — procesa jobs "crawler:audit-quick".
 *
 * Modo: PageSpeed mobile solamente (no crawl completo).
 * Costo: $0 (PageSpeed API es gratuita).
 * Frecuencia: miércoles 2 AM para todos los clientes activos.
 */

import { createWorker } from "./base-worker";
import { runAuditProcessor } from "../processors/audit-processor";

export const auditQuickWorker = createWorker<
  { clientId: string; mode?: string },
  Awaited<ReturnType<typeof runAuditProcessor>>
>(
  "data-collection",
  async (job) => {
    const { clientId } = job.data;
    return runAuditProcessor({ clientId, mode: "quick" });
  },
  {
    concurrency: 2,
  }
);
