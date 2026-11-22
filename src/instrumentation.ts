/**
 * Next.js instrumentation hook — se ejecuta UNA VEZ al startup del servidor Node.js.
 *
 * IMPORTANTE: Los workers de data collection y los schedulers ahora viven en el
 * worker dedicado (src/worker/plan-runner.ts). El proceso web NO registra workers
 * ni schedulers para evitar duplicación y la fragilidad de depender de instrumentation.
 *
 * El proceso web solo necesita poder ENCOLAR jobs (ej: analysis:generate desde el botón
 * de la UI), lo cual funciona sin workers — BullMQ encola en Redis y el worker consume.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log("[instrumentation] Web process started. Workers/schedulers run in the dedicated worker service.");
  }
}
