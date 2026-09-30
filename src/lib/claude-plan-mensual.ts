/**
 * Generador de Plan Mensual con Claude.
 *
 * Reutiliza el contexto del cliente (misma función que Análisis Claude)
 * pero con un prompt orientado a generar tareas accionables clasificadas
 * por tipo de ejecución (IA/Híbrido/HT), urgencia e impacto.
 */

import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "@/lib/anthropic-config";
import { prisma } from "@/lib/db";
import { calculateClaudeCost, logApiUsage } from "@/server/jobs/workers/base-worker";
import { Decimal } from "@prisma/client/runtime/library";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type PlanTaskKind =
  | "meta"
  | "contenido-blog"
  | "contenido-landing"
  | "contenido-optimizar"
  | "interlinking"
  | "schema"
  | "tecnico"
  | "setup"
  | "otro";

export type PlanTaskExecType = "ia" | "hibrido" | "ht";

export interface PlanTask {
  titulo: string;
  descripcion: string;
  kind: PlanTaskKind;
  execType: PlanTaskExecType;
  urgencia: "alta" | "media" | "baja";
  impacto: "alto" | "medio" | "bajo";
  evidencia: string;
  targetUrl?: string;
  keywords?: string[];
}

export interface PlanMensualResult {
  resumen: string;
  tareas: PlanTask[];
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres el SeoAdvisor de Click Society. Generas planes mensuales SEO accionables para sitios Next.js.

Cada tarea debe tener un tipo de ejecución:
- "ia": Constructor (IA) la puede ejecutar 100% automáticamente. Incluye: cambios de meta tags, schema JSON-LD, código técnico, interlinking, optimización de texto existente.
- "hibrido": Constructor crea el contenido y hace commit, pero el humano debe revisar en producción y agregar imagen de portada. Incluye: artículos de blog, landing pages nuevas.
- "ht": Requiere trabajo humano 100%. Incluye: configuración de herramientas, registro en plataformas, tareas que no involucran código del sitio.

Cada tarea tiene un "kind" que determina cómo se ejecuta:
- meta → Cambio de meta tags (title, description). execType: ia
- contenido-blog → Artículo de blog nuevo. execType: hibrido
- contenido-landing → Landing page nueva. execType: hibrido
- contenido-optimizar → Reescribir/mejorar texto existente. execType: ia
- interlinking → Agregar/mejorar enlaces internos. execType: ia
- schema → Agregar/modificar JSON-LD structured data. execType: ia
- tecnico → Cambio técnico (performance, sitemap, robots, etc). execType: ia
- setup → Configuración de herramientas/plataformas. execType: ht
- otro → Cualquier otra cosa manual. execType: ht

Reglas:
1. Ordena por urgencia (alta→baja) y luego por impacto (alto→bajo)
2. Máximo 12 tareas, mínimo 5
3. Cada tarea debe ser específica y accionable, NO genérica
4. La evidencia debe citar un dato concreto del contexto
5. NO generes tareas de "monitorear", "analizar" o "investigar" — solo acciones de implementación
6. Si una acción se puede dividir en una parte IA y una parte HT, divídela en 2 tareas separadas
7. Prioriza tareas IA sobre HT cuando sea posible — el valor del plan es la automatización`;

const USER_PROMPT_TEMPLATE = `Analiza el siguiente contexto SEO del cliente y genera un plan mensual de tareas accionables.

{CONTEXT}

Responde SOLO con JSON válido (sin markdown code fence):
{
  "resumen": "Resumen ejecutivo del plan en 2-3 oraciones",
  "tareas": [
    {
      "titulo": "Título corto y específico (max 70 chars)",
      "descripcion": "Qué hacer exactamente, con detalles técnicos si aplica",
      "kind": "meta|contenido-blog|contenido-landing|contenido-optimizar|interlinking|schema|tecnico|setup|otro",
      "execType": "ia|hibrido|ht",
      "urgencia": "alta|media|baja",
      "impacto": "alto|medio|bajo",
      "evidencia": "Dato específico que justifica esta tarea",
      "targetUrl": "/ruta-afectada (opcional)",
      "keywords": ["keyword1", "keyword2"]
    }
  ]
}`;

// ─── Recopilación de contexto (reutiliza la misma lógica de claude-analysis) ─

async function gatherContext(clientId: string): Promise<string> {
  const [client, cycle, keywords, audit, backlinkSnapshot, competitors] = await Promise.all([
    prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { name: true, domain: true, plan: true, services: true },
    }),
    prisma.monthlyCycle.findFirst({
      where: { clientId, status: { in: ["ACTIVE", "PLANNING"] } },
      orderBy: { yearMonth: "desc" },
      include: { tasks: { where: { status: { not: "DONE" } }, take: 10 } },
    }),
    prisma.keyword.findMany({
      where: { clientId, deletedAt: null },
      include: { rankings: { orderBy: { date: "desc" }, take: 1 } },
      take: 30,
    }),
    prisma.audit.findFirst({
      where: { clientId },
      orderBy: { date: "desc" },
    }),
    prisma.backlinkSnapshot.findFirst({
      where: { clientId },
      orderBy: { capturedAt: "desc" },
    }),
    prisma.competitor.findMany({
      where: { clientId, deletedAt: null },
      take: 5,
    }),
  ]);

  const sections: string[] = [
    `## Cliente: ${client.name} (${client.domain})`,
    `Plan: ${client.plan} | Servicios: ${client.services.join(", ")}`,
  ];

  if (cycle) {
    sections.push(`\n## Ciclo actual: ${cycle.yearMonth}`);
    if (cycle.focus) sections.push(`Foco: ${cycle.focus}`);
    if (cycle.goals.length > 0) sections.push(`Objetivos: ${cycle.goals.join("; ")}`);
    if (cycle.tasks.length > 0) {
      sections.push(`Tareas pendientes (${cycle.tasks.length}):`);
      cycle.tasks.forEach((t) => sections.push(`- [${t.status}] ${t.title}`));
    }
  }

  if (audit) {
    sections.push(`\n## Último audit (${audit.date.toISOString().slice(0, 10)})`);
    sections.push(`Score: general=${audit.scoreOverall} técnico=${audit.scoreTechnical} performance=${audit.scorePerformance} contenido=${audit.scoreContent}${audit.aeoScore != null ? ` AEO=${audit.aeoScore}` : ""}`);
    sections.push(`Páginas: ${audit.pagesCrawled} crawled, ${audit.pagesIndexable} indexable, ${audit.brokenPages} rotas, ${audit.redirectPages} redirects`);
  }

  if (keywords.length > 0) {
    sections.push(`\n## Keywords (${keywords.length})`);
    const priority = keywords.filter((k) => k.isPriority);
    if (priority.length > 0) {
      sections.push("Priority keywords:");
      priority.forEach((k) => {
        const pos = k.rankings[0]?.position;
        sections.push(`- "${k.term}" → pos ${pos ?? "sin ranking"}${k.targetUrl ? ` (${k.targetUrl})` : ""}`);
      });
    }
  }

  if (backlinkSnapshot) {
    sections.push(`\n## Backlinks`);
    sections.push(`Total: ${backlinkSnapshot.totalBacklinks} | Dominios: ${backlinkSnapshot.uniqueDomains} | Dofollow: ${backlinkSnapshot.dofollowCount} | Ganados esta semana: ${backlinkSnapshot.gainedThisWeek} | Perdidos: ${backlinkSnapshot.lostThisWeek}`);
  }

  if (competitors.length > 0) {
    sections.push(`\n## Competidores: ${competitors.map((c) => c.domain).join(", ")}`);
  }

  return sections.join("\n");
}

