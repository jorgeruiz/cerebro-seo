/**
 * Audit Complete Worker — procesa jobs "crawler:audit".
 *
 * Modo: Crawler completo (50 págs) + PageSpeed mobile + desktop.
 * Costo: $0 (PageSpeed API + Cheerio, sin DataForSEO).
 * Frecuencia: 1ro de cada mes, 1 AM para todos los clientes activos.
 * Timeout elevado: 5 min (el crawl puede tardar 2-3 min en sitios grandes).
 */

import { runAuditProcessor } from "../processors/audit-processor";

/** Exported for use by data-collection-dispatcher. */
export async function runAuditCompleteJob(clientId: string) {
  return runAuditProcessor({ clientId, mode: "complete" });
}
