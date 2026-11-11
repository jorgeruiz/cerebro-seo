/**
 * Task Coherence Validator — validates and auto-corrects task metadata
 * before the decomposer generates steps.
 *
 * Catches misclassifications from Claude's analysis and module inputs.
 * Auto-corrects when confident, flags for human review when ambiguous.
 */

import type { ActionType } from "./task-templates";

// ─── Patterns ───────────────────────────────────────────────────────────────

// NOTE: ORDER MATTERS — more specific patterns first.
// "meta title del artículo /url/" must match META, not BLOG.
const META_SIGNALS = /\b(meta\s*(title|description|tag)|yoast|optimizar\s+meta|mejorar\s+meta|focus\s+keyword)\b/i;
const BLOG_SIGNALS = /\b(blog|redactar|escribir\s+artículo|crear\s+artículo|nuevo\s+artículo|publicar\s+artículo)\b/i;
const LANDING_SIGNALS = /\b(landing|página\s+de\s+servicio|crear\s+página|nueva\s+página|página\s+web)\b/i;
const KEYWORD_SIGNALS = /\b(investigar\s+keywords?|seleccionar\s+keywords?|investigación\s+de\s+palabras|palabras\s+clave\s+prioritarias)\b/i;
const SCHEMA_SIGNALS = /\b(schema|json-?ld|structured\s+data|datos\s+estructurados)\b/i;
const INTERNAL_LINKS_SIGNALS = /\b(enlaces?\s+internos?|internal\s+links?|interlinking)\b/i;
// Tasks that should always be HUMAN (no AI handler exists)
const INDEXATION_SIGNALS = /\b(indexaci[oó]n|indexar|indexados?|search\s+console.*verific|verificar.*indexa)\b/i;
const REDIRECT_SIGNALS = /\b(redirecci[oó]n|redirect|301|302|404.*redirig)\b/i;

const ACTION_TYPE_SIGNALS: Array<{ actionType: ActionType; pattern: RegExp; label: string }> = [
  // META before BLOG — "meta title del artículo" is meta, not blog
  { actionType: "update_meta", pattern: META_SIGNALS, label: "meta tags" },
  { actionType: "create_blog", pattern: BLOG_SIGNALS, label: "blog" },
  { actionType: "create_landing", pattern: LANDING_SIGNALS, label: "landing/página" },
  { actionType: "keyword_research", pattern: KEYWORD_SIGNALS, label: "keyword research" },
  { actionType: "schema", pattern: SCHEMA_SIGNALS, label: "schema" },
  { actionType: "internal_links", pattern: INTERNAL_LINKS_SIGNALS, label: "enlaces internos" },
];

const ACTION_TO_CATEGORY: Record<string, string> = {
  create_blog: "blog",
  create_landing: "landing",
  update_meta: "meta",
  keyword_research: "keyword",
  schema: "schema",
  internal_links: "enlazado",
  edit_page_text: "optimizacion",
  upload_media: "media",
  generate_image: "imagen",
};

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CoherenceIssue {
  field: string;
  problem: string;
  autoFixed: boolean;
  oldValue: string | null;
  newValue: string | null;
}

export interface CoherenceResult {
  actionType: string | null;
  category: string;
  targetKeyword: string | null;
  issues: CoherenceIssue[];
  blocked: boolean;
  blockReason: string | null;
}

// ─── Validator ──────────────────────────────────────────────────────────────

/**
 * Validates and auto-corrects task metadata before decomposition.
 *
 * Returns corrected values + list of issues found.
 * If blocked=true, the task should go WAITING_HUMAN.
 */
