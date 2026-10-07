/**
 * Claude Analysis — motor de análisis SEO unificado.
 *
 * Genera diagnóstico ejecutivo + tareas candidatas para el Plan mensual.
 * Es la ÚNICA fuente de recomendaciones del sistema.
 *
 * Contexto ampliado:
 * - Datos del cliente (keywords, GSC, GA4, backlinks, competidores, AI search)
 * - Señales SEO del Advisor (collectSignals)
 * - ContentPlan vigente del mes
 * - Tareas VOIDED/FAILED del plan anterior
 * - Precondiciones (setup si faltan datos)
 * - Elegibilidad (platform del sitio)
 */

import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "@/lib/anthropic-config";
import { prisma } from "@/lib/db";
import { calculateClaudeCost, logApiUsage } from "@/server/jobs/workers/base-worker";
import { Decimal } from "@prisma/client/runtime/library";
import { collectSignals } from "@/lib/seo-advisor/signals";
import { checkPreconditions } from "@/lib/seo-advisor/preconditions";
import { resolveSite } from "@/server/sites/resolve-site";
import {
  type AnalysisCandidate,
  validateCandidates,
  generateSetupCandidates,
  enforceModeRules,
  analysisResultSchema,
} from "@/lib/analysis-candidates";
import { generateContentPlan } from "@/lib/claude-content-plan";

// ─── Tipos del análisis (backward compatible) ────────────────────────────────

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

/** Resultado backward-compatible (análisis viejos sin candidatas) */
export interface AnalysisResult {
  resumenEjecutivo: string;
  oportunidades: AnalysisOpportunity[];
  riesgos: AnalysisRisk[];
  recomendaciones: string[];
  conclusionEstrategica: string;
  candidatas?: AnalysisCandidate[]; // nuevo — undefined en análisis viejos
}

// Re-export for consumers
export type { AnalysisCandidate };

// ─── System prompt (fijo, cacheable) ─────────────────────────────────────────

const SYSTEM_PROMPT = `Eres el analista SEO senior de Click Society, agencia de marketing digital en Monterrey, México.

Tu trabajo: analizar todos los datos SEO de un cliente y generar:
1. Un diagnóstico ejecutivo (resumen, oportunidades, riesgos, recomendaciones)
2. Una lista de tareas candidatas para el Plan mensual

PRINCIPIOS:
- Cita números concretos (posiciones, deltas, volúmenes, CTR)
- Cada oportunidad, riesgo y candidata debe estar respaldada por datos del contexto
- Presta atención a las FECHAS de medición de cada dato — ignora datos vencidos
- Prioriza por impacto real en tráfico y negocio
- Si un MonthlyCycle NO es del mes actual, trátalo como vencido: no uses sus deadlines, solo como antecedente histórico

CANDIDATAS — CRITERIO DE MODE:
- AI: blog en sitio con bootstrap, meta tags, H1, inserción de keywords, schema JSON-LD, enlazado interno. Solo cambios puramente de texto/código que NO requieran verificación visual.
- HYBRID: landings con plantilla, performance (Speed Index, TBT, FCP, LCP, CLS, bundle size, lazy loading, code splitting, CSS/JS sin usar), refactors, cambios de layout o de carga de JS. Criterio: "Lighthouse antes/después sin regresiones". NUNCA usar AI para performance.
- HUMAN: decisiones de diseño, cuentas externas (GSC, GBP), sitios no NEXTJS, configuración de plataformas, verificación de datos sospechosos (0 rankings con sitio publicado, GSC sin datos).

CANDIDATAS — COMPOSICIÓN OBLIGATORIA:
- MÍNIMO 4 kind CONTENT (blogs, landings, optimización de contenido existente)
- MÍNIMO 4 kind CODE (meta tags, schema, técnico, interlinking, performance)
- MÁXIMO 8 de cada tipo
- Si no hay suficientes señales, usa las ideas del Plan de Contenido vigente para CONTENT
- Si no hay suficientes datos, genera candidatas de setup/verificación con fuente "setup"
- Si aun así no se alcanzan los mínimos, explica por qué en candidatasInsuficientesRazon
- Orden: prioridad vs easy win (esfuerzo bajo + impacto alto primero)

CANDIDATAS — FUENTE:
- "signal": responde a una señal detectada (caída de keyword, CTR bajo, backlink perdido)
- "contentplan": viene del plan de contenido vigente (las ideas que se listan en el contexto)
- "analisis": diagnóstico cruzado (oportunidad identificada por tu análisis)
- "setup": configuración faltante o dato sospechoso que requiere verificación
- "pendiente-anterior": tarea VOIDED o FAILED del MonthlyPlan anterior (no del ciclo)

DATOS SOSPECHOSOS → candidatas setup:
- 0 rankings con sitio publicado → "Verificar configuración de tracking de keywords"
- GSC sin datos o N/D → "Verificar conexión de Search Console"
- AI Search 0% con contenido publicado → "Auditar elegibilidad AEO del contenido existente"

RESPONDE ÚNICAMENTE con un JSON válido:
{
  "resumenEjecutivo": "2-3 oraciones con los puntos más importantes",
  "oportunidades": [
    {"titulo": "máx 60 chars", "descripcion": "con datos", "accion": "acción concreta", "impacto": "alto|medio|bajo"}
  ],
  "riesgos": [
    {"titulo": "máx 60 chars", "descripcion": "con datos", "urgencia": "alta|media|baja"}
  ],
  "recomendaciones": ["Recomendación 1", "Recomendación 2"],
  "conclusionEstrategica": "1 párrafo conectando datos con estrategia del mes",
  "candidatas": [
    {
      "titulo": "máx 120 chars, específico y accionable",
      "descripcion": "qué hacer exactamente, máx 500 chars",
      "kind": "CONTENT|CODE",
      "mode": "AI|HYBRID|HUMAN",
      "modeReason": "por qué este modo, máx 200 chars",
      "priority": 1,
      "effort": "LOW|MEDIUM|HIGH",
      "impactoEsperado": "qué se espera lograr, máx 200 chars",
      "justificacion": "qué dato la respalda, máx 300 chars",
      "keywordObjetivo": "keyword principal o null",
      "urlObjetivo": "URL existente o slug sugerido o null",
      "fuente": "signal|contentplan|analisis|setup|pendiente-anterior"
    }
  ]
}

  "candidatasInsuficientesRazon": null
}

Máximo: 3-5 oportunidades, 2-3 riesgos, 3-5 recomendaciones.
Candidatas: MÍNIMO 8 (4 CONTENT + 4 CODE), máximo 16. Si no se alcanzan los mínimos, llena candidatasInsuficientesRazon con la razón.
Sin texto fuera del JSON.`;