// ─── Generación ──────────────────────────────────────────────────────────────

export async function generatePlanMensual(
  clientId: string,
  triggeredBy?: string
): Promise<{ result: PlanMensualResult; analysisId: string }> {
  const anthropic = new Anthropic();
  const context = await gatherContext(clientId);

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: USER_PROMPT_TEMPLATE.replace("{CONTEXT}", context),
    }],
  });

  const rawText = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const jsonStr = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  let result: PlanMensualResult;
  try {
    result = JSON.parse(jsonStr) as PlanMensualResult;
    result.resumen ??= "";
    result.tareas ??= [];
  } catch {
    result = { resumen: "Error al parsear respuesta de Claude", tareas: [] };
  }

  // Validar execType consistency con kind
  const KIND_EXEC: Record<string, PlanTaskExecType> = {
    meta: "ia", schema: "ia", tecnico: "ia", interlinking: "ia",
    "contenido-optimizar": "ia", "contenido-blog": "hibrido",
    "contenido-landing": "hibrido", setup: "ht", otro: "ht",
  };

  result.tareas = result.tareas.map((t) => ({
    ...t,
    execType: KIND_EXEC[t.kind] ?? "ht", // Forzar consistencia
  }));

  // Calcular costo y guardar
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const cachedTokens = (response.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
  const cost = calculateClaudeCost("sonnet-4-6", inputTokens, outputTokens, cachedTokens);

  const record = await prisma.clientAnalysis.create({
    data: {
      clientId,
      content: JSON.stringify({ type: "plan-mensual", ...result }),
      model: CLAUDE_MODEL,
      inputTokens,
      outputTokens,
      cost: new Decimal(cost.toFixed(6)),
      triggeredBy: triggeredBy ?? null,
    },
  });

  await logApiUsage({
    provider: "anthropic",
    endpoint: "plan-mensual",
    cost,
    clientId,
  });

  return { result, analysisId: record.id };
}
