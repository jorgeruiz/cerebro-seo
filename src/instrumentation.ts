/**
 * Next.js instrumentation hook — se ejecuta UNA VEZ al startup del servidor Node.js.
 * Inicializa el sistema de jobs BullMQ (workers + schedulers) antes del primer request.
 *
 * Reemplaza el patrón anterior de /api/jobs/init que requería ser llamado manualmente.
 * Ver: src/server/jobs/init.ts
 */
export async function register() {
  // Solo en runtime Node.js (no en Edge runtime ni durante next build)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initJobs } = await import("./server/jobs/init");
    await initJobs().catch((err) => {
      console.error("[instrumentation] Jobs init failed:", err);
    });
  }
}
