/**
 * Worker: Sync de tareas y estrategia mensual desde Cerebro web → Cerebro SEO.
 *
 * ESTADO: Construido pero NO schedulado (2026-05-20).
 * Bloqueador: los endpoints /api/internal/seo/* no existen todavía en Cerebro web.
 * Activar: descomentar el bloque TODO en schedulers.ts cuando los endpoints existan.
 *
 * Frecuencia prevista: cada 15 minutos, solo para clientes SEO.
 */
import { Worker } from "bullmq";
import { redisBullMQ } from "@/lib/redis";
import { prisma } from "@/lib/db";
import { fetchActiveTasks, fetchCurrentStrategy } from "@/lib/cerebro-bridge";
import { CycleStatus, TaskStatus } from "@prisma/client";

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const worker = new Worker(
  "sync",
  async (job) => {
    if (job.name !== "sync:cerebro-tasks") return;

    const { clientId } = job.data as { clientId: string };

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, cerebroClientId: true },
    });

    if (!client?.cerebroClientId) {
      console.warn(`[cerebro-tasks-sync] Client ${clientId} has no cerebroClientId — skipping`);
      return;
    }

    const yearMonth = currentYearMonth();

    // Llamadas en paralelo
    const [tasks, strategy] = await Promise.all([
      fetchActiveTasks(client.cerebroClientId),
      fetchCurrentStrategy(client.cerebroClientId),
    ]);

    // ── Upsert MonthlyCycle con estrategia ────────────────────────────────────

    if (strategy) {
      await prisma.monthlyCycle.upsert({
        where: { clientId_yearMonth: { clientId, yearMonth } },
        update: {
          focus: strategy.focus,
          goals: strategy.goals,
          strategySummary: strategy.notes ?? undefined,
        },
        create: {
          clientId,
          yearMonth,
          status: CycleStatus.ACTIVE,
          focus: strategy.focus,
          goals: strategy.goals,
          strategySummary: strategy.notes ?? null,
          startedAt: new Date(),
        },
      });
    }

    // Obtener el cycle activo para asociar tareas
    const cycle = await prisma.monthlyCycle.findFirst({
      where: { clientId, yearMonth },
    });

    if (!cycle) {
      console.warn(`[cerebro-tasks-sync] No cycle for ${clientId} ${yearMonth} — skipping task sync`);
      return;
    }

    // ── Upsert de tareas ──────────────────────────────────────────────────────

    const cerebroTaskIds = tasks.map((t) => t.id);

    for (const ct of tasks) {
      const taskStatus: TaskStatus =
        ct.status === "done" ? TaskStatus.DONE :
        ct.status === "in_progress" ? TaskStatus.IN_PROGRESS :
        ct.status === "blocked" ? TaskStatus.BLOCKED :
        TaskStatus.PENDING;

      await prisma.task.upsert({
        where: { notionTaskId: ct.id },
        update: {
          title: ct.title,
          description: ct.description ?? null,
          status: taskStatus,
          assignedTo: ct.assignee ?? null,
          dueDate: ct.dueDate ? new Date(ct.dueDate) : null,
          affectedUrls: ct.affectedUrls,
        },
        create: {
          cycleId: cycle.id,
          notionTaskId: ct.id,
          title: ct.title,
          description: ct.description ?? null,
          status: taskStatus,
          priority: 50, // default mid-priority hasta que se establezca desde Cerebro
          assignedTo: ct.assignee ?? null,
          dueDate: ct.dueDate ? new Date(ct.dueDate) : null,
          affectedUrls: ct.affectedUrls,
        },
      });

      // Crear hipótesis si la tarea la tiene y no existe todavía
      if (ct.hypothesis) {
        const existingTask = await prisma.task.findUnique({
          where: { notionTaskId: ct.id },
          include: { hypothesis: true },
        });
        if (existingTask && !existingTask.hypothesis) {
          await prisma.hypothesis.create({
            data: {
              clientId,
              cycleId: cycle.id,
              taskId: existingTask.id,
              statement: ct.hypothesis.expectedResult,
              expectedMetric: "position", // default — se refinará cuando RankTracking esté activo
              expectedDelta: 0,
              timeframeDays: ct.hypothesis.timeframeDays,
              baseline: {}, // null baseline — se llenará en Fase 3 cuando haya rankings
              validation: "PENDING",
            },
          });
        }
      }
    }

    // Eliminar tareas locales que ya no aparecen en Cerebro (completadas/borradas)
    if (cerebroTaskIds.length > 0) {
      await prisma.task.deleteMany({
        where: {
          cycleId: cycle.id,
          notionTaskId: { not: null, notIn: cerebroTaskIds },
        },
      });
    }

    // ── Resolve pending ClaimChecks from Notion task status ──────────────
    try {
      const pendingClaims = await prisma.claimCheck.findMany({
        where: { clientId, status: "PENDING", notionTaskId: { not: null } },
        select: { id: true, notionTaskId: true, claim: true },
      });

      if (pendingClaims.length > 0) {
        // Check each Notion task's status
        for (const claim of pendingClaims) {
          const notionTask = tasks.find((t) => t.id === claim.notionTaskId);
          if (!notionTask) continue;

          if (notionTask.status === "done") {
            // Confirmed → update claim + write learning to Cerebro
            await prisma.claimCheck.update({
              where: { id: claim.id },
              data: { status: "CONFIRMED", resolvedAt: new Date(), resolvedBy: "confirmed_by_client" },
            });
            // Write learning to Notion via bridge
            try {
              const { invalidateClientContext } = await import("@/lib/client-context");
              const slug = client.cerebroClientId
                ? (await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } }))?.name
                    ?.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") ?? ""
                : "";
              if (slug) {
                const baseUrl = process.env.CEREBRO_API_URL;
                const secret = process.env.SEO_INTERNAL_SECRET ?? process.env.CEREBRO_INTERNAL_SECRET;
                if (baseUrl && secret) {
                  const currentCtx = await fetch(`${baseUrl}/api/internal/client-context/${slug}`, {
                    headers: { Authorization: `Bearer ${secret}` },
                  }).then((r) => r.json()).catch(() => ({ ok: false })) as { ok: boolean; ctx?: { aprendizajes?: string } };

                  const existing = currentCtx.ok ? (currentCtx.ctx?.aprendizajes ?? "") : "";
                  const newLearning = `\n- [${new Date().toISOString().slice(0, 10)}] CONFIRMADO: ${claim.claim}`;

                  await fetch(`${baseUrl}/api/internal/client-context/${slug}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
                    body: JSON.stringify({ patch: { aprendizajes: existing + newLearning } }),
                  }).catch(() => {});
                }
              }
              await invalidateClientContext(clientId);
            } catch { /* learning write non-critical */ }
          } else if (notionTask.status === "blocked") {
            // Denied → update claim + add to excludedServices + create correction task
            await prisma.claimCheck.update({
              where: { id: claim.id },
              data: { status: "DENIED", resolvedAt: new Date(), resolvedBy: "denied_by_client" },
            });
            // Add to excludedServices
            const cl = await prisma.client.findUnique({ where: { id: clientId }, select: { excludedServices: true } });
            if (cl && !cl.excludedServices.includes(claim.claim)) {
              await prisma.client.update({
                where: { id: clientId },
                data: { excludedServices: [...cl.excludedServices, claim.claim] },
              });
            }
            const { invalidateClientContext } = await import("@/lib/client-context");
            await invalidateClientContext(clientId);
          }
        }
      }
    } catch (err) {
      console.warn(`[cerebro-tasks-sync] ${clientId}: claim sync error: ${(err as Error).message}`);
    }

    console.log(`[cerebro-tasks-sync] ${clientId}: synced ${tasks.length} tasks, strategy: ${strategy ? "✓" : "—"}`);
  },
  { connection: redisBullMQ, concurrency: 3 }
);

worker.on("error", (err) => {
  console.error("[cerebro-tasks-sync] Worker error:", err);
});

export { worker as cerebroTasksSyncWorker };
