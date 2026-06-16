/**
 * Claude Analysis — motor de análisis SEO on-demand.
 *
 * Reúne todo el contexto del cliente desde la BD (sin llamadas externas)
 * y genera un análisis ejecutivo estructurado con Claude Sonnet 4.6.
 *
 * Costo estimado: ~$0.01–0.03 USD por análisis.
 */

import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "@/lib/anthropic-config";
import { prisma } from "@/lib/db";
import { calculateClaudeCost, logApiUsage } from "@/server/jobs/workers/base-worker";
import { Decimal } from "@prisma/client/runtime/library";

// ─── Tipos del análisis ────────────────────────────────────────────────────

export interface AnalysisOpportunity {
  titulo: string;
  descripcion: string;
  accion: string;
  impacto: "alto" | "medio" | "bajo";
}

export interface AnalysisRisk {
  titulo: string;
  descripcion: string;
  urgencia: "alta" | "media" | "baja";
}

export interface AnalysisResult {
  resumenEjecutivo: string;
  oportunidades: AnalysisOpportunity[];
  riesgos: AnalysisRisk[];
  recomendaciones: string[];
  conclusionEstrategica: string;
}

// ─── Sistema prompt (fijo, se beneficia de prompt caching) ─────────────────

const SYSTEM_PROMPT = `Eres el analista SEO senior de Click Society, agencia de marketing digital en Monterrey, México.

Tu trabajo: analizar todos los datos SEO disponibles de un cliente y generar un análisis ejecutivo accionable, específico y priorizado.

PRINCIPIOS:
- Cita números concretos cuando estén disponibles (posiciones, deltas, volúmenes)
- Cada oportunidad y riesgo debe estar respaldado por datos del contexto
- Cruza los datos SEO con la estrategia del ciclo actual cuando sea posible
- Prioriza por impacto real en tráfico y negocio del cliente
- Sé directo — no rellenes con frases genéricas

RESPONDE ÚNICAMENTE con un JSON válido con esta estructura exacta:
{
  "resumenEjecutivo": "2-3 oraciones con los puntos más importantes",
  "oportunidades": [
    {
      "titulo": "Título corto (máx 60 chars)",
      "descripcion": "Qué está pasando y por qué es una oportunidad (con datos)",
      "accion": "Acción concreta y específica a tomar",
      "impacto": "alto|medio|bajo"
    }
  ],
  "riesgos": [
    {
      "titulo": "Título corto",
      "descripcion": "Qué está en riesgo y por qué (con datos)",
      "urgencia": "alta|media|baja"
    }
  ],
  "recomendaciones": [
    "Recomendación 1 específica y medible",
    "Recomendación 2",
    "Recomendación 3"
  ],
  "conclusionEstrategica": "1 párrafo conectando datos SEO con la estrategia del mes"
}

Máximo: 3-5 oportunidades, 2-3 riesgos, 3-5 recomendaciones.
Sin texto fuera del JSON.`;

// ─── Recopilación de contexto ──────────────────────────────────────────────

