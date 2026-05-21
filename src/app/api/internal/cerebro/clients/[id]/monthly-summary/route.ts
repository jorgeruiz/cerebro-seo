export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Formato: "YYYY-MM" → primer y último día del mes
function monthRange(yearMonth: string): { startDate: string; endDate: string } {
  const [year, month] = yearMonth.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0); // día 0 del mes siguiente = último del actual
  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
  };
}

function prevMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const d = new Date(year, month - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  // 1. Validar header
  const authHeader = req.headers.get("authorization");
  const secret = process.env.SEO_INTERNAL_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parámetros
  const yearMonth = req.nextUrl.searchParams.get("yearMonth");
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json(
      { error: "yearMonth query param required (format: YYYY-MM)" },
      { status: 400 }
    );
  }

  // 3. Buscar cliente por cerebroClientId
  const client = await prisma.client.findFirst({
    where: { cerebroClientId: params.id },
    include: { sites: { take: 1 } },
  });

  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const prev = prevMonth(yearMonth);
  const { startDate: startCurr, endDate: endCurr } = monthRange(yearMonth);
  void monthRange(prev); // prev metrics calculables en Fase 3 con CycleCloseAgent

  // 4. Calcular métricas del mes desde BD local
  // GSC snapshot del mes vs mes anterior (desde ApiUsage como proxy — datos reales via provider si disponible)
  // Por simplicidad en esta sesión: devolver datos de BD local (Hypothesis, Task, Insight)
  // La parte GSC/GA4 en tiempo real se añadirá cuando el bridge esté activo (Fase 3)

  // Hipótesis del mes
  const cycle = await prisma.monthlyCycle.findFirst({
    where: { clientId: client.id, yearMonth },
    include: {
      hypotheses: true,
      tasks: { where: { status: "DONE" } },
    },
  });

  const prevCycle = await prisma.monthlyCycle.findFirst({
    where: { clientId: client.id, yearMonth: prev },
  });

  const hyps = cycle?.hypotheses ?? [];
  const validated = hyps.filter((h) => h.validation === "VALIDATED").length;
  const refuted = hyps.filter((h) => h.validation === "REFUTED").length;
  const partial = hyps.filter((h) => h.validation === "PARTIAL").length;
  const pending = hyps.filter((h) => h.validation === "PENDING").length;

  // Insights críticos del mes
  const criticalInsights = await prisma.insight.findMany({
    where: {
      clientId: client.id,
      generatedAt: { gte: new Date(startCurr), lte: new Date(endCurr + "T23:59:59Z") },
      severity: "critical",
    },
    select: { id: true, title: true, description: true, severity: true, generatedAt: true },
  });

  // 5. Construir respuesta según contrato integration_cerebro.md §4.3
  const summary = {
    yearMonth,
    clientId: params.id,
    metrics: {
      // Datos de métricas de tráfico: se calculan vía GSC/GA4 cuando hay tokens OAuth del cliente
      // Por ahora se devuelven placeholders — se completará en Fase 3 con CycleCloseAgent
      organicTraffic: { current: null, previous: null, delta: null, note: "Disponible en Fase 3" },
      avgPosition:    { current: null, previous: null, delta: null, note: "Disponible en Fase 3" },
      impressions:    { current: null, previous: null, delta: null, note: "Disponible en Fase 3" },
      ctr:            { current: null, previous: null, delta: null, note: "Disponible en Fase 3" },
      conversions:    { current: null, previous: null, delta: null, note: "Disponible en Fase 3" },
    },
    hypothesesResults: {
      validated,
      refuted,
      partial,
      pending,
      details: hyps.map((h) => ({
        id: h.id,
        statement: h.statement,
        expectedMetric: h.expectedMetric,
        timeframeDays: h.timeframeDays,
        validation: h.validation,
        validatedAt: h.validatedAt?.toISOString() ?? null,
        validationNotes: h.validationNotes,
      })),
    },
    tasksCompleted: (cycle?.tasks ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      completedAt: t.completedAt?.toISOString() ?? null,
    })),
    criticalIssues: criticalInsights.map((i) => ({
      id: i.id,
      title: i.title,
      description: i.description,
      severity: i.severity,
      date: i.generatedAt.toISOString(),
    })),
    _meta: {
      generatedAt: new Date().toISOString(),
      hasPrevCycle: !!prevCycle,
    },
  };

  return NextResponse.json(summary);
}
