/**
 * cycle-close.ts
 * Lógica de cierre de ciclo mensual.
 *
 * Cierre = operación atómica que:
 *  1. Marca tareas PENDING / IN_PROGRESS → BLOCKED
 *  2. Auto-valida hipótesis PENDING:
 *     - Si su tarea asociada terminó DONE → VALIDATED
 *     - Si no tiene tarea o la tarea quedó pendiente → PARTIAL (revisar manualmente)
 *  3. Establece cycle.status = CLOSED + cycle.closedAt = now
 */

import { prisma } from "@/lib/db";

export interface CycleCloseResult {
  cycleId: string;
  yearMonth: string;
  tasksBlocked: number;
  hypothesesValidated: number;
  hypothesesPartial: number;
  closedAt: Date;
}

export async function closeCycle(
  clientId: string
): Promise<CycleCloseResult> {
  // Buscar el ciclo más reciente que esté en estado cerrable
  const cycle = await prisma.monthlyCycle.findFirst({
    where: {
      clientId,
      status: { in: ["ACTIVE", "CLOSING"] },
    },
    orderBy: { yearMonth: "desc" },
    include: {
      tasks: {
        select: { id: true, status: true },
      },
      hypotheses: {
        select: { id: true, validation: true, taskId: true },
      },
    },
  });

  if (!cycle) {
    throw new Error("No hay ciclo activo para cerrar en este cliente.");
  }

  const now = new Date();

  // ── 1. Tareas que quedan sin terminar → BLOCKED ──────────────────────────
  const pendingTaskIds = cycle.tasks
    .filter((t) => t.status === "PENDING" || t.status === "IN_PROGRESS")
    .map((t) => t.id);

  // IDs de tareas que SÍ terminaron (para validar hipótesis)
  const doneTaskIds = new Set(
    cycle.tasks.filter((t) => t.status === "DONE").map((t) => t.id)
  );

  // ── 2. Hipótesis PENDING → validar algorítmicamente ─────────────────────
  const pendingHypotheses = cycle.hypotheses.filter(
    (h) => h.validation === "PENDING"
  );

  const toValidate: string[] = [];
  const toPartial: string[] = [];

  for (const h of pendingHypotheses) {
    if (h.taskId && doneTaskIds.has(h.taskId)) {
      toValidate.push(h.id);
    } else {
      toPartial.push(h.id);
    }
  }

  // ── 3. Transacción atómica ───────────────────────────────────────────────
  await prisma.$transaction([
    // Bloquear tareas pendientes
    ...(pendingTaskIds.length > 0
      ? [
          prisma.task.updateMany({
            where: { id: { in: pendingTaskIds } },
            data: { status: "BLOCKED" },
          }),
        ]
      : []),

    // Hipótesis validadas (tarea completada)
    ...(toValidate.length > 0
      ? [
          prisma.hypothesis.updateMany({
            where: { id: { in: toValidate } },
            data: {
              validation: "VALIDATED",
              validatedAt: now,
              validationNotes: "Tarea asociada completada al cierre del ciclo.",
            },
          }),
        ]
      : []),

    // Hipótesis parciales (requieren revisión manual)
    ...(toPartial.length > 0
      ? [
          prisma.hypothesis.updateMany({
            where: { id: { in: toPartial } },
            data: {
              validation: "PARTIAL",
              validatedAt: now,
              validationNotes:
                "Validación automática: sin evidencia conclusiva al cierre. Revisar manualmente.",
            },
          }),
        ]
      : []),

    // Cerrar ciclo
    prisma.monthlyCycle.update({
      where: { id: cycle.id },
      data: { status: "CLOSED", closedAt: now },
    }),
  ]);

  return {
    cycleId: cycle.id,
    yearMonth: cycle.yearMonth,
    tasksBlocked: pendingTaskIds.length,
    hypothesesValidated: toValidate.length,
    hypothesesPartial: toPartial.length,
    closedAt: now,
  };
}
