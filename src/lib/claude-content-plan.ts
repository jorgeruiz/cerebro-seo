/**
 * Claude Content Plan — generador de ideas de contenido SEO on-demand.
 *
 * Cruza keyword gaps, oportunidades GSC, rankings actuales y estrategia del
 * ciclo para proponer un plan de contenido accionable con Claude Sonnet 4.6.
 *
 * Costo estimado: ~$0.01–0.03 USD por plan.
 */

import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "@/lib/anthropic-config";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { calculateClaudeCost, logApiUsage } from "@/server/jobs/workers/base-worker";
import { Decimal } from "@prisma/client/runtime/library";

// ─── Tipos ─────────────────────────────────────────────────────────────────

export type ContentType = "blog" | "landing" | "pilar" | "soporte";
export type ContentPriority = "alta" | "media" | "baja";

export interface ContentIdea {
  titulo: string;        // Título sugerido del contenido
  tipo: ContentType;     // Tipo de contenido
  keywords: string[];    // Keywords objetivo
  angulo: string;        // Ángulo editorial / por qué este enfoque
  prioridad: ContentPriority;
  razon: string;         // Justificación con datos (posiciones, gaps, GSC)
  urlSugerida?: string;  // Slug sugerido (opcional)
}

export interface ContentPlanResult {
  resumen: string;       // Visión general del plan
  ideas: ContentIdea[];  // 5–10 ideas ordenadas por prioridad
  notaEstrategica: string; // Cómo el plan se alinea con el ciclo actual
}

// ─── System prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres el estratega de contenido SEO senior de Click Society, agencia de marketing digital en Monterrey, México.

Tu trabajo: analizar los datos SEO de un cliente y generar un plan de contenido concreto y priorizado que mueva métricas reales.

PRINCIPIOS:
- Cada idea debe estar justificada con datos del contexto (posiciones, gaps, volúmenes de impresiones GSC, etc.)
- Prioriza contenido que pueda capturar tráfico rápido (quick wins) sobre contenido a largo plazo
- Cruza los gaps de competidores con las keywords que ya rankean en posición 4-30 para encontrar oportunidades de refuerzo
- Keywords sin URL rankeando = falta una página dedicada → landing o blog
- Keywords en posición 4-10 con buen volumen = el contenido existe pero necesita refuerzo
- Alinea el plan con el foco y objetivos del ciclo actual cuando estén disponibles

TIPOS DE CONTENIDO:
- "blog": artículo informativo, guía, how-to
- "landing": página de servicio o producto con intención transaccional
- "pilar": contenido extenso que sirve de hub temático (3,000+ palabras)
- "soporte": contenido de apoyo que apunta a un pilar (cluster content)

RESPONDE ÚNICAMENTE con un JSON válido con esta estructura exacta:
{
  "resumen": "2-3 oraciones sobre el estado del contenido del cliente y la oportunidad más grande",
  "ideas": [
    {
      "titulo": "Título sugerido del contenido (máx 80 chars)",
      "tipo": "blog|landing|pilar|soporte",
      "keywords": ["keyword1", "keyword2"],
      "angulo": "El ángulo o enfoque editorial específico de este contenido",
      "prioridad": "alta|media|baja",
      "razon": "Por qué este contenido ahora, con datos concretos del contexto",
      "urlSugerida": "/slug-sugerido-opcional"
    }
  ],
  "notaEstrategica": "1 párrafo conectando el plan de contenido con la estrategia del ciclo actual"
}

