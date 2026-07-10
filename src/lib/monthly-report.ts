/**
 * Monthly Report — generación automática de reporte mensual SEO.
 *
 * Agrega todos los datos del período (rankings, backlinks, competencia,
 * AI search, oportunidades GSC, ciclo activo) y genera un reporte ejecutivo
 * estructurado con Claude Sonnet 4.6.
 *
 * Diferencia vs Análisis Claude:
 *   - Análisis Claude: snapshot del estado actual, interno, sin período fijo.
 *   - Reporte Mensual: cubre un mes concreto, orientado a compartir con el cliente,
 *     con comparativa vs mes anterior y plan del próximo mes.
 *
 * Costo estimado: ~$0.02–0.04 USD por reporte.
 */

import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "@/lib/anthropic-config";
import { prisma } from "@/lib/db";
import { calculateClaudeCost, logApiUsage } from "@/server/jobs/workers/base-worker";
import { Decimal } from "@prisma/client/runtime/library";

// ─── Tipos públicos ─────────────────────────────────────────────────────────

export interface ReportKeywordMovement {
  term: string;
  posicionActual: number;
  posicionAnterior: number;
  delta: number;
}

export interface ReportMetricas {
  keywords: {
    total: number;
    mejoraron: number;
    cayeron: number;
    sinCambio: number;
    topMejoras: ReportKeywordMovement[];
    topCaidas: ReportKeywordMovement[];
  };
  backlinks: {
    total: number;
    dominiosUnicos: number;
    ganados: number;
    perdidos: number;
  } | null;
  aiSearch: {
    tasaMencion: number;
    queriesAnalizadas: number;
  } | null;
  ciclo: {
    tareasCompletadas: number;
    tareasTotal: number;
    hipotesisValidadas: number;
    hipotesisTotal: number;
  } | null;
}

export interface MonthlyReportResult {
  periodo: string;                      // "Junio 2026"
  resumenEjecutivo: string;             // 2-3 oraciones con lo más importante
  logros: string[];                     // 3-5 logros del mes
  desafios: string[];                   // 2-3 desafíos / problemas detectados
  metricas: ReportMetricas;             // datos estructurados (calculados por código)
  oportunidades: Array<{
    titulo: string;
    descripcion: string;
    accion: string;
    impacto: "alto" | "medio" | "bajo";
  }>;
  planProximoMes: string[];             // 3-5 acciones concretas
  conclusionEjecutiva: string;          // 1 párrafo de cierre
}

// ─── Sistema prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres el analista SEO senior de Click Society, agencia de marketing digital en Monterrey, México.

Tu trabajo: generar el reporte mensual SEO de un cliente basado en los datos del período.
El reporte debe ser ejecutivo, orientado a resultados, y listo para compartir con el cliente.

PRINCIPIOS:
- Cita números concretos cuando estén disponibles
- Cada logro y desafío debe estar respaldado por datos del contexto
- El plan del próximo mes debe ser específico y accionable
- Tono profesional pero directo — sin relleno genérico
- Conecta los resultados SEO con los objetivos del negocio cuando sea posible

RESPONDE ÚNICAMENTE con un JSON válido con esta estructura exacta:
{
  "resumenEjecutivo": "2-3 oraciones con los puntos más importantes del mes",
  "logros": [
    "Logro 1 con datos concretos",
    "Logro 2",
    "Logro 3"
  ],
  "desafios": [
    "Desafío 1 con contexto",
    "Desafío 2"
  ],
  "oportunidades": [
    {
      "titulo": "Título corto (máx 60 chars)",
      "descripcion": "Qué está pasando y por qué es oportunidad",
      "accion": "Acción concreta a tomar en el próximo mes",
      "impacto": "alto|medio|bajo"
    }
  ],
  "planProximoMes": [
    "Acción 1 específica y medible",
    "Acción 2",
    "Acción 3"
  ],
  "conclusionEjecutiva": "1 párrafo conectando el mes con la estrategia de largo plazo"
}

