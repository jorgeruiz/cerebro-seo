/**
 * Audit Quick Worker — procesa jobs "crawler:audit-quick".
 *
 * Modo: PageSpeed mobile solamente (no crawl completo).
 * Costo: $0 (PageSpeed API es gratuita).
 * Frecuencia: miércoles 2 AM para todos los clientes activos.
 */

import { runAuditProcessor } from "../processors/audit-processor";

/** Exported for use by data-collection-dispatcher. */
export async function runAuditQuickJob(clientId: string) {
  return runAuditProcessor({ clientId, mode: "quick" });
}