// ─── Recopilación de contexto ampliado ───────────────────────────────────────

async function gatherUnifiedContext(clientId: string): Promise<{
  context: string;
  preconditions: Awaited<ReturnType<typeof checkPreconditions>>;
  hasGsc: boolean;
}> {
  // Datos base del cliente
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    select: { name: true, domain: true, plan: true, services: true, status: true },
  });

  // Site con elegibilidad
  const site = await resolveSite(clientId).catch(() => null);

  // Queries en paralelo
  const [
    cycle,
    keywords,
    recentRankings,
    insights,
    backlinkSnapshot,
    competitors,
    aiSearchRecent,
    signals,
    preconditions,
    contentPlan,
    previousPlan,
  ] = await Promise.all([
    // Ciclo actual
    prisma.monthlyCycle.findFirst({
      where: { clientId, status: { in: ["ACTIVE", "PLANNING"] } },
      orderBy: { yearMonth: "desc" },
      include: {
        tasks: { where: { status: { not: "DONE" } }, select: { title: true, status: true, priority: true }, take: 10 },
        hypotheses: { select: { statement: true, validation: true, expectedMetric: true, expectedDelta: true }, take: 5 },
      },
    }),
    // Keywords
    prisma.keyword.findMany({
      where: { clientId, deletedAt: null },
      select: {
        term: true, isPriority: true, targetUrl: true,
        rankings: { orderBy: { date: "desc" }, take: 2, select: { position: true, date: true, delta: true } },
      },
      orderBy: [{ isPriority: "desc" }, { createdAt: "asc" }],
      take: 20,
    }),
    // Rankings con mayor movimiento
    prisma.keywordRanking.findMany({
      where: { keyword: { clientId }, date: { gte: new Date(Date.now() - 14 * 86400000) }, delta: { not: null } },
      include: { keyword: { select: { term: true } } },
      orderBy: { delta: "asc" },
      take: 10,
    }),
    // Insights
    prisma.insight.findMany({
      where: { clientId, dismissed: false },
      orderBy: [{ severity: "desc" }, { generatedAt: "desc" }],
      select: { type: true, severity: true, title: true, description: true },
      take: 8,
    }),
    // Backlinks
    prisma.backlinkSnapshot.findFirst({ where: { clientId }, orderBy: { capturedAt: "desc" } }),
    // Competidores
    prisma.competitor.findMany({
      where: { clientId, deletedAt: null },
      include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
      take: 5,
    }),
    // AI Search
    prisma.aiSearchVisibility.findMany({
      where: { clientId, date: { gte: new Date(Date.now() - 28 * 86400000) } },
      select: { mentioned: true, query: true, position: true },
    }),
    // Señales del Advisor (reutiliza, no copia)
    collectSignals(clientId),
    // Precondiciones
    checkPreconditions(clientId),
    // ContentPlan vigente del mes
    prisma.contentPlan.findFirst({
      where: { clientId },
      orderBy: { createdAt: "desc" },
    }),
    // Plan mensual anterior (para VOIDED/FAILED)
    (async () => {
      const now = new Date();
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevYearMonth = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
      return prisma.monthlyPlan.findFirst({
        where: { clientId, month: prevYearMonth },
        include: {
          tasks: {
            where: { status: { in: ["VOIDED", "FAILED"] } },
            select: { title: true, status: true, failureReason: true, voidReason: true, kind: true },
          },
        },
      });
    })(),
  ]);

  // ── Auto-generar ContentPlan si no existe ─────────────────────────────
  let contentPlanIdeas: Array<{ titulo: string; tipo: string; keywords: string[]; prioridad: string; razon: string; urlSugerida?: string }> = [];
  if (contentPlan) {
    contentPlanIdeas = (contentPlan.ideas as unknown as typeof contentPlanIdeas) ?? [];
  } else {
    // Generar ContentPlan automáticamente
    try {
      const { plan: newPlan } = await generateContentPlan(clientId);
      contentPlanIdeas = (newPlan.ideas as unknown as typeof contentPlanIdeas) ?? [];
      console.log(`[analysis] ContentPlan auto-generado: ${contentPlanIdeas.length} ideas`);
    } catch (err) {
      console.warn("[analysis] No se pudo auto-generar ContentPlan:", err instanceof Error ? err.message : err);
    }
  }

  // ── Determinar vigencia del ciclo ──────────────────────────────────────
  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const cycleIsCurrent = cycle?.yearMonth === currentYearMonth;

  // ── Formatear contexto ──────────────────────────────────────────────────

  const lines: string[] = [];

  lines.push(`# Contexto SEO — ${client.name}`);
  lines.push(`**Fecha actual: ${now.toISOString().slice(0, 10)}** (mes: ${currentYearMonth})`);
  lines.push(`Dominio: ${client.domain} | Plan: ${client.plan} | Servicios: ${client.services.join(", ")} | Estado: ${client.status}`);

  // Elegibilidad
  if (site) {
    lines.push(`Framework (Notion): ${site.framework ?? "N/D"} | Platform (producción): ${site.platform ?? "no detectada"} | Repo: ${site.githubRepo ?? "N/D"}`);
  }
  lines.push("");

  // Ciclo
  if (cycle) {
    if (cycleIsCurrent) {
      lines.push(`## Ciclo vigente: ${cycle.yearMonth} (${cycle.status})`);
      if (cycle.focus) lines.push(`Foco: ${cycle.focus}`);
      if (cycle.goals.length > 0) lines.push(`Objetivos: ${cycle.goals.join(" | ")}`);
    } else {
      lines.push(`## Ciclo anterior: ${cycle.yearMonth} (${cycle.status}) — ⚠ VENCIDO, solo como antecedente`);
      lines.push("INSTRUCCIÓN: este ciclo NO es del mes actual. NO uses sus deadlines. Sus tareas son solo contexto histórico.");
      if (cycle.focus) lines.push(`Foco (histórico): ${cycle.focus}`);
    }
    if (cycle.tasks.length > 0) {
      lines.push(`Tareas ${cycleIsCurrent ? "activas" : "históricas"}: ${cycle.tasks.map((t) => `${t.title} [${t.status}]`).join(", ")}`);
    }
    if (cycle.hypotheses.length > 0) {
      lines.push(`Hipótesis: ${cycle.hypotheses.map((h) => `"${h.statement.slice(0, 60)}..." → ${h.validation}`).join(" | ")}`);
    }
    lines.push("");
  }

  // Keywords
  const priorityKws = keywords.filter((k) => k.isPriority);
  lines.push(`## Keywords (${keywords.length} total, ${priorityKws.length} prioritarias)`);
  for (const kw of priorityKws) {
    const latest = kw.rankings[0];
    const pos = latest?.position != null ? `#${latest.position}` : "sin posición";
    const delta = latest?.delta != null ? (latest.delta > 0 ? `(▲${latest.delta})` : `(▼${Math.abs(latest.delta)})`) : "";
    lines.push(`  - "${kw.term}": ${pos} ${delta}`);
  }
  lines.push("");

  // Movimientos
  if (recentRankings.length > 0) {
    const dropped = recentRankings.filter((r) => (r.delta ?? 0) < -3);
    const improved = [...recentRankings].reverse().filter((r) => (r.delta ?? 0) > 3);
    if (dropped.length > 0) lines.push(`Caídas (14d): ${dropped.slice(0, 5).map((r) => `"${r.keyword.term}" ${r.delta} pos`).join(", ")}`);
    if (improved.length > 0) lines.push(`Mejoras: ${improved.slice(0, 5).map((r) => `"${r.keyword.term}" +${r.delta} pos`).join(", ")}`);
    lines.push("");
  }

  // Backlinks
  if (backlinkSnapshot) {
    lines.push(`## Backlinks: ${backlinkSnapshot.totalBacklinks} total | ${backlinkSnapshot.uniqueDomains} dominios | +${backlinkSnapshot.gainedThisWeek} -${backlinkSnapshot.lostThisWeek} semana`);
    lines.push("");
  }

  // Competidores
  if (competitors.length > 0) {
    lines.push(`## Competidores (${competitors.length})`);
    for (const comp of competitors) {
      const snap = comp.snapshots[0];
      lines.push(`  - ${comp.domain}: ${snap ? `DR ${snap.domainRank ?? "?"}, SoV ${snap.shareOfVoicePct ?? "?"}%, gaps ${snap.gapsCount ?? "?"}` : "sin datos"}`);
    }
    lines.push("");
  }

  // AI Search
  if (aiSearchRecent.length > 0) {
    const mentioned = aiSearchRecent.filter((r) => r.mentioned).length;
    lines.push(`## AI Search: ${Math.round((mentioned / aiSearchRecent.length) * 100)}% mención (${mentioned}/${aiSearchRecent.length})`);
    lines.push("");
  }

  // Insights
  if (insights.length > 0) {
    lines.push(`## Insights (${insights.length} activos)`);
    for (const ins of insights) {
      lines.push(`  - [${ins.type}/${ins.severity}] ${ins.title}`);
    }
    lines.push("");
  }

  // Señales del Advisor
  if (signals.hasSignals) {
    lines.push(signals.text);
    lines.push("");
  }

  // ContentPlan vigente
  if (contentPlanIdeas.length > 0) {
    lines.push(`## Plan de contenido vigente (${contentPlanIdeas.length} ideas)`);
    for (const idea of contentPlanIdeas.slice(0, 10)) {
      lines.push(`  - [${idea.tipo}/${idea.prioridad}] "${idea.titulo}" → keywords: ${idea.keywords?.join(", ") ?? "N/D"}`);
    }
    lines.push("INSTRUCCIÓN: las candidatas CONTENT deben salir de estas ideas. Usa fuente 'contentplan'. Si no hay suficientes, complementa con fuente 'analisis'.");
    lines.push("");
  }

  // Tareas VOIDED/FAILED del plan anterior
  if (previousPlan && previousPlan.tasks.length > 0) {
    lines.push(`## Tareas pendientes del plan anterior (${previousPlan.month})`);
    for (const t of previousPlan.tasks) {
      const reason = t.status === "VOIDED" ? t.voidReason : t.failureReason;
      lines.push(`  - [${t.status}] "${t.title}" (${t.kind}) — ${reason ?? "sin motivo"}`);
    }
    lines.push("INSTRUCCIÓN: estas tareas deben reconsiderarse como candidatas con fuente 'pendiente-anterior' si siguen siendo relevantes.");
    lines.push("");
  }

  // Precondiciones
  if (!preconditions.isDataSufficient) {
    lines.push("## ⚠ Datos insuficientes");
    lines.push("El cliente no tiene suficiente configuración SEO. Las candidatas deben incluir tareas de setup con fuente 'setup'.");
    if (!preconditions.hasKeywords) lines.push("  - Falta: keywords prioritarias");
    if (!preconditions.hasCompetitors) lines.push("  - Falta: competidores (mín 2)");
    if (!preconditions.hasSiteAudit) lines.push("  - Falta: audit técnico");
    lines.push("");
  }

  return {
    context: lines.join("\n"),
    preconditions,
    hasGsc: !!site?.gscProperty,
  };
}

