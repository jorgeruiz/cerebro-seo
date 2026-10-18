/**
 * Tipos y validación Zod para las candidatas del Análisis unificado.
 *
 * Cada candidata es una tarea que puede enviarse al Plan mensual.
 * El Análisis genera 4-8 CONTENT + 4-8 CODE, ordenadas por prioridad.
 */

import { z } from "zod";
import { randomUUID } from "crypto";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type CandidateKind = "CONTENT" | "CODE" | "SETUP";
export type CandidateMode = "AI" | "HYBRID" | "HUMAN";
export type CandidateEffort = "LOW" | "MEDIUM" | "HIGH";
export type CandidateSource =
  | "signal"
  | "contentplan"
  | "analisis"
  | "setup"
  | "pendiente-anterior"  // VOIDED/FAILED del MonthlyPlan anterior
  | "ciclo-anterior";     // tareas del MonthlyCycle anterior

/**
 * action_type — clasificación semántica de la acción para cruzar con /capabilities.
 *
 * Cada action_type mapea a un conjunto de endpoint IDs del plugin WP.
 * Si TODOS los endpoints requeridos aparecen en /capabilities → AI.
 * Si al menos uno falta → HUMAN (con razón explícita).
 *
 * Al actualizar el plugin (ej: v1.6.0 agrega elementor), las tareas con action_type
 * edit_page_widgets pasan automáticamente a AI sin cambiar código aquí.
 */
export type WpActionType =
  | "create_blog"
  | "update_meta"
  | "upload_media"
  | "update_post"
  | "edit_page_widgets"
  | "create_landing_from_template"
  | "generate_image"
  | "other";

export interface AnalysisCandidate {
  id: string; // UUID estable para selección
  titulo: string;
  descripcion: string;
  kind: CandidateKind;
  mode: CandidateMode;
  modeReason: string;
  priority: number; // 1-5, 1 = más urgente
  effort: CandidateEffort;
  impactoEsperado: string;
  justificacion: string; // qué dato la respalda
  keywordObjetivo?: string | null;
  urlObjetivo?: string | null;
  fuente: CandidateSource;
  /** Tipo de acción para cruzar con /capabilities del plugin WP. Generado por Claude. */
  actionType?: WpActionType | null;
}

// ─── Zod schema ──────────────────────────────────────────────────────────────

const candidateSchema = z.object({
  titulo: z.string().min(5).max(120),
  descripcion: z.string().min(10).max(500),
  kind: z.enum(["CONTENT", "CODE", "SETUP"]),
  mode: z.enum(["AI", "HYBRID", "HUMAN"]),
  modeReason: z.string().min(5).max(200),
  priority: z.number().int().min(1).max(5),
  effort: z.enum(["LOW", "MEDIUM", "HIGH"]),
  impactoEsperado: z.string().min(5).max(200),
  justificacion: z.string().min(5).max(300),
  keywordObjetivo: z.string().nullable().optional(),
  urlObjetivo: z.string().nullable().optional(),
  fuente: z.enum(["signal", "contentplan", "analisis", "setup", "pendiente-anterior", "ciclo-anterior"]),
  actionType: z.enum([
    "create_blog", "update_meta", "upload_media", "update_post",
    "edit_page_widgets", "create_landing_from_template", "generate_image", "other",
  ]).nullable().optional(),
});

export const analysisResultSchema = z.object({
  resumenEjecutivo: z.string().min(10),
  oportunidades: z.array(z.object({
    titulo: z.string(),
    descripcion: z.string(),
    accion: z.string(),
    impacto: z.enum(["alto", "medio", "bajo"]),
  })),
  riesgos: z.array(z.object({
    titulo: z.string(),
    descripcion: z.string(),
    urgencia: z.enum(["alta", "media", "baja"]),
  })),
  recomendaciones: z.array(z.string()),
  conclusionEstrategica: z.string(),
  candidatas: z.array(candidateSchema),
});

// ─── Clasificación de modo por plataforma ────────────────────────────────────

/**
 * Next.js: acciones que el agente puede hacer pero requieren revisión humana (HYBRID).
 * Performance, bundle size, refactors estructurales → el agente toca código
 * pero el resultado necesita validación visual antes de mergear.
 */
const NEXTJS_HYBRID_PATTERNS = [
  /performance/i, /speed\s*index/i, /tbt/i, /fcp/i, /lcp/i, /cls/i,
  /core\s*web\s*vitals/i, /lighthouse/i, /bundle/i, /lazy.?load/i,
  /code.?split/i, /refactor/i, /js\s*(sin\s*usar|unused)/i,
  /css\s*(sin\s*usar|unused)/i, /webpack|turbopack/i,
];

// ─── Capability-based mode resolution for WordPress ─────────────────────────

/**
 * Mapeo: action_type → endpoint IDs requeridos en GET /capabilities.
 *
 * Si TODOS los endpoints de un action_type aparecen en /capabilities → AI.
 * Si al menos uno falta → HUMAN.
 *
 * Al actualizar el plugin (ej: v1.6.0 agrega elementor endpoints),
 * edit_page_widgets y create_landing_from_template pasan automáticamente
 * a AI sin cambiar código — solo necesitan aparecer en /capabilities.
 */