async function gatherClientContext(clientId: string): Promise<string> {
  const [
    client,
    cycle,
    keywords,
    recentRankings,
    insights,
    backlinkSnapshot,
    competitors,
    aiSearchRecent,
  ] = await Promise.all([
    // Datos básicos del cliente
    prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { name: true, domain: true, plan: true, services: true },
    }),

    // Ciclo actual
    prisma.monthlyCycle.findFirst({
      where: { clientId, status: { in: ["ACTIVE", "PLANNING"] } },
      orderBy: { yearMonth: "desc" },
      include: {
        tasks: {
          where: { status: { not: "DONE" } },
          select: { title: true, status: true, priority: true },
          orderBy: [{ status: "asc" }, { priority: "asc" }],
          take: 10,
        },
        hypotheses: {
          select: { statement: true, validation: true, expectedMetric: true, expectedDelta: true },
          take: 5,
        },
      },
    }),

    // Keywords prioritarias con sus rankings recientes
    prisma.keyword.findMany({
      where: { clientId, deletedAt: null },
      select: {
        term: true,
        isPriority: true,
        targetUrl: true,
        rankings: {
          orderBy: { date: "desc" },
          take: 2, // último + anterior para calcular delta
          select: { position: true, date: true, delta: true },
        },
      },
      orderBy: [{ isPriority: "desc" }, { createdAt: "asc" }],
      take: 20,
    }),

    // Rankings con mayor movimiento (últimos 14 días)
    prisma.keywordRanking.findMany({
      where: {
        keyword: { clientId },
        date: { gte: new Date(Date.now() - 14 * 24 * 3600 * 1000) },
        delta: { not: null },
      },
      include: { keyword: { select: { term: true } } },
      orderBy: { delta: "asc" }, // más negativo = bajó más
      take: 10,
    }),

    // Insights recientes no descartados
    prisma.insight.findMany({
      where: { clientId, dismissed: false },
      orderBy: [{ severity: "desc" }, { generatedAt: "desc" }],
      select: { type: true, severity: true, title: true, description: true },
      take: 8,
    }),

    // Último snapshot de backlinks
    prisma.backlinkSnapshot.findFirst({
      where: { clientId },
      orderBy: { capturedAt: "desc" },
    }),

    // Competidores con último snapshot
    prisma.competitor.findMany({
      where: { clientId, deletedAt: null },
      include: {
        snapshots: {
          orderBy: { capturedAt: "desc" },
          take: 1,
        },
      },
      take: 5,
    }),

    // AI Search — últimas 4 semanas
    prisma.aiSearchVisibility.findMany({
      where: {
        clientId,
        date: { gte: new Date(Date.now() - 28 * 24 * 3600 * 1000) },
      },
      select: { mentioned: true, query: true, position: true },
    }),
  ]);

  // ── Formatear contexto ──────────────────────────────────────────────────

  const lines: string[] = [];

  lines.push(`# Contexto SEO — ${client.name}`);
  lines.push(`Dominio: ${client.domain} | Plan: ${client.plan} | Servicios: ${client.services.join(", ")}`);
  lines.push("");

  // Ciclo actual
  if (cycle) {
    lines.push(`## Ciclo actual: ${cycle.yearMonth} (${cycle.status})`);
    if (cycle.focus) lines.push(`Foco del mes: ${cycle.focus}`);
    if (cycle.goals.length > 0) lines.push(`Objetivos: ${cycle.goals.join(" | ")}`);
    if (cycle.strategySummary) lines.push(`Estrategia: ${cycle.strategySummary}`);
    if (cycle.tasks.length > 0) {
      lines.push(`Tareas activas (${cycle.tasks.length}): ${cycle.tasks.map((t) => `${t.title} [${t.status}]`).join(", ")}`);
    }
    if (cycle.hypotheses.length > 0) {
      lines.push(`Hipótesis: ${cycle.hypotheses.map((h) => `"${h.statement.slice(0, 80)}..." → ${h.validation}`).join(" | ")}`);
    }
    lines.push("");
  }

  // Keywords y rankings
  const priorityKws = keywords.filter((k) => k.isPriority);
  const otherKws = keywords.filter((k) => !k.isPriority);

  lines.push(`## Keywords (${keywords.length} total, ${priorityKws.length} prioritarias)`);

  if (priorityKws.length > 0) {
    lines.push("Prioritarias:");
    for (const kw of priorityKws) {
      const latest = kw.rankings[0];
      const pos = latest?.position != null ? `#${latest.position}` : "sin posición";
      const delta =
        latest?.delta != null
          ? latest.delta > 0
            ? `(▲${latest.delta})`
            : `(▼${Math.abs(latest.delta)})`
          : "";
      lines.push(`  - "${kw.term}": ${pos} ${delta}`);
    }
  }

  if (otherKws.slice(0, 5).length > 0) {
    lines.push(`Otras (muestra): ${otherKws.slice(0, 5).map((k) => `"${k.term}" ${k.rankings[0]?.position != null ? `#${k.rankings[0].position}` : "sin dato"}`).join(", ")}`);
  }
  lines.push("");

  // Mayores movimientos
  if (recentRankings.length > 0) {
    const dropped = recentRankings.filter((r) => (r.delta ?? 0) < -3);
    const improved = [...recentRankings].reverse().filter((r) => (r.delta ?? 0) > 3);
    if (dropped.length > 0) {
      lines.push(`Caídas significativas (últimos 14 días): ${dropped.slice(0, 5).map((r) => `"${r.keyword.term}" ${r.delta} posiciones`).join(", ")}`);
    }
    if (improved.length > 0) {
      lines.push(`Mejoras significativas: ${improved.slice(0, 5).map((r) => `"${r.keyword.term}" +${r.delta} posiciones`).join(", ")}`);
    }
    lines.push("");
  }

  // Backlinks
  if (backlinkSnapshot) {
    lines.push(`## Backlinks`);
    lines.push(
      `Total: ${backlinkSnapshot.totalBacklinks} | ` +
      `Dominios: ${backlinkSnapshot.uniqueDomains} | ` +
      `Dofollow: ${backlinkSnapshot.dofollowCount} | ` +
      `Ganados semana: +${backlinkSnapshot.gainedThisWeek} | ` +
      `Perdidos semana: -${backlinkSnapshot.lostThisWeek}`
    );
    lines.push("");
  }

  // Competidores
  if (competitors.length > 0) {
    lines.push(`## Competidores (${competitors.length})`);
    for (const comp of competitors) {
      const snap = comp.snapshots[0];
      if (snap) {
        lines.push(
          `  - ${comp.domain}: DR ${snap.domainRank ?? "?"}, ` +
          `SoV ${snap.shareOfVoicePct ?? "?"}%, ` +
          `gaps ${snap.gapsCount ?? "?"} keywords`
        );
      } else {
        lines.push(`  - ${comp.domain}: sin datos aún`);
      }
    }
    lines.push("");
  }

  // AI Search Visibility
  if (aiSearchRecent.length > 0) {
    const aiMentioned = aiSearchRecent.filter((r) => r.mentioned).length;
    const aiRate = Math.round((aiMentioned / aiSearchRecent.length) * 100);
    lines.push(`## AI Search Visibility (últimas 4 semanas)`);
    lines.push(`Tasa de mención en Claude: ${aiRate}% (${aiMentioned}/${aiSearchRecent.length} queries)`);
    lines.push("");
  }

  // Insights recientes
  if (insights.length > 0) {
    lines.push(`## Insights del sistema (${insights.length} activos)`);
    for (const ins of insights) {
      lines.push(`  - [${ins.type}/${ins.severity}] ${ins.title}: ${ins.description.slice(0, 120)}...`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Llamada a Claude ──────────────────────────────────────────────────────

export async function generateClientAnalysis(
  clientId: string,
  triggeredBy?: string
): Promise<{ analysis: AnalysisResult; analysisId: string }> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const context = await gatherClientContext(clientId);

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Analiza el siguiente contexto SEO y genera el análisis ejecutivo:\n\n${context}`,
      },
    ],
  });

  const rawText = response.content[0]?.type === "text" ? response.content[0].text : "{}";

  // Parsear JSON — si falla, retornar estructura mínima
  let analysis: AnalysisResult;
  try {
    // Claude a veces envuelve el JSON en ```json ... ``` — limpiar
    const jsonStr = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    analysis = JSON.parse(jsonStr) as AnalysisResult;
  } catch {
    analysis = {
      resumenEjecutivo: rawText.slice(0, 300),
      oportunidades: [],
      riesgos: [],
      recomendaciones: [],
      conclusionEstrategica: "",
    };
  }

  // Costos
  const usage = response.usage;
  const cachedTokens = (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
  const cost = calculateClaudeCost("sonnet-4-6", usage.input_tokens, usage.output_tokens, cachedTokens);

  // Persistir
  const record = await prisma.clientAnalysis.create({
    data: {
      clientId,
      content: JSON.stringify(analysis),
      model: CLAUDE_MODEL,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cost: new Decimal(cost.toFixed(6)),
      triggeredBy: triggeredBy ?? null,
    },
  });

  // Log ApiUsage
  await logApiUsage({
    provider: "anthropic",
    endpoint: "analysis/sonnet",
    cost,
    clientId,
  });

  return { analysis, analysisId: record.id };
}
