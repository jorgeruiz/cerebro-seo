import { initSchedulers } from "./schedulers";

let initialized = false;

/**
 * Punto de entrada del sistema de jobs.
 *
 * Importa todos los workers para que BullMQ los registre,
 * luego inicializa los schedulers cron por cliente.
 *
 * Llamar desde:
 *   - src/app/api/jobs/init/route.ts  (GET on startup via Easypanel health check)
 *   - O desde un proceso separado (recomendado en producción)
 *
 * Es idempotente — re-llamar no duplica workers ni schedulers.
 */
export async function initJobs(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // Importar workers — los efectos de módulo registran los Workers en BullMQ
  await import("./workers/insights-worker");
  await import("./workers/audit-quick-worker");
  await import("./workers/audit-complete-worker");
  await import("./workers/rank-tracking-worker");

  // Workers de bridge Cerebro: construidos, listos para procesar cuando se activen los schedulers.
  // Los schedulers correspondientes están comentados en schedulers.ts con TODO.
  // Ver: integration_cerebro.md §4 | Decisión 2026-05-20
  await import("./workers/cerebro-sync-worker");
  await import("./workers/cerebro-tasks-sync-worker");

  // Resto de workers se agregarán aquí según se implementen en las siguientes fases:
  // await import("./workers/rank-tracking-worker");
  // await import("./workers/backlinks-worker");
  // await import("./workers/competitor-worker");
  // await import("./workers/ai-search-worker");
  // await import("./workers/cycle-close-worker");
  // await import("./workers/report-worker");

  await initSchedulers();

  console.log("[jobs] System initialized");
}