Máximo: 5 logros, 3 desafíos, 4 oportunidades, 5 acciones en el plan.
Sin texto fuera del JSON.`;

// ─── Recopilación de contexto del período ───────────────────────────────────

async function gatherReportContext(clientId: string, yearMonth: string): Promise<{
  text: string;
  metricas: ReportMetricas;
}> {
  // Calcular rango de fechas del período
  const [year, month] = yearMonth.split("-").map(Number);
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59);
  const startOfPrevMonth = new Date(year, month - 2, 1);

  const [
    client,
    cycle,
    keywords,
    rankingsThisMonth,
    backlinkSnapshot,
    prevBacklinkSnapshot,
    aiSearchThisMonth,
    insights,
  ] = await Promise.all([
    prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { name: true, domain: true, plan: true },
    }),

    // Ciclo del mes (o el más reciente)
    prisma.monthlyCycle.findFirst({
      where: {
        clientId,
        yearMonth,
      },
      include: {
        tasks: {
          select: { title: true, status: true, priority: true },
        },
        hypotheses: {
          select: { statement: true, validation: true, expectedMetric: true, expectedDelta: true },
        },
      },
    }),

    // Keywords con sus rankings del mes
    prisma.keyword.findMany({
      where: { clientId, deletedAt: null },
      select: {
        term: true,
        isPriority: true,
        rankings: {
          where: {
            date: { gte: startOfPrevMonth },
          },
          orderBy: { date: "desc" },
          take: 4,
          select: { position: true, date: true, delta: true },
        },
      },
      orderBy: [{ isPriority: "desc" }, { createdAt: "asc" }],
      take: 30,
    }),

    // Rankings del mes con mayor movimiento
    prisma.keywordRanking.findMany({
      where: {
        keyword: { clientId },
        date: { gte: startOfMonth, lte: endOfMonth },
        delta: { not: null },
      },
      include: { keyword: { select: { term: true, isPriority: true } } },
      orderBy: { delta: "asc" },
      take: 20,
    }),

    // Snapshot de backlinks más reciente del mes
    prisma.backlinkSnapshot.findFirst({
      where: {
        clientId,
        capturedAt: { lte: endOfMonth },
      },
      orderBy: { capturedAt: "desc" },
    }),

    // Snapshot anterior (para comparar)
    prisma.backlinkSnapshot.findFirst({
      where: {
        clientId,
        capturedAt: { lt: startOfMonth },
      },
      orderBy: { capturedAt: "desc" },
    }),

    // AI Search del mes
    prisma.aiSearchVisibility.findMany({
      where: {
        clientId,
        date: { gte: startOfMonth, lte: endOfMonth },
      },
      select: { mentioned: true, query: true },
    }),

    // Insights del mes (no descartados)
    prisma.insight.findMany({
      where: {
        clientId,
        dismissed: false,
        generatedAt: { gte: startOfMonth },
      },
      orderBy: [{ severity: "desc" }, { generatedAt: "desc" }],
      select: { type: true, severity: true, title: true, description: true },
      take: 10,
    }),
  ]);

  // ── Calcular métricas de keywords ──────────────────────────────────────────

  type KwMovement = { term: string; posicionActual: number; posicionAnterior: number; delta: number };
  let mejoraron = 0;
  let cayeron = 0;
  let sinCambio = 0;
  const movimientos: KwMovement[] = [];

  for (const kw of keywords) {
    if (kw.rankings.length < 2) continue;
    const latest = kw.rankings[0];
    const prev = kw.rankings[kw.rankings.length - 1];
    if (latest.position == null || prev.position == null) continue;
    const delta = prev.position - latest.position; // positivo = mejoró
    if (delta > 0) mejoraron++;
    else if (delta < 0) cayeron++;
    else sinCambio++;
    movimientos.push({ term: kw.term, posicionActual: latest.position, posicionAnterior: prev.position, delta });
  }

  const topMejoras = movimientos
    .filter((m) => m.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5);

  const topCaidas = movimientos
    .filter((m) => m.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 5);

  // ── Métricas backlinks ─────────────────────────────────────────────────────

  const backlinkMetricas = backlinkSnapshot
    ? {
        total: backlinkSnapshot.totalBacklinks,
        dominiosUnicos: backlinkSnapshot.uniqueDomains,
        ganados: backlinkSnapshot.gainedThisWeek,
        perdidos: backlinkSnapshot.lostThisWeek,
      }
    : null;

  // ── Métricas AI Search ─────────────────────────────────────────────────────

  const aiSearchMetricas =
    aiSearchThisMonth.length > 0
      ? {
          tasaMencion: Math.round(
            (aiSearchThisMonth.filter((r) => r.mentioned).length / aiSearchThisMonth.length) * 100
          ),
          queriesAnalizadas: aiSearchThisMonth.length,
        }
      : null;

  // ── Métricas ciclo ─────────────────────────────────────────────────────────

  const cicloMetricas = cycle
    ? {
        tareasCompletadas: cycle.tasks.filter((t) => t.status === "DONE").length,
        tareasTotal: cycle.tasks.length,
        hipotesisValidadas: cycle.hypotheses.filter((h) => h.validation !== "PENDING").length,
        hipotesisTotal: cycle.hypotheses.length,
      }
    : null;

  const metricas: ReportMetricas = {
    keywords: {
      total: keywords.length,
      mejoraron,
      cayeron,
      sinCambio,
      topMejoras,
      topCaidas,
    },
    backlinks: backlinkMetricas,
    aiSearch: aiSearchMetricas,
    ciclo: cicloMetricas,
  };

  // ── Construir texto del contexto para Claude ───────────────────────────────

  const monthNames = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  const periodoLabel = `${monthNames[month - 1]} ${year}`;

  const lines: string[] = [];
  lines.push(`# Reporte mensual SEO — ${client.name}`);
  lines.push(`Período: ${periodoLabel} | Dominio: ${client.domain} | Plan: ${client.plan}`);
  lines.push("");

  // Ciclo y estrategia
  if (cycle) {
    lines.push(`## Ciclo ${yearMonth} (${cycle.status})`);
    if (cycle.focus) lines.push(`Foco: ${cycle.focus}`);
    if (cycle.goals.length > 0) lines.push(`Objetivos: ${cycle.goals.join(" | ")}`);
    if (cycle.strategySummary) lines.push(`Estrategia: ${cycle.strategySummary}`);
    const completadas = cycle.tasks.filter((t) => t.status === "DONE").length;
    lines.push(`Tareas: ${completadas}/${cycle.tasks.length} completadas`);
    if (cycle.tasks.length > 0) {
      lines.push(`  Completadas: ${cycle.tasks.filter((t) => t.status === "DONE").map((t) => t.title).join(", ") || "ninguna"}`);
      lines.push(`  Pendientes: ${cycle.tasks.filter((t) => t.status !== "DONE").map((t) => t.title).join(", ") || "ninguna"}`);
    }
    if (cycle.hypotheses.length > 0) {
      lines.push(`Hipótesis: ${cycle.hypotheses.map((h) => `"${h.statement.slice(0, 70)}" → ${h.validation}`).join(" | ")}`);
    }
    lines.push("");
  }

  // Rankings
  lines.push(`## Rankings (${keywords.length} keywords tracked)`);
  lines.push(`Mejoraron: ${mejoraron} | Cayeron: ${cayeron} | Sin cambio: ${sinCambio}`);
  if (topMejoras.length > 0) {
    lines.push(`Top mejoras: ${topMejoras.map((m) => `"${m.term}" ${m.posicionAnterior}→${m.posicionActual} (+${m.delta})`).join(", ")}`);
  }
  if (topCaidas.length > 0) {
    lines.push(`Top caídas: ${topCaidas.map((m) => `"${m.term}" ${m.posicionAnterior}→${m.posicionActual} (${m.delta})`).join(", ")}`);
  }

  // Keywords prioritarias
  const priorityKws = keywords.filter((k) => k.isPriority);
  if (priorityKws.length > 0) {
    lines.push(`Keywords prioritarias (${priorityKws.length}):`);
    for (const kw of priorityKws.slice(0, 10)) {
      const latest = kw.rankings[0];
      const pos = latest?.position != null ? `#${latest.position}` : "sin datos";
      const mv = movimientos.find((m) => m.term === kw.term);
      const deltaStr = mv ? (mv.delta > 0 ? ` ▲${mv.delta}` : mv.delta < 0 ? ` ▼${Math.abs(mv.delta)}` : "") : "";
      lines.push(`  - "${kw.term}": ${pos}${deltaStr}`);
    }
  }
  lines.push("");

  // Backlinks
  if (backlinkSnapshot) {
    lines.push(`## Backlinks`);
    lines.push(`Total: ${backlinkSnapshot.totalBacklinks} | Dominios: ${backlinkSnapshot.uniqueDomains} | Dofollow: ${backlinkSnapshot.dofollowCount}`);
    if (prevBacklinkSnapshot) {
      const diffTotal = backlinkSnapshot.totalBacklinks - prevBacklinkSnapshot.totalBacklinks;
      const diffDominios = backlinkSnapshot.uniqueDomains - prevBacklinkSnapshot.uniqueDomains;
      lines.push(`Vs mes anterior: backlinks ${diffTotal >= 0 ? "+" : ""}${diffTotal}, dominios ${diffDominios >= 0 ? "+" : ""}${diffDominios}`);
    }
    lines.push(`Semana actual: +${backlinkSnapshot.gainedThisWeek} ganados, -${backlinkSnapshot.lostThisWeek} perdidos`);
    lines.push("");
  }

  // AI Search
  if (aiSearchThisMonth.length > 0) {
    const mentioned = aiSearchThisMonth.filter((r) => r.mentioned).length;
    const rate = Math.round((mentioned / aiSearchThisMonth.length) * 100);
    lines.push(`## AI Search Visibility`);
    lines.push(`Tasa de mención en Claude: ${rate}% (${mentioned}/${aiSearchThisMonth.length} queries)`);
    lines.push("");
  }

  // Insights
  if (insights.length > 0) {
    lines.push(`## Insights del sistema (${insights.length})`);
    for (const ins of insights) {
      lines.push(`  - [${ins.severity}] ${ins.title}: ${ins.description.slice(0, 100)}`);
    }
    lines.push("");
  }

  // Rankings con mayor movimiento del mes
  if (rankingsThisMonth.length > 0) {
    const drops = rankingsThisMonth.filter((r) => (r.delta ?? 0) < -5);
    const rises = [...rankingsThisMonth].reverse().filter((r) => (r.delta ?? 0) > 5);
    if (drops.length > 0) {
      lines.push(`Caídas importantes este mes: ${drops.slice(0, 5).map((r) => `"${r.keyword.term}" ${r.delta}`).join(", ")}`);
    }
    if (rises.length > 0) {
      lines.push(`Subidas importantes este mes: ${rises.slice(0, 5).map((r) => `"${r.keyword.term}" +${r.delta}`).join(", ")}`);
    }
  }

  return { text: lines.join("\n"), metricas };
}