export function validateTaskCoherence(task: {
  title: string;
  objective: string;
  actionType: string | null;
  category: string;
  targetKeyword: string | null;
  kind: string;
}): CoherenceResult {
  const issues: CoherenceIssue[] = [];
  let actionType = task.actionType;
  let category = task.category;
  let targetKeyword = task.targetKeyword;
  const blocked = false;
  const blockReason: string | null = null;

  const text = `${task.title} ${task.objective}`.toLowerCase();

  // ── 0. Detect HUMAN-only tasks (no AI handler) ────────────────────────────
  if (INDEXATION_SIGNALS.test(text)) {
    // Indexation tasks are always HUMAN external_tool (GSC manual)
    if (!actionType) {
      actionType = "other";
      issues.push({
        field: "actionType",
        problem: "Tarea de indexación → HUMAN (requiere Google Search Console manual)",
        autoFixed: true,
        oldValue: null,
        newValue: "other",
      });
    }
  }
  if (REDIRECT_SIGNALS.test(text) && !META_SIGNALS.test(text)) {
    if (!actionType) {
      actionType = "other";
      issues.push({
        field: "actionType",
        problem: "Tarea de redirección → HUMAN (requiere WP Admin / plugin Redirection)",
        autoFixed: true,
        oldValue: null,
        newValue: "other",
      });
    }
  }

  // ── 1. Detect actionType from title signals ──────────────────────────────
  const detectedFromTitle = detectActionTypeFromText(text);

  // ── 2. Validate actionType vs title ──────────────────────────────────────
  if (actionType && detectedFromTitle && actionType !== detectedFromTitle.actionType) {
    // Title contradicts actionType — check which is more specific
    // Title signals are stronger than inherited actionType (Claude may have guessed wrong)
    if (isStrongSignal(text, detectedFromTitle.actionType)) {
      issues.push({
        field: "actionType",
        problem: `Título indica "${detectedFromTitle.label}" pero actionType es "${actionType}"`,
        autoFixed: true,
        oldValue: actionType,
        newValue: detectedFromTitle.actionType,
      });
      actionType = detectedFromTitle.actionType;
    }
  }

  // ── 3. Fill actionType if missing ────────────────────────────────────────
  if (!actionType && detectedFromTitle) {
    issues.push({
      field: "actionType",
      problem: `actionType vacío — detectado "${detectedFromTitle.label}" del título`,
      autoFixed: true,
      oldValue: null,
      newValue: detectedFromTitle.actionType,
    });
    actionType = detectedFromTitle.actionType;
  }

  // ── 4. Validate category matches actionType ──────────────────────────────
  if (actionType) {
    const expectedCategory = ACTION_TO_CATEGORY[actionType];
    if (expectedCategory && category !== expectedCategory) {
      issues.push({
        field: "category",
        problem: `category "${category}" no coincide con actionType "${actionType}" — corregido a "${expectedCategory}"`,
        autoFixed: true,
        oldValue: category,
        newValue: expectedCategory,
      });
      category = expectedCategory;
    }
  }

  // ── 5. Validate targetKeyword ────────────────────────────────────────────
  if (targetKeyword && targetKeyword.length > 50) {
    issues.push({
      field: "targetKeyword",
      problem: `Keyword muy larga (${targetKeyword.length} chars) — meta_title usará solo palabras significativas`,
      autoFixed: false,
      oldValue: targetKeyword,
      newValue: null,
    });
    // Don't block — the executor handles long keywords gracefully now
  }

  // ── 6. Content tasks need keyword ────────────────────────────────────────
  if (actionType && ["create_blog", "create_landing", "edit_page_text"].includes(actionType)) {
    if (!targetKeyword || targetKeyword.trim().length < 3) {
      // Try to extract from title
      const quotedMatch = task.title.match(/['''"""\u201C\u201D«»]([^'''"""\u201C\u201D«»]+)['''"""\u201C\u201D«»]/);
      if (quotedMatch) {
        targetKeyword = quotedMatch[1];
        issues.push({
          field: "targetKeyword",
          problem: `targetKeyword vacío — extraído del título: "${targetKeyword}"`,
          autoFixed: true,
          oldValue: null,
          newValue: targetKeyword,
        });
      } else {
        issues.push({
          field: "targetKeyword",
          problem: "Tarea de contenido sin keyword objetivo. El paso puede pedir keyword al ejecutar.",
          autoFixed: false,
          oldValue: null,
          newValue: null,
        });
        // Don't block — the executor will handle missing keyword with WAITING_HUMAN
      }
    }
  }

  return { actionType, category, targetKeyword, issues, blocked, blockReason };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function detectActionTypeFromText(text: string): { actionType: ActionType; label: string } | null {
  // Check in priority order: blog/landing first (most specific), keyword last
  for (const signal of ACTION_TYPE_SIGNALS) {
    if (signal.pattern.test(text)) {
      return { actionType: signal.actionType, label: signal.label };
    }
  }
  return null;
}

/**
 * A signal is "strong" if the text explicitly mentions the action.
 * "Crear landing" is strong for create_landing.
 * "keyword local de mayor volumen" is NOT strong for keyword_research
 * (it's just mentioning a keyword, not asking to research keywords).
 */
function isStrongSignal(text: string, actionType: ActionType): boolean {
  if (actionType === "create_blog") return BLOG_SIGNALS.test(text);
  if (actionType === "create_landing") return LANDING_SIGNALS.test(text);
  if (actionType === "update_meta") return META_SIGNALS.test(text);
  if (actionType === "schema") return SCHEMA_SIGNALS.test(text);
  if (actionType === "internal_links") return INTERNAL_LINKS_SIGNALS.test(text);
  // keyword_research requires EXPLICIT research intent, not just the word "keyword"
  if (actionType === "keyword_research") return KEYWORD_SIGNALS.test(text);
  return false;
}
