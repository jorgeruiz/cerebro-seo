/**
 * Task Classifier — single entry point for classifying tasks.
 *
 * Step 1 (LLM): Claude tool-use with closed ActionType enum.
 * Step 2 (deterministic): validate against catalog, disambiguation, signals.
 *
 * Returns the actionType, confidence, mode, inputs, and any issues.
 */

import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "@/lib/anthropic-config";
import {
  ACTION_TYPES,
  CATALOG,
  OTHER_CONFIDENCE_THRESHOLD,
  getCatalogEntry,
  isValidActionType,
  resolveAlias,
  type ActionType,
} from "./task-catalog";
import { DISAMBIGUATION_RULES } from "./disambiguation";
import { hasCapability } from "./capabilities";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ClassificationInput {
  title: string;
  objective: string;
  platform: "NEXTJS" | "WORDPRESS" | string | null;
  /** Plugin capabilities for WP sites */
  wpCapabilities?: string[] | null;
  /** Existing actionType (from analysis or module) — may be legacy */
  existingActionType?: string | null;
}

/** Closed list of reasons for "other" classification. */
export type OtherReason =
  | "system_task"          // task about Cerebro SEO / internal tooling
  | "compound_multi_target" // multiple URLs/targets that need splitting
  | "no_object"            // no clear action object (just "optimizar")
  | "out_of_catalog";      // genuine new type not in catalog

export interface ClassificationResult {
  actionType: ActionType;
  confidence: number;
  mode: "AI" | "HYBRID" | "MANUAL";
  category: string;
  targetUrl: string | null;
  targetKeyword: string | null;
  /** If the task should be split into multiple tasks */
  splitInto: Array<{ title: string; actionType: ActionType }> | null;
  /** Reasoning from the LLM */
  reasoning: string;
  /** When actionType is "other", the reason from a closed list */
  otherReason: OtherReason | null;
  /** Candidates considered (for NEEDS_DEFINITION UI) */
  candidates: Array<{ actionType: ActionType; reason: string }>;
  /** Missing inputs (for NEEDS_INPUT) */
  missingInputs: string[];
  /** Status to set on the task */
  status: "READY" | "NEEDS_DEFINITION" | "NEEDS_INPUT" | "PLANNING";
  /** Any conflicts detected */
  conflicts: string[];
  /** Cost of the LLM call */
  costUsd: number;
}

// ─── Classifier ─────────────────────────────────────────────────────────────

export async function classifyTask(input: ClassificationInput): Promise<ClassificationResult> {
  // ── Step 0: resolve existing actionType if it's a legacy alias ─────────
  let existingResolved: ActionType | null = null;
  if (input.existingActionType) {
    existingResolved = resolveAlias(input.existingActionType);
  }

  // ── Step 1: LLM classification via tool-use ───────────────────────────
  const llmResult = await callClassifierLLM(input);

  // ── Step 2: Deterministic validation ──────────────────────────────────
  return validateClassification(llmResult, input, existingResolved);
}

// ─── LLM Step ───────────────────────────────────────────────────────────────

interface LLMClassification {
  actionType: string;
  confidence: number;
  targetUrl: string | null;
  targetKeyword: string | null;
  splitInto: Array<{ title: string; actionType: string }> | null;
  reasoning: string;
  otherReason: string | null;
  costUsd: number;
}

