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

// ─── Patrones por plataforma ─────────────────────────────────────────────────

/** Next.js: performance/bundle → forzar HYBRID (nunca AI) */
const NEXTJS_HYBRID_PATTERNS = [
  /performance/i, /speed\s*index/i, /tbt/i, /fcp/i, /lcp/i, /cls/i,
  /core\s*web\s*vitals/i, /lighthouse/i, /bundle/i, /lazy.?load/i,
  /code.?split/i, /refactor/i, /layout/i, /js\s*(sin\s*usar|unused)/i,
  /css\s*(sin\s*usar|unused)/i, /webpack|turbopack/i,
];

/**
 * WordPress: actividades que el plugin NO puede hacer → forzar HUMAN.
 * Cubre Elementor (edición visual), landings, templates, diseño, performance, plugins.
 * Catálogo completo en docs/catalogo-tareas.md.
 */
const WP_FORCE_HUMAN_PATTERNS = [
  /elementor/i, /landing/i, /plantilla/i, /template/i,
  /performance/i, /velocidad/i, /pagespeed/i, /lcp/i, /fcp/i, /tbt/i, /cls/i,
  /plugin/i, /tema\b/i, /theme/i, /header/i, /footer/i,
  /diseño/i, /layout/i, /cta\b/i, /button/i, /botón/i,
  /slider/i, /carousel/i, /galería/i, /gallery/i,
  /css\b/i, /estilo/i, /tipograf/i,
];

/**
 * WordPress: actividades que el plugin SÍ puede hacer → permitir AI.
 * v1.5.0: blog (POST /publish), meta Yoast (POST /seo/{id}),
 *         imágenes con alt (POST /media), editar post (PUT /update/{id}).
 */
const WP_ALLOW_AI_PATTERNS = [
  /blog/i, /artículo/i, /articulo/i, /post\b/i, /publicar/i,
  /meta\s*(title|description|tag)/i, /yoast/i, /seo.*título/i, /título.*seo/i,
  /\balt\b/i, /imagen.*alt/i, /alt.*imagen/i,
  /focus\s*keyword/i, /keyword.*yoast/i,
];

/**
 * Aplica reglas de modo post-Claude según el catálogo oficial (docs/catalogo-tareas.md).
 *
 * WordPress:
 *  - HYBRID nunca permitido → HUMAN
 *  - AI permitido solo para: blog, meta Yoast, alt de imágenes (plugin v1.5.0)
 *  - Todo lo demás (Elementor, landing, performance, plugins) → HUMAN
 *
 * Next.js:
 *  - Performance/bundle/refactor → HYBRID (nunca AI)
 */
export function enforceModeRules(candidate: AnalysisCandidate, platform?: string | null): AnalysisCandidate {
  if (platform === "WORDPRESS" || platform === "MIGRACION") {
    // HYBRID nunca existe en WordPress
    if (candidate.mode === "HYBRID") {
      return { ...candidate, mode: "HUMAN", modeReason: "WordPress: no HYBRID — convierte a HUMAN guiado" };
    }

    if (candidate.mode === "AI") {
      const text = `${candidate.titulo} ${candidate.descripcion}`;
      const isManualActivity = WP_FORCE_HUMAN_PATTERNS.some((p) => p.test(text));
      const isPluginActivity = WP_ALLOW_AI_PATTERNS.some((p) => p.test(text));

      if (isManualActivity && !isPluginActivity) {
        return {
          ...candidate,
          mode: "HUMAN",
          modeReason: "WordPress: actividad requiere Elementor/diseño/performance — HUMAN guiado con instrucciones exactas",
        };
      }
      // isPluginActivity → AI permitido (blog, meta, alt)
    }
    return candidate;
  }

  // Next.js: performance/bundle → HYBRID (nunca AI)
  if (candidate.mode === "AI") {
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