// ─── Generación del reporte ──────────────────────────────────────────────────

export async function generateMonthlyReport(
  clientId: string,
  yearMonth: string,
  triggeredBy?: string
): Promise<{ report: MonthlyReportResult; reportId: string }> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const { text: context, metricas } = await gatherReportContext(clientId, yearMonth);

  const [year, month] = yearMonth.split("-").map(Number);
  const monthNames = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  const periodoLabel = `${monthNames[month - 1]} ${year}`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Genera el reporte mensual SEO para ${periodoLabel}. Contexto:\n\n${context}`,
      },
    ],
  });

  const rawText = response.content[0]?.type === "text" ? response.content[0].text : "{}";

  let claudeOutput: Omit<MonthlyReportResult, "periodo" | "metricas">;
  try {
    const jsonStr = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    claudeOutput = JSON.parse(jsonStr);
  } catch {
    claudeOutput = {
      resumenEjecutivo: rawText.slice(0, 300),
      logros: [],
      desafios: [],
      oportunidades: [],
      planProximoMes: [],
      conclusionEjecutiva: "",
    };
  }

  const report: MonthlyReportResult = {
    periodo: periodoLabel,
    metricas,
    ...claudeOutput,
  };

  // Costos
  const usage = response.usage;
  const cachedTokens = (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
  const cost = calculateClaudeCost("sonnet-4-6", usage.input_tokens, usage.output_tokens, cachedTokens);

  // Persistir
  const record = await prisma.monthlyReport.create({
    data: {
      clientId,
      yearMonth,
      content: JSON.stringify(report),
      model: CLAUDE_MODEL,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cost: new Decimal(cost.toFixed(6)),
      triggeredBy: triggeredBy ?? null,
    },
  });

  await logApiUsage({
    provider: "anthropic",
    endpoint: "monthly-report/sonnet",
    cost,
    clientId,
  });

  return { report, reportId: record.id };
}