async function callClassifierLLM(input: ClassificationInput): Promise<LLMClassification> {
  const client = new Anthropic();

  // Build the actionType descriptions for the prompt, including absorbs
  const typeDescriptions = CATALOG
    .filter((e) => e.actionType !== "other")
    .map((e) => {
      const signals = e.signals.length > 0 ? `Señales: ${e.signals.join(", ")}` : "";
      const negSignals = e.negativeSignals.length > 0 ? `NO es esto si: ${e.negativeSignals.join(", ")}` : "";
      const absorbs = e.absorbs && e.absorbs.length > 0
        ? `Absorbe (misma URL): ${e.absorbs.join(", ")}`
        : "";
      return `- **${e.actionType}** (${e.class}, ${e.category}): ${e.acceptance[0] ?? ""}. ${signals}. ${negSignals}. ${absorbs}`;
    })
    .join("\n");

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    temperature: 0,
    system: `Eres un clasificador de tareas SEO. Clasifica la tarea en exactamente UN actionType del catálogo.

REGLA PRINCIPAL — EL TÍTULO DEFINE LA ACCIÓN:
- El TÍTULO dice qué hacer (la acción). El OBJETIVO es contexto, evidencia y datos históricos.
- No te confundas: un objetivo largo con métricas GSC, CTR, posiciones, etc. es EVIDENCIA del porqué, no una acción diferente.

REGLA DE ABSORCIÓN (§1.5 1b):
- Una tarea que crea o modifica UNA URL absorbe los elementos on-page de esa URL.
- Si el título dice "Crear artículo de blog" y el objetivo menciona "meta title, FAQ, schema, enlaces internos", eso es create_blog (absorbe todo eso para la misma URL).
- Si el título dice "Crear landing" y el objetivo menciona "H1, metas, schema, FAQ", eso es create_landing.
- Solo es compuesto (split) si el objetivo nombra OTRA URL existente que también hay que modificar.
- Cada tipo lista qué absorbe en su descripción.

DESEMPATE FAQ vs SCHEMA:
- Si se crea contenido FAQ visible (preguntas + respuestas nuevas) → add_faq (incluye FAQPage schema).
- Si solo se agrega schema JSON-LD a contenido que ya existe → schema.

DESEMPATE INFORMACIONAL vs TRANSACCIONAL:
- "Crear contenido", "guía", "artículo pilar", "página pilar", "qué es…", "cómo…" con intención informativa (tipos, normas, tutorial) → create_blog.
- Los mismos con intención transaccional (venta, cotización, precio, servicio, ciudad) → create_landing.

TAREAS DEL SISTEMA → other (system_task):
- Verificar el plugin Cerebro, correr audit, depurar el rank tracker, configurar GSC, configurar herramientas internas (Semrush, Ahrefs), probar endpoints → siempre "other" con otherReason="system_task".

PLATAFORMA NO AFECTA LA CLASIFICACIÓN:
- Clasifica igual sin importar la plataforma (WP, Next.js, OTRO). La plataforma solo afecta el modo y los gates, no el actionType.

LISTA FALTANTE ≠ other:
- Si el objetivo no lista URLs o keywords concretas, eso NO cambia el actionType. Solo afecta el estado (NEEDS_INPUT). Clasifica por la acción, no por si hay lista.
- Extrae todas las URLs que veas en el título u objetivo como targetUrl (la primera) y menciónalo en el reasoning.

COMPOUND vs LOTE HOMOGÉNEO (CRÍTICO — LEE BIEN):
- compound_multi_target SOLO cuando el objetivo requiere 2+ actionTypes DISTINTOS sobre URLs DISTINTAS (ej: "crear blog Y enlazarlo desde servicios" = create_blog + internal_links).
- NO es compound si:
  · Varias URLs con el MISMO actionType ("metas de 19 URLs" = update_meta en lote)
  · Una URL con múltiples acciones on-page absorbidas ("H1 + metas + FAQ en /servicios" = edit_page_text o add_faq)
  · 2 tipos de schema en la misma URL o las mismas URLs ("LocalBusiness + Service" = schema)
  · "las landings", "los artículos", "las páginas de servicio" sin URLs explícitas = lote homogéneo
- En caso de duda entre compound y lote homogéneo: elige el actionType del TÍTULO y clasifica como lote. Nunca other por esto.

otherReason OBLIGATORIO cuando actionType = "other":
- system_task: tarea sobre el propio Cerebro SEO / herramientas internas
- compound_multi_target: 2+ targets con actionTypes DISTINTOS nombrados explícitamente
- no_object: no hay objeto claro de la acción ("optimizar" sin decir qué)
- out_of_catalog: acción genuinamente nueva que no encaja en ningún tipo

REGLAS GENERALES:
- Una tarea = un actionType = un target. Si es compuesto con URLs distintas, devuelve splitInto.
- Si no estás seguro (< 75% confianza), devuelve "other" con otherReason.

CATÁLOGO:
${typeDescriptions}
- **other**: tareas del sistema, compuestas no resueltas, sin objeto, o fuera del catálogo.`,
    messages: [
      {
        role: "user",
        content: `Clasifica esta tarea. El TÍTULO define la acción; el OBJETIVO es contexto/evidencia.

TÍTULO: ${input.title}
OBJETIVO: ${input.objective}`,
      },
    ],
    tools: [
      {
        name: "classify",
        description: "Clasifica la tarea en un actionType del catálogo",
        input_schema: {
          type: "object" as const,
          properties: {
            actionType: {
              type: "string",
              enum: [...ACTION_TYPES],
              description: "El actionType que mejor describe esta tarea",
            },
            confidence: {
              type: "number",
              description: "Confianza de 0 a 1",
            },
            targetUrl: {
              type: "string",
              description: "URL objetivo extraída del título/objetivo, o null",
            },
            targetKeyword: {
              type: "string",
              description: "Keyword objetivo extraída, o null",
            },
            splitInto: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  actionType: { type: "string", enum: [...ACTION_TYPES] },
                },
                required: ["title", "actionType"],
              },
              description: "Si el objetivo es compuesto, las sub-tareas. null si no aplica.",
            },
            reasoning: {
              type: "string",
              description: "Razón breve de la clasificación",
            },
            otherReason: {
              type: "string",
              enum: ["system_task", "compound_multi_target", "no_object", "out_of_catalog"],
              description: "OBLIGATORIO si actionType='other'. Razón de la lista cerrada.",
            },
          },
          required: ["actionType", "confidence", "reasoning"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "classify" },
  });

  // Extract tool use result
  const toolUse = response.content.find((b) => b.type === "tool_use");
  const toolInput = (toolUse && "input" in toolUse ? toolUse.input : {}) as Record<string, unknown>;

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const costUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000;

  // Extract URLs from objective if LLM didn't find one
  let targetUrl = toolInput.targetUrl ? String(toolInput.targetUrl) : null;
  if (!targetUrl) {
    targetUrl = extractFirstUrl(`${input.title} ${input.objective}`);
  }

  const otherReasonRaw = toolInput.otherReason ? String(toolInput.otherReason) : null;
  const VALID_OTHER_REASONS = ["system_task", "compound_multi_target", "no_object", "out_of_catalog"];
  const otherReason = otherReasonRaw && VALID_OTHER_REASONS.includes(otherReasonRaw) ? otherReasonRaw : null;

  return {
    actionType: String(toolInput.actionType ?? "other"),
    confidence: Number(toolInput.confidence ?? 0),
    targetUrl,
    targetKeyword: toolInput.targetKeyword ? String(toolInput.targetKeyword) : null,
    splitInto: Array.isArray(toolInput.splitInto) ? toolInput.splitInto as Array<{ title: string; actionType: string }> : null,
    reasoning: String(toolInput.reasoning ?? ""),
    otherReason,
    costUsd,
  };
}