const ACTION_TYPE_CAPABILITIES: Record<WpActionType, string[]> = {
  create_blog:                    ["publish"],
  update_meta:                    ["seo"],
  upload_media:                   ["media"],
  update_post:                    ["update"],
  edit_page_widgets:              ["elementor", "elementor/duplicate", "elementor/widgets"],
  create_landing_from_template:   ["elementor", "elementor/from-template"],
  generate_image:                 ["media"],
  other:                          [], // never matches → always HUMAN
};

/**
 * Regex fallback — SOLO cuando /capabilities no está disponible.
 * Inferior a la detección por action_type; usada como safety net.
 */
const WP_REGEX_FALLBACK: Array<{ pattern: RegExp; actionType: WpActionType }> = [
  { pattern: /\b(?:blog|artículo|articulo|post|redactar|escribir)\b/i, actionType: "create_blog" },
  { pattern: /meta\s*(?:title|description|tag)|yoast|focus.?keyword/i, actionType: "update_meta" },
  { pattern: /\balt\b.*imagen|imagen.*\balt\b|texto\s*alternativo/i, actionType: "upload_media" },
  { pattern: /editar.*(?:página|sección|hero).*elementor|elementor.*(?:editar|actualizar)/i, actionType: "edit_page_widgets" },
  { pattern: /crear.*(?:landing|página\s*de\s*(?:servicio|producto|venta))/i, actionType: "create_landing_from_template" },
];

/**
 * Determina si un action_type es ejecutable dado un set de capabilities.
 */
function isActionExecutable(actionType: WpActionType, capabilities: string[]): boolean {
  const required = ACTION_TYPE_CAPABILITIES[actionType];
  if (required.length === 0) return false;
  return required.every((cap) => capabilities.some((c) => c === cap || c.startsWith(`${cap}/`)));
}

/**
 * Intenta inferir action_type desde título/descripción (regex fallback).
 */
function inferActionTypeFromText(text: string): WpActionType {
  for (const { pattern, actionType } of WP_REGEX_FALLBACK) {
    if (pattern.test(text)) return actionType;
  }
  return "other";
}

/**
 * Aplica reglas de modo deterministas tras la generación por Claude.
 *
 * WordPress/Migración:
 * - Si capabilities disponibles: cruza action_type con endpoints activos.
 * - Si capabilities no disponibles: regex como fallback (modeReason lo indica).
 * - HYBRID no existe en WP.
 *
 * Next.js:
 * - performance/bundle → HYBRID (requiere revisión visual).
 *
 * @param capabilities  Endpoint IDs de GET /capabilities (ej: ["publish","seo","media","elementor"]).
 *                      null = proxy no disponible, usar regex fallback.
 */
export function enforceModeRules(
  candidate: AnalysisCandidate,
  platform?: string | null,
  capabilities?: string[] | null,
): AnalysisCandidate {
  if (platform === "WORDPRESS" || platform === "MIGRACION") {
    // HYBRID no existe en WordPress
    if (candidate.mode === "HYBRID") {
      return { ...candidate, mode: "HUMAN", modeReason: "WordPress: no existe modo HYBRID — HUMAN guiado" };
    }

    // Determinar action_type: primero el campo explícito de Claude, luego regex fallback
    const text = `${candidate.titulo} ${candidate.descripcion}`;
    const actionType = candidate.actionType ?? inferActionTypeFromText(text);
    const usingFallback = !candidate.actionType;

    if (capabilities) {
      // ── Capability-based (authoritative) ─────────────────────────
      const executable = isActionExecutable(actionType, capabilities);

      if (executable) {
        const reason = `WordPress: ${actionType} ejecutable (endpoints verificados via /capabilities)`;
        if (candidate.mode !== "AI") {
          return { ...candidate, mode: "AI", modeReason: reason, actionType };
        }
        return { ...candidate, actionType };
      }

      // Not executable — missing endpoints
      const required = ACTION_TYPE_CAPABILITIES[actionType];
      const missing = required.filter((cap) => !capabilities.some((c) => c === cap || c.startsWith(`${cap}/`)));
      const reason = `WordPress: ${actionType} no ejecutable (faltan endpoints: ${missing.join(", ")}) — HUMAN`;
      if (candidate.mode !== "HUMAN") {
        return { ...candidate, mode: "HUMAN", modeReason: reason, actionType };
      }
      return { ...candidate, actionType };
    }

    // ── Regex fallback (capabilities not available) ────────────────
    if (actionType !== "other") {
      const fallbackNote = usingFallback ? " [regex fallback — /capabilities no disponible]" : " [/capabilities no disponible]";
      if (candidate.mode !== "AI") {
        return {
          ...candidate,
          mode: "AI",
          modeReason: `WordPress: ${actionType} (probable — sin verificación de endpoints)${fallbackNote}`,
          actionType,
        };
      }
      return { ...candidate, actionType };
    }

    // Unrecognized action → HUMAN
    if (candidate.mode !== "HUMAN") {
      const fallbackNote = usingFallback ? " [regex fallback]" : "";
      return {
        ...candidate,
        mode: "HUMAN",
        modeReason: `WordPress: acción no reconocida — HUMAN con pasos WP Admin${fallbackNote}`,
        actionType: "other",
      };
    }
    return { ...candidate, actionType: "other" };
  }

  // Next.js: performance/bundle → HYBRID
  if (platform === "NEXTJS" && candidate.mode === "AI") {
    const text = `${candidate.titulo} ${candidate.descripcion}`;
    if (NEXTJS_HYBRID_PATTERNS.some((p) => p.test(text))) {
      return {
        ...candidate,
        mode: "HYBRID",
        modeReason: `${candidate.modeReason} [Auto: performance/bundle → HYBRID, requiere verificación visual]`,
      };
    }
  }

  return candidate;
}