Genera entre 5 y 10 ideas. Ordénalas de mayor a menor prioridad. Sin texto fuera del JSON.`;

// ─── Recopilación de contexto ───────────────────────────────────────────────

async function gatherContentContext(clientId: string): Promise<string> {
  const [
    client,
    cycle,
    keywords,
    keywordGaps,
    gscOpportunities,
    competitors,
  ] = await Promise.all([
    prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { name: true, domain: true, plan: true, services: true },
    }),

    prisma.monthlyCycle.findFirst({
      where: { clientId, status: { in: ["ACTIVE", "PLANNING"] } },
      orderBy: { yearMonth: "desc" },
      select: {
        yearMonth: true,
        status: true,
        focus: true,
        goals: true,
        strategySummary: true,
      },
    }),

    // Todas las keywords activas con su último ranking
    prisma.keyword.findMany({
      where: { clientId, deletedAt: null },
      select: {
        term: true,
        isPriority: true,
        targetUrl: true,
        rankings: {
          orderBy: { date: "desc" },
          take: 1,
          select: { position: true, rankingUrl: true },
        },
      },
      orderBy: [{ isPriority: "desc" }, { createdAt: "asc" }],
    }),

    // Keyword gaps de competidores (últimos datos disponibles)
    prisma.competitorKeywordGap.findMany({
      where: { clientId },
      orderBy: { competitorPosition: "asc" },
      take: 30,
      select: {
        keyword: true,
        competitorPosition: true,
        competitor: { select: { domain: true } },
      },
    }),

    // Top queries GSC con altas impresiones pero CTR bajo (oportunidades)
    // Usamos PageMetric como proxy — si existe
    prisma.pageMetric.findMany({
      where: { site: { clientId } },
      orderBy: { impressions: "desc" },
      take: 20,
      select: { url: true, clicks: true, impressions: true, ctr: true, position: true, date: true },
    }),

    prisma.competitor.findMany({
      where: { clientId, deletedAt: null },
      select: { domain: true },
    }),
  ]);

  const lines: string[] = [];

  lines.push(`# Contexto de Contenido — ${client.name}`);
  lines.push(`Dominio: ${client.domain} | Plan: ${client.plan}`);
  lines.push("");

  // Ciclo actual
  if (cycle) {
    lines.push(`## Ciclo actual: ${cycle.yearMonth} (${cycle.status})`);
    if (cycle.focus) lines.push(`Foco del mes: ${cycle.focus}`);
    if (cycle.goals.length > 0) lines.push(`Objetivos: ${cycle.goals.join(" | ")}`);
    if (cycle.strategySummary) lines.push(`Estrategia: ${cycle.strategySummary}`);
    lines.push("");
  }

  // Keywords por categoría de posición
  const noPosition  = keywords.filter((k) => !k.rankings[0]?.position);
  const top3        = keywords.filter((k) => { const p = k.rankings[0]?.position; return p && p <= 3; });
  const pos4to10    = keywords.filter((k) => { const p = k.rankings[0]?.position; return p && p >= 4 && p <= 10; });
  const pos11to30   = keywords.filter((k) => { const p = k.rankings[0]?.position; return p && p >= 11 && p <= 30; });
  const pos31plus   = keywords.filter((k) => { const p = k.rankings[0]?.position; return p && p > 30; });

  lines.push(`## Keywords (${keywords.length} total)`);
  lines.push(`Top 3: ${top3.length} | Pos 4-10: ${pos4to10.length} | Pos 11-30: ${pos11to30.length} | Pos 31+: ${pos31plus.length} | Sin posición: ${noPosition.length}`);
  lines.push("");

  if (pos4to10.length > 0) {
    lines.push(`### Posición 4-10 (refuerzo rápido = subir a top 3):`);
    for (const kw of pos4to10.slice(0, 10)) {
      const pos = kw.rankings[0]?.position;
      const url = kw.rankings[0]?.rankingUrl ?? kw.targetUrl ?? "sin URL";
      lines.push(`  - "${kw.term}" → #${pos} | URL: ${url}`);
    }
    lines.push("");
  }

  if (pos11to30.length > 0) {
    lines.push(`### Posición 11-30 (contenido a mejorar o crear):`);
    for (const kw of pos11to30.slice(0, 10)) {
      const pos = kw.rankings[0]?.position;
      const url = kw.rankings[0]?.rankingUrl ?? kw.targetUrl ?? "sin URL dedicada";
      lines.push(`  - "${kw.term}" → #${pos} | URL: ${url}`);
    }
    lines.push("");
  }

  if (noPosition.length > 0) {
    lines.push(`### Sin posición (keywords sin contenido indexado):`);
    lines.push(noPosition.slice(0, 15).map((k) => `"${k.term}"`).join(", "));
    lines.push("");
  }

  // Keyword gaps de competidores
  if (keywordGaps.length > 0) {
    lines.push(`## Gaps vs Competidores (keywords donde ellos rankean, nosotros no)`);
    const grouped: Record<string, typeof keywordGaps> = {};
    for (const gap of keywordGaps) {
      const domain = gap.competitor.domain;
      if (!grouped[domain]) grouped[domain] = [];
      grouped[domain].push(gap);
    }
    for (const [domain, gaps] of Object.entries(grouped)) {
      lines.push(`${domain}:`);
      for (const gap of gaps.slice(0, 8)) {
        lines.push(`  - "${gap.keyword}" → competidor #${gap.competitorPosition} (sin posición propia)`);
      }
    }
    lines.push("");
  }

  // Top páginas GSC con bajo CTR (oportunidad de mejorar titles/meta)
  if (gscOpportunities.length > 0) {
    const lowCtr = gscOpportunities
      .filter((p) => (p.impressions ?? 0) > 100 && (p.ctr ?? 1) < 0.03 && p.position && p.position <= 20)
      .slice(0, 8);
    if (lowCtr.length > 0) {
      lines.push(`## Páginas con altas impresiones y CTR bajo (mejorar title/meta):`);
      for (const page of lowCtr) {
        lines.push(`  - ${page.url}: ${page.impressions} imp, ${((page.ctr ?? 0) * 100).toFixed(1)}% CTR, pos #${page.position?.toFixed(1)}`);
      }
      lines.push("");
    }
  }

  // Competidores para referencia
  if (competitors.length > 0) {
    lines.push(`## Competidores configurados: ${competitors.map((c) => c.domain).join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Llamada a Claude ───────────────────────────────────────────────────────

export async function generateContentPlan(
  clientId: string,
  triggeredBy?: string
): Promise<{ plan: ContentPlanResult; planId: string }> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const context = await gatherContentContext(clientId);
  const month = new Date().toISOString().slice(0, 7); // "YYYY-MM"

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Genera el plan de contenido SEO para este cliente:\n\n${context}`,
      },
    ],
  });

  const rawText = response.content[0]?.type === "text" ? response.content[0].text : "{}";

  // Detectar respuesta truncada (Claude llegó al max_tokens)
  if (response.stop_reason === "max_tokens") {
    console.warn("[content-plan] Respuesta truncada por max_tokens. Tokens usados:", response.usage.output_tokens);
  }

  let plan: ContentPlanResult;
  try {
    const jsonStr = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    plan = JSON.parse(jsonStr) as ContentPlanResult;
  } catch {
    // Si el JSON está truncado, intentar reparar cerrando arrays/objetos
    try {
      let repaired = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      // Cerrar strings, arrays y objetos abiertos
      const openBraces = (repaired.match(/{/g) || []).length;
      const closeBraces = (repaired.match(/}/g) || []).length;
      const openBrackets = (repaired.match(/\[/g) || []).length;
      const closeBrackets = (repaired.match(/]/g) || []).length;
      // Cortar al último item completo y cerrar
      const lastCompleteObj = repaired.lastIndexOf("},");
      if (lastCompleteObj > 0 && openBraces > closeBraces) {
        repaired = repaired.slice(0, lastCompleteObj + 1);
        // Cerrar brackets y braces restantes
        for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += "]";
        for (let i = 0; i < openBraces - closeBraces - 1; i++) repaired += "}";
        repaired += "}";
      }
      plan = JSON.parse(repaired) as ContentPlanResult;
      console.warn("[content-plan] JSON reparado exitosamente tras truncamiento.");
    } catch {
      plan = {
        resumen: rawText.slice(0, 300),
        ideas: [],
        notaEstrategica: "Error: la respuesta fue truncada. Intenta regenerar.",
      };
    }
  }

  const usage = response.usage;
  const cachedTokens = (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
  const cost = calculateClaudeCost("sonnet-4-6", usage.input_tokens, usage.output_tokens, cachedTokens);

  const record = await prisma.contentPlan.create({
    data: {
      clientId,
      month,
      ideas: plan as unknown as Prisma.InputJsonValue,
      model: CLAUDE_MODEL,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cost: new Decimal(cost.toFixed(6)),
      triggeredBy: triggeredBy ?? null,
    },
  });

  await logApiUsage({
    provider: "anthropic",
    endpoint: "content-plan/sonnet",
    cost,
    clientId,
  });

  return { plan, planId: record.id };
}