/** Extract the first URL (absolute or path) from text. */
function extractFirstUrl(text: string): string | null {
  // Match /path/to/page or https://...
  const match = text.match(/(?:https?:\/\/[^\s,)]+|\/[a-z0-9][a-z0-9\-_/]*)/i);
  return match ? match[0] : null;
}

// ─── Deterministic Validation ───────────────────────────────────────────────

function validateClassification(
  llm: LLMClassification,
  input: ClassificationInput,
  existingResolved: ActionType | null,
): ClassificationResult {
  const conflicts: string[] = [];
  const candidates: Array<{ actionType: ActionType; reason: string }> = [];
  let actionType: ActionType = isValidActionType(llm.actionType) ? llm.actionType : "other";
  let confidence = llm.confidence;

  // 1. Resolve alias if LLM returned a legacy value
  const resolved = resolveAlias(llm.actionType);
  if (resolved && resolved !== llm.actionType) {
    actionType = resolved;
  }

  // 2. Check existing actionType (from analysis) — if it disagrees, note conflict
  if (existingResolved && existingResolved !== actionType && existingResolved !== "other") {
    conflicts.push(`Análisis dijo "${existingResolved}" pero clasificador dice "${actionType}"`);
    // Trust the classifier over legacy analysis
    candidates.push({ actionType: existingResolved, reason: "Del análisis previo" });
  }

  // 3. Check disambiguation rules
  const text = `${input.title} ${input.objective}`.toLowerCase();
  for (const rule of DISAMBIGUATION_RULES) {
    if (text.includes(rule.trigger.toLowerCase())) {
      if (rule.result !== actionType) {
        // Check if the context matches
        if (rule.context !== "—" && !text.includes(rule.context.toLowerCase().split(",")[0])) {
          continue; // context doesn't match this rule
        }
        conflicts.push(`Regla de desambiguación: "${rule.trigger}" + "${rule.context}" → ${rule.result}`);
        candidates.push({ actionType: rule.result, reason: `Regla: ${rule.trigger} + ${rule.context}` });
      }
    }
  }

  // 4. Check negative signals (skip if the signal refers to an absorbed type on same URL)
  if (actionType !== "other") {
    const entry = getCatalogEntry(actionType);
    if (entry) {
      const absorbedTypes = entry.absorbs ?? [];
      for (const neg of entry.negativeSignals) {
        if (text.includes(neg.toLowerCase())) {
          // If this neg signal corresponds to an absorbed type AND there's a single target URL,
          // it's not a conflict — it's absorption.
          const negLower = neg.toLowerCase();
          const isAbsorbed = absorbedTypes.some((absType) => {
            const absEntry = getCatalogEntry(absType);
            return absEntry?.signals.some((s) => {
              const sigLower = s.toLowerCase().split(",")[0];
              return negLower.includes(sigLower) || sigLower.includes(negLower);
            });
          });
          if (isAbsorbed && llm.targetUrl) {
            // Absorbed on same URL — not a conflict
            continue;
          }
          conflicts.push(`Señal negativa "${neg}" contradice ${actionType}`);
          confidence = Math.min(confidence, 0.5);
        }
      }
    }
  }

  // 5. Low confidence or conflicts → other + NEEDS_DEFINITION
  let otherReason: OtherReason | null = llm.otherReason as OtherReason | null;
  if (confidence < OTHER_CONFIDENCE_THRESHOLD || (conflicts.length >= 2 && actionType !== "other")) {
    if (actionType !== "other") {
      candidates.unshift({ actionType, reason: llm.reasoning });
    }
    actionType = "other";
    if (!otherReason) otherReason = "no_object";
  }

  // 6. Platform does NOT affect actionType — only mode and gates.
  //    Unknown platform → mode defaults to MANUAL, gates handle BLOCKED.
  const entry = getCatalogEntry(actionType);

  // 7. Resolve mode from catalog + capabilities (platform affects THIS, not actionType)
  let mode: "AI" | "HYBRID" | "MANUAL" = "MANUAL";
  let category = "technical";
  if (entry) {
    category = entry.category;
    const platformKey = (input.platform === "NEXTJS" || input.platform === "WORDPRESS") ? input.platform as "NEXTJS" | "WORDPRESS" : "WORDPRESS";
    const platformMode = entry.modes[platformKey];
    if (platformMode) {
      mode = platformMode.mode;
      if (platformMode.condition && input.wpCapabilities) {
        if (!hasCapability(platformMode.condition, input.wpCapabilities)) {
          mode = platformMode.fallbackMode ?? "HYBRID";
        }
      }
    }
  }

  // 7b. Telemetry: out_of_catalog with high confidence → candidate for new type
  if (actionType === "other" && otherReason === "out_of_catalog" && confidence >= 0.9) {
    console.log(`[classify-task] TELEMETRY: out_of_catalog candidate conf=${confidence.toFixed(2)} "${input.title.slice(0, 80)}"`);
  }

  // 8. Check required inputs
  const missingInputs: string[] = [];
  if (entry && actionType !== "other") {
    try {
      // Try parsing with empty object to find what's missing
      const parseResult = entry.inputs.safeParse({});
      if (!parseResult.success) {
        for (const issue of parseResult.error.issues) {
          if (issue.code === "invalid_type") {
            missingInputs.push(issue.path.join("."));
          }
        }
      }
      // Check if we have targetUrl/targetKeyword for inputs that need them
      if (missingInputs.includes("targetUrl") && llm.targetUrl) {
        missingInputs.splice(missingInputs.indexOf("targetUrl"), 1);
      }
      if (missingInputs.includes("keyword") && llm.targetKeyword) {
        missingInputs.splice(missingInputs.indexOf("keyword"), 1);
      }
    } catch {
      // Zod parse error — skip input validation
    }
  }

  // 9. Determine status
  let status: "READY" | "NEEDS_DEFINITION" | "NEEDS_INPUT" | "PLANNING" = "PLANNING";
  if (actionType === "other") {
    status = "NEEDS_DEFINITION";
  } else if (missingInputs.length > 0) {
    status = "NEEDS_INPUT";
  }

  // 10. Handle split
  const splitInto = llm.splitInto?.map((s) => ({
    title: s.title,
    actionType: (isValidActionType(s.actionType) ? s.actionType : "other") as ActionType,
  })) ?? null;

  if (splitInto && splitInto.length > 1) {
    status = "NEEDS_DEFINITION"; // human confirms the split
  }

  return {
    actionType,
    confidence,
    mode,
    category,
    targetUrl: llm.targetUrl,
    targetKeyword: llm.targetKeyword,
    splitInto,
    reasoning: llm.reasoning,
    otherReason: actionType === "other" ? otherReason : null,
    candidates,
    missingInputs,
    status,
    conflicts,
    costUsd: llm.costUsd,
  };
}

/**
 * Quick classification without LLM — uses only signals and disambiguation.
 * For cases where we want to classify without the cost of an LLM call.
 */
export function classifyTaskQuick(input: {
  title: string;
  objective: string;
  existingActionType?: string | null;
}): { actionType: ActionType; confidence: number } {
  // Resolve alias
  if (input.existingActionType) {
    const resolved = resolveAlias(input.existingActionType);
    if (resolved) return { actionType: resolved, confidence: 0.9 };
  }

  // Check signals
  const text = `${input.title} ${input.objective}`.toLowerCase();
  for (const entry of CATALOG) {
    if (entry.actionType === "other") continue;
    const matchCount = entry.signals.filter((s) => text.includes(s.toLowerCase())).length;
    const negCount = entry.negativeSignals.filter((s) => text.includes(s.toLowerCase())).length;
    if (matchCount > 0 && negCount === 0) {
      return { actionType: entry.actionType, confidence: Math.min(0.6 + matchCount * 0.1, 0.85) };
    }
  }

  return { actionType: "other", confidence: 0.3 };
}
