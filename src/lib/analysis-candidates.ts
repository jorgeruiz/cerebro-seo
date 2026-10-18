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

/**
 * WordPress: acciones ejecutables por el plugin vía proxy Cerebro web.
 *
 * Lista explícita de lo que SÍ puede hacer:
 *   v1.5.0 CONTENT (POST /publish):         crear artículo de blog o post
 *   v1.5.0 META    (POST /seo/{id}):         actualizar meta title/description/keyword
 *   v1.5.0 ALT     (POST /media):            subir imagen con alt text
 *   v1.6.0 ELEMENTOR (duplicate+widgets):    editar página Elementor existente
 *   v1.6.0 LANDING (from-template/import):   crear landing desde plantilla o JSON
 *
 * Categorías implícitamente HUMAN (sin lista negra — todo lo que no está aquí):
 *   Performance, CSS global, tema, plugins, header/footer, diseño desde cero, etc.
 *
 * El decomposer valida en tiempo real contra GET /capabilities antes de generar steps AI.
 */
const WP_PLUGIN_ACTION_PATTERNS = [
  // CONTENT — crear blog/post
  /\bblog\b/i, /artículo/i, /articulo/i, /\bpost\b/i, /publicar\s*(artículo|post|blog)/i,
  /crear\s*(artículo|post|contenido)/i, /redactar/i, /escribir\s*(artículo|post|blog)/i,
  /contenido.*blog/i, /blog.*contenido/i,
  // META — actualizar meta tags via Yoast
  /meta\s*(title|description|tag)/i, /yoast/i, /\bseo.*título/i, /título.*seo\b/i,
  /reescribir.*meta/i, /optimizar.*meta/i, /actualizar.*meta/i, /meta.*seo/i,
  /focus\s*keyword/i,
  // ALT — imágenes con texto alternativo
  /\balt\b.*imagen/i, /imagen.*\balt\b/i, /texto\s*alternativo/i, /alt\s*text/i,
  // ELEMENTOR EDITING — v1.6.0: duplicate + widget updates
  /landing\s*(page|de\s*aterrizaje)?/i, /\baterrizaje\b/i,
  /duplicar.*página/i, /página.*duplicar/i,
  /editar.*(?:página|sección|hero).*elementor/i, /elementor.*(?:editar|actualizar|modificar)/i,
  /actualizar.*(?:h[1-6]|heading|encabezado|título\s*principal)/i,
  /(?:h[1-6]|heading|encabezado).*(?:actualizar|cambiar|reescribir)/i,
  /modificar.*(?:imagen|texto|botón|cta).*(?:página|sección)/i,
  /cambiar.*(?:texto|imagen|botón).*(?:página|hero|banner)/i,
  // LANDING CREATION — v1.6.0: from-template / import
  /crear.*(?:landing|página\s*de\s*(?:servicio|producto|contacto|venta))/i,
  /nueva.*(?:landing|página\s*web)/i, /landing.*(?:crear|construir|generar)/i,
];

/**
 * Aplica reglas de modo deterministas tras la generación por Claude.
 *
 * Reemplaza clasificación por palabras clave con reglas por tipo de acción:
 * - WordPress/Migración: modo basado en si la acción es ejecutable por el plugin v1.5.0
 *   (blog/meta/alt → AI; todo lo demás → HUMAN). HYBRID no existe en WP.
 * - Next.js: performance/bundle → HYBRID (requiere revisión visual).
 *
 * La validación final contra GET /capabilities ocurre en el decomposer,
 * que ajusta el tipo de cada step según los endpoints activos en el sitio.
 */
export function enforceModeRules(candidate: AnalysisCandidate, platform?: string | null): AnalysisCandidate {
  if (platform === "WORDPRESS" || platform === "MIGRACION") {
    // HYBRID no existe en WordPress — el plugin no tiene operaciones de revisión intermedia
    if (candidate.mode === "HYBRID") {
      return { ...candidate, mode: "HUMAN", modeReason: "WordPress: no existe modo HYBRID — convierte a HUMAN guiado" };
    }

    const text = `${candidate.titulo} ${candidate.descripcion}`;
    const isPluginAction = WP_PLUGIN_ACTION_PATTERNS.some((p) => p.test(text));

    if (isPluginAction) {
      // La acción pertenece al catálogo del plugin (blog, meta, alt) → AI
      if (candidate.mode !== "AI") {
        return {
          ...candidate,
          mode: "AI",
          modeReason: "WordPress: acción ejecutable por plugin v1.6.0 (blog/meta/alt/elementor/landing) — AI via proxy Cerebro web",
        };
      }
      return candidate;
    }

    // No está en el catálogo del plugin → HUMAN guiado con instrucciones exactas
    if (candidate.mode !== "HUMAN") {
      return {
        ...candidate,
        mode: "HUMAN",
        modeReason: "WordPress: acción fuera del catálogo del plugin (Elementor/diseño/performance) — HUMAN con pasos WP Admin",
      };
    }
    return candidate;
  }

  // Next.js: performance/bundle → HYBRID (el agente lo hace pero necesita revisión visual)
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
