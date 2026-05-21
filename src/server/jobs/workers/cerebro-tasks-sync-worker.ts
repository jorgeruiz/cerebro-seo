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

    console.log(`[cerebro-tasks-sync] ${clientId}: synced ${tasks.length} tasks, strategy: ${strategy ? "✓" : "—"}`);
  },
  { connection: redisBullMQ, concurrency: 3 }
);

worker.on("error", (err) => {
  console.error("[cerebro-tasks-sync] Worker error:", err);
});

export { worker as cerebroTasksSyncWorker };