export type AnalysisResultUnified = z.infer<typeof analysisResultSchema>;

// ─── Validación con fallback por item ────────────────────────────────────────

/**
 * Valida candidatas individualmente — una candidata inválida no tumba el array.
 * Asigna UUID estable a cada una.
 */
export function validateCandidates(
  raw: unknown[]
): { valid: AnalysisCandidate[]; dropped: number } {
  const valid: AnalysisCandidate[] = [];
  let dropped = 0;

  for (const item of raw) {
    const result = candidateSchema.safeParse(item);
    if (result.success) {
      valid.push({
        ...result.data,
        id: randomUUID(),
        keywordObjetivo: result.data.keywordObjetivo ?? null,
        urlObjetivo: result.data.urlObjetivo ?? null,
        actionType: result.data.actionType ?? null,
      });
    } else {
      dropped++;
      console.warn(
        "[analysis-candidates] Candidata inválida descartada:",
        JSON.stringify(item).slice(0, 200),
        result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")
      );
    }
  }

  return { valid, dropped };
}

/**
 * Genera candidatas de setup cuando faltan precondiciones.
 * No requiere Claude — son determinísticas.
 */
export function generateSetupCandidates(preconditions: {
  hasKeywords: boolean;
  hasCompetitors: boolean;
  hasGsc: boolean;
  hasSiteAudit: boolean;
  keywordCount: number;
  competitorCount: number;
}): AnalysisCandidate[] {
  const candidates: AnalysisCandidate[] = [];

  if (!preconditions.hasKeywords) {
    candidates.push({
      id: randomUUID(),
      titulo: "Configurar keywords prioritarias para tracking diario",
      descripcion: preconditions.keywordCount === 0
        ? "No hay keywords configuradas. Sin ellas no funciona el tracking, detección de caídas ni análisis de gaps."
        : `Hay ${preconditions.keywordCount} keywords pero ninguna prioritaria. Marcar al menos 5 para tracking diario.`,
      kind: "SETUP",
      mode: "HUMAN",
      modeReason: "Requiere decisión humana sobre qué keywords priorizar.",
      priority: 1,
      effort: "LOW",
      impactoEsperado: "Habilita tracking diario y detección de caídas",
      justificacion: `Keywords prioritarias: 0 de ${preconditions.keywordCount}`,
      fuente: "setup",
    });
  }

  if (!preconditions.hasCompetitors) {
    candidates.push({
      id: randomUUID(),
      titulo: `Agregar ${preconditions.competitorCount === 0 ? "al menos 2" : "1 más"} competidores`,
      descripcion: "Sin competidores no se detectan keyword gaps ni share of voice.",
      kind: "SETUP",
      mode: "HUMAN",
      modeReason: "Requiere decisión humana sobre qué competidores monitorear.",
      priority: 2,
      effort: "LOW",
      impactoEsperado: "Habilita análisis de gaps y share of voice",
      justificacion: `Competidores configurados: ${preconditions.competitorCount} (mín 2)`,
      fuente: "setup",
    });
  }

  if (!preconditions.hasGsc) {
    candidates.push({
      id: randomUUID(),
      titulo: "Conectar Google Search Console",
      descripcion: "Sin GSC no hay datos de clics, impresiones ni CTR real.",
      kind: "SETUP",
      mode: "HUMAN",
      modeReason: "Requiere acceso a la cuenta de Google del cliente.",
      priority: 2,
      effort: "LOW",
      impactoEsperado: "Datos reales de búsqueda orgánica",
      justificacion: "Propiedad GSC: no configurada",
      fuente: "setup",
    });
  }

  if (!preconditions.hasSiteAudit && preconditions.hasKeywords) {
    candidates.push({
      id: randomUUID(),
      titulo: "Ejecutar primer audit técnico del sitio",
      descripcion: "El audit identifica problemas técnicos que limitan el posicionamiento.",
      kind: "SETUP",
      mode: "HUMAN",
      modeReason: "El primer audit se ejecuta desde la UI de Cerebro SEO.",
      priority: 3,
      effort: "LOW",
      impactoEsperado: "Identificar issues técnicos bloqueantes",
      justificacion: "Audits completados: 0",
      fuente: "setup",
    });
  }

  return candidates;
}