// ─── Llamada a Claude ────────────────────────────────────────────────────────

export async function generateClientAnalysis(
  clientId: string,
  triggeredBy?: string
): Promise<{ analysis: AnalysisResult; analysisId: string }> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const { context, preconditions, hasGsc } = await gatherUnifiedContext(clientId);

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 12000,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      { role: "user", content: `Analiza el siguiente contexto SEO y genera el diagnóstico ejecutivo + candidatas para el Plan mensual:\n\n${context}` },
    ],
  });

  const rawText = response.content[0]?.type === "text" ? response.content[0].text : "{}";

  // Parse JSON with repair
  let parsed: Record<string, unknown>;
  try {
    const jsonStr = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    // Repair truncated JSON
    let repaired = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    let braces = 0, brackets = 0, inString = false, escape = false;
    for (const ch of repaired) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") braces++;
      else if (ch === "}") braces--;
      else if (ch === "[") brackets++;
      else if (ch === "]") brackets--;
    }
    if (inString) repaired += '"';
    repaired = repaired.replace(/,\s*$/, "");
    for (let i = 0; i < brackets; i++) repaired += "]";
    for (let i = 0; i < braces; i++) repaired += "}";
    try {
      parsed = JSON.parse(repaired) as Record<string, unknown>;
    } catch {
      parsed = { resumenEjecutivo: rawText.slice(0, 500) };
    }
  }

  // Validate full result with Zod (lenient — allow missing candidatas for backward compat)
  const zodResult = analysisResultSchema.safeParse(parsed);

  let analysis: AnalysisResult;

  if (zodResult.success) {
    const validated = zodResult.data;
    // Validate candidates individually
    const { valid: validCandidates, dropped } = validateCandidates(
      validated.candidatas as unknown[]
    );
    if (dropped > 0) {
      console.warn(`[analysis] ${dropped} candidata(s) inválida(s) descartadas`);
    }

    analysis = {
      resumenEjecutivo: validated.resumenEjecutivo,
      oportunidades: validated.oportunidades,
      riesgos: validated.riesgos,
      recomendaciones: validated.recomendaciones,
      conclusionEstrategica: validated.conclusionEstrategica,
      candidatas: validCandidates,
    };
  } else {
    // Fallback: extract what we can
    console.warn("[analysis] Zod validation failed, extracting partial data:", zodResult.error.issues.slice(0, 3));
    const rawCandidatas = Array.isArray(parsed.candidatas) ? parsed.candidatas : [];
    const { valid: validCandidates } = validateCandidates(rawCandidatas);

    analysis = {
      resumenEjecutivo: String(parsed.resumenEjecutivo ?? ""),
      oportunidades: Array.isArray(parsed.oportunidades) ? (parsed.oportunidades as AnalysisOpportunity[]) : [],
      riesgos: Array.isArray(parsed.riesgos) ? (parsed.riesgos as AnalysisRisk[]) : [],
      recomendaciones: Array.isArray(parsed.recomendaciones) ? (parsed.recomendaciones as string[]) : [],
      conclusionEstrategica: String(parsed.conclusionEstrategica ?? ""),
      candidatas: validCandidates,
    };
  }

  // Enforce mode rules (performance → HYBRID, never AI)
  if (analysis.candidatas) {
    analysis.candidatas = analysis.candidatas.map(enforceModeRules);
  }

  // Add setup candidates if preconditions are missing
  const setupCandidates = generateSetupCandidates({
    hasKeywords: preconditions.hasKeywords,
    hasCompetitors: preconditions.hasCompetitors,
    hasGsc,
    hasSiteAudit: preconditions.hasSiteAudit,
    keywordCount: 0,
    competitorCount: 0,
  });

  if (setupCandidates.length > 0) {
    analysis.candidatas = [...setupCandidates, ...(analysis.candidatas ?? [])];
  }

  // Log candidate stats
  const allCandidates = analysis.candidatas ?? [];
  const contentCount = allCandidates.filter((c) => c.kind === "CONTENT").length;
  const codeCount = allCandidates.filter((c) => c.kind === "CODE").length;
  console.log(`[analysis] Candidatas: ${allCandidates.length} total (${contentCount} CONTENT, ${codeCount} CODE)`);
  if (contentCount < 4 || codeCount < 4) {
    console.warn(`[analysis] ⚠ Mínimos no alcanzados (4 CONTENT + 4 CODE). Razón: ${(analysis as unknown as Record<string, unknown>).candidatasInsuficientesRazon ?? "no especificada"}`);
  }

  // Cost
  const usage = response.usage;
  const cachedTokens = (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
  const cost = calculateClaudeCost("sonnet-4-6", usage.input_tokens, usage.output_tokens, cachedTokens);

  // Persist
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

  await logApiUsage({ provider: "anthropic", endpoint: "analysis/unified", cost, clientId });

  return { analysis, analysisId: record.id };
}
