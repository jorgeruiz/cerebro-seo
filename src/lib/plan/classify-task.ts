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
  costUsd: number;
}

async function callClassifierLLM(input: ClassificationInput): Promise<LLMClassification> {
  const client = new Anthropic();

  // Build the actionType descriptions for the prompt
  const typeDescriptions = CATALOG
    .filter((e) => e.actionType !== "other")
    .map((e) => {
      const signals = e.signals.length > 0 ? `Señales: ${e.signals.join(", ")}` : "";
      const negSignals = e.negativeSignals.length > 0 ? `NO es esto si: ${e.negativeSignals.join(", ")}` : "";
      return `- **${e.actionType}** (${e.class}, ${e.category}): ${e.acceptance[0] ?? ""}. ${signals}. ${negSignals}`;
    })
    .join("\n");

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: `Eres un clasificador de tareas SEO. Clasifica el objetivo en exactamente UN actionType del catálogo.

REGLAS:
- Una tarea = un actionType = un target (URL o keyword). Si el objetivo es compuesto, devuelve splitInto.
- Si no estás seguro (< 75% confianza), devuelve "other" con los 2 candidatos más cercanos.
- Extrae targetUrl y targetKeyword del objetivo si están presentes.

CATÁLOGO:
${typeDescriptions}
- **other**: lo que no encaja claramente en ninguno de los anteriores.`,
    messages: [
      {
        role: "user",
        content: `Clasifica esta tarea:
TÍTULO: ${input.title}
OBJETIVO: ${input.objective}
PLATAFORMA: ${input.platform ?? "desconocida"}`,
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

  return {
    actionType: String(toolInput.actionType ?? "other"),
    confidence: Number(toolInput.confidence ?? 0),
    targetUrl: toolInput.targetUrl ? String(toolInput.targetUrl) : null,
    targetKeyword: toolInput.targetKeyword ? String(toolInput.targetKeyword) : null,
    splitInto: Array.isArray(toolInput.splitInto) ? toolInput.splitInto as Array<{ title: string; actionType: string }> : null,
    reasoning: String(toolInput.reasoning ?? ""),
    costUsd,
  };
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

  // 4. Check negative signals
  if (actionType !== "other") {
    const entry = getCatalogEntry(actionType);
    if (entry) {
      for (const neg of entry.negativeSignals) {
        if (text.includes(neg.toLowerCase())) {
          conflicts.push(`Señal negativa "${neg}" contradice ${actionType}`);
          confidence = Math.min(confidence, 0.5);
        }
      }
    }
  }

  // 5. Low confidence or conflicts → other + NEEDS_DEFINITION
  if (confidence < OTHER_CONFIDENCE_THRESHOLD || (conflicts.length >= 2 && actionType !== "other")) {
    // Add current as candidate
    if (actionType !== "other") {
      candidates.unshift({ actionType, reason: llm.reasoning });
    }
    actionType = "other";
  }

  // 6. Check platform compatibility
  const entry = getCatalogEntry(actionType);
  if (entry && input.platform) {
    const platformKey = input.platform === "NEXTJS" ? "NEXTJS" : input.platform === "WORDPRESS" ? "WORDPRESS" : null;
    if (platformKey && !entry.modes[platformKey]) {
      conflicts.push(`${actionType} no compatible con plataforma ${input.platform}`);
      actionType = "other";
    }
  }

  // 7. Resolve mode from catalog + capabilities
  let mode: "AI" | "HYBRID" | "MANUAL" = "MANUAL";
  let category = "technical";
  if (entry) {
    category = entry.category;
    const platformKey = (input.platform === "NEXTJS" || input.platform === "WORDPRESS") ? input.platform as "NEXTJS" | "WORDPRESS" : "WORDPRESS";
    const platformMode = entry.modes[platformKey];
    if (platformMode) {
      mode = platformMode.mode;
      // Check if capability condition applies
      if (platformMode.condition && input.wpCapabilities) {
        if (!hasCapability(platformMode.condition, input.wpCapabilities)) {
          mode = platformMode.fallbackMode ?? "HYBRID";
        }
      }
    }
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
