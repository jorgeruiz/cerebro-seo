/**
 * Task Catalog — single source of truth for the Plan Mensual.
 *
 * Every actionType, its steps, modes, gates, inputs, and acceptance criteria
 * are defined here. The decomposer, analysis, and UI all read from this catalog.
 *
 * This is DATA ONLY — no behavior, no side effects, no imports of runtime modules.
 * Phase F1a: define the catalog. F1b: connect it to the classification. F1c: connect to decomposer.
 */

import { z } from "zod";

// ─── Enums ──────────────────────────────────────────────────────────────────

/** Closed enum of all recognized action types. The classifier must return one of these or `other`. */
export const ACTION_TYPES = [
  // §2 — Existing with template
  "create_blog",
  "update_meta",
  "create_landing",
  "keyword_research",
  "schema",
  "internal_links",
  "edit_page_text",
  "add_image",            // §8 decision #3: upload_media + generate_image → add_image

  // §3 — HUMAN-focused
  "verify_indexation",
  "fix_redirect",
  "verify_analytics",     // §3: was verify_tracking, split + renamed

  // §4.1 — New from audit
  "optimize_alt_text",
  "configure_sitemap",
  "improve_speed",
  "setup_gbp",
  "audit_duplicate",
  "optimize_images",
  "configure_robots",
  "configure_canonical",
  "link_building",

  // §4.2 — New from audit
  "fix_headings",
  "fix_broken_links",
  "refresh_content",
  "add_faq",
  "aeo_readiness",
  "merge_content",
  "add_human_evidence",
  "security_fix",

  // Catch-all
  "other",
] as const;

export type ActionType = typeof ACTION_TYPES[number];

export type TaskClass = "execution" | "diagnostic" | "offsite";

export type TaskCategory =
  | "technical"
  | "content"
  | "aeo_geo"
  | "authority_local"
  | "measurement_conversion"
  | "infrastructure";

/** Closed vocabulary of step types (spec §1.2). */
export const STEP_KINDS = [
  // AI steps (write within their lane)
  "content_package",
  "publish",
  "seo",
  "elementor_edit",
  "elementor_template",
  "image",
  "agent",
  "content_lane",
  "nextjs_blog_generate",
  "keyword_research",
  "apply_keywords",
  "analysis",
  // HM steps
  "review",
  "wp_manual",
  "external_tool",
  "config",
  "terminal",
  "input",
] as const;

export type StepKind = typeof STEP_KINDS[number];

export type Mode = "AI" | "HYBRID" | "MANUAL";
export type Risk = "low" | "medium" | "high";
export type Complexity = "low" | "medium" | "high";
export type Platform = "NEXTJS" | "WORDPRESS";

export type HumanReason =
  | "Decisión editorial o de negocio: requiere criterio humano."
  | "El plugin no tiene la capability para hacerlo."
  | "Herramienta externa sin API de escritura disponible."
  | "Configuración de la cuenta del cliente."
  | "Requiere juicio técnico interactivo."
  | "La IA no debe inventar este material."
  | string; // allow custom reasons

/** Gate IDs from spec §1.4 */
export type GateId = "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7" | "G8";

// ─── Step Template ──────────────────────────────────────────────────────────

export interface StepTemplate {
  kind: StepKind;
  title: string;
  type: "AI" | "HM";
  /** Required WP capability for this AI step. If missing → fallback. */
  requiredCapability?: string;
  /** humanReason shown in UI for HM steps. */
  humanReason?: HumanReason;
  /** Fallback step if capability is missing. */
  fallback?: StepTemplate;
}

// ─── Mode definition per platform ───────────────────────────────────────────

export interface PlatformMode {
  mode: Mode;
  /** Capability condition. If undefined → always this mode. */
  condition?: string;
  /** Mode if condition fails. */
  fallbackMode?: Mode;
}

// ─── Catalog Entry ──────────────────────────────────────────────────────────

export interface CatalogEntry {
  actionType: ActionType;
  class: TaskClass;
  category: TaskCategory;
  tags?: string[];

  modes: Record<Platform, PlatformMode>;
  steps: Record<Platform, StepTemplate[]>;

  /** Zod schema for required inputs. Validated before execution. */
  inputs: z.ZodType;

  gates: GateId[];
  acceptance: string[];
  signals: string[];
  negativeSignals: string[];

  /**
   * Absorption rule (spec §1.5 regla 1b): when a task creates or rewrites
   * a single URL, it absorbs on-page elements of that URL. Mentions of
   * absorbed types targeting the same URL are NOT a conflict nor do they
   * make the task composite.
   */
  absorbs?: ActionType[];

  complexity: Complexity;
  risk: Risk;

  /** Word range [min, max] for content generation, or null if N/A. */
  wordRange?: [number, number] | null;
}

// ─── Configuration constants ────────────────────────────────────────────────

export const OTHER_CONFIDENCE_THRESHOLD = 0.75;

export const WORD_RANGES = {
  informational: [1200, 1800] as [number, number],
  short_answer_aeo: [600, 900] as [number, number],
  landing: [800, 1200] as [number, number],
};

// ─── Deprecated alias mapping (for migrating existing data) ─────────────────

/**
 * Maps deprecated actionType values to their canonical equivalent.
 * Used ONLY for reading existing data. The classifier must NEVER return these.
 */
export const DEPRECATED_ALIASES: Record<string, ActionType | null> = {
  "edit_page_widgets": "edit_page_text",
  "create_landing_from_template": "create_landing",
  // update_post → refresh_content IF target is a blog post. Otherwise → other (NEEDS_DEFINITION).
  // This cannot be resolved statically — the migration script must check the target.
  "update_post": null, // resolved at migration time, not here
  // upload_media and generate_image → add_image
  "upload_media": "add_image",
  "generate_image": "add_image",
  // verify_tracking → verify_analytics (tracking of positions absorbed by keyword_research)
  "verify_tracking": "verify_analytics",
};

/**
 * Resolve a potentially deprecated actionType to its canonical form.
 * Returns null if the alias requires context to resolve (e.g. update_post).
 */
export function resolveAlias(actionType: string): ActionType | null {
  if (ACTION_TYPES.includes(actionType as ActionType)) return actionType as ActionType;
  return DEPRECATED_ALIASES[actionType] ?? null;
}

// ─── Catalog ────────────────────────────────────────────────────────────────

const noInputs = z.object({});
const urlInput = z.object({ targetUrl: z.string().min(1) });
const urlKeywordInput = z.object({ targetUrl: z.string().min(1), keyword: z.string().min(1) });

export const CATALOG: CatalogEntry[] = [

  // ── §2 EXISTING WITH TEMPLATE ─────────────────────────────────────────────

  {
    actionType: "create_blog",
    class: "execution",
    category: "content",
    tags: ["blog", "article"],
    modes: {
      NEXTJS: { mode: "HYBRID" },
      WORDPRESS: { mode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "nextjs_blog_generate", title: "Generar artículo", type: "AI" },
        { kind: "image", title: "Imagen de portada", type: "AI" },
        { kind: "review", title: "Revisar texto", type: "HM", humanReason: "Revisión editorial antes de publicar en producción." },
        { kind: "content_lane", title: "Publicar en main", type: "AI" },
      ],
      WORDPRESS: [
        { kind: "content_package", title: "Paquete de contenido", type: "AI" },
        { kind: "publish", title: "Crear borrador en WordPress", type: "AI", requiredCapability: "publish",
          fallback: { kind: "wp_manual", title: "Crear borrador manualmente en WP Admin", type: "HM", humanReason: "El plugin no tiene la capability para hacerlo." } },
        { kind: "image", title: "Imagen de portada", type: "AI", requiredCapability: "media",
          fallback: { kind: "input", title: "Proporcionar imagen de portada", type: "HM", humanReason: "La IA no debe inventar este material." } },
        { kind: "review", title: "Revisar y publicar borrador", type: "HM", humanReason: "Decisión: en WP los blogs se publican manualmente desde el borrador." },
      ],
    },
    inputs: z.object({ keyword: z.string().min(1), intention: z.string().optional() }),
    gates: ["G1", "G2", "G6", "G7"],
    acceptance: [
      "1 H1 con la keyword",
      "title ≤60 chars",
      "description ≤155 chars",
      "1–3 enlaces internos a servicios verificados",
      "sin [COMPLETAR",
      "máx. 2 imágenes",
    ],
    signals: ["blog", "artículo nuevo", "redactar artículo", "crear artículo", "nota de blog", "artículo pilar", "publicar artículo", "artículo de blog", "guía completa"],
    negativeSignals: ["actualizar artículo", "artículo existente", "URL de /blog/ ya existente"],
    absorbs: ["update_meta", "fix_headings", "add_faq", "schema", "internal_links", "add_image"],
    complexity: "high",
    risk: "low",
    wordRange: WORD_RANGES.informational,
  },

  {
    actionType: "update_meta",
    class: "execution",
    category: "technical",
    tags: ["meta", "seo", "title", "description"],
    modes: {
      NEXTJS: { mode: "AI" },
      WORDPRESS: { mode: "AI", condition: "seo_write" },
    },
    steps: {
      NEXTJS: [
        { kind: "agent", title: "Editar metadata", type: "AI" },
      ],
      WORDPRESS: [
        { kind: "seo", title: "Generar meta tags", type: "AI", requiredCapability: "seo_write",
          fallback: { kind: "wp_manual", title: "Aplicar metas en Yoast", type: "HM", humanReason: "El plugin no tiene la capability para hacerlo." } },
      ],
    },
    inputs: urlKeywordInput,
    gates: ["G1", "G2", "G7", "G8"],
    acceptance: [
      "title 50–60 chars con la keyword",
      "description 140–155 chars",
      "title único en el sitio",
    ],
    signals: ["meta title", "meta description", "meta tag", "title tag", "focus keyword", "CTR bajo"],
    negativeSignals: ["H1", "encabezado", "schema", "datos estructurados", "yoast sola"],
    complexity: "low",
    risk: "low",
  },

  {
    actionType: "create_landing",
    class: "execution",
    category: "content",
    tags: ["landing", "service page", "product page"],
    modes: {
      NEXTJS: { mode: "AI" },
      WORDPRESS: { mode: "HYBRID", condition: "elementor_write", fallbackMode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "agent", title: "Crear landing page", type: "AI" },
      ],
      WORDPRESS: [
        { kind: "content_package", title: "Paquete de contenido para landing", type: "AI" },
        { kind: "elementor_template", title: "Borrador desde plantilla", type: "AI", requiredCapability: "elementor_write",
          fallback: { kind: "wp_manual", title: "Armar en Elementor", type: "HM", humanReason: "El plugin no tiene la capability para hacerlo." } },
        { kind: "review", title: "Revisar y publicar", type: "HM", humanReason: "Decisión editorial o de negocio: requiere criterio humano." },
      ],
    },
    inputs: z.object({ keyword: z.string().min(1), serviceType: z.string().optional() }),
    gates: ["G1", "G2", "G6", "G7"],
    acceptance: [
      "1 H1 con la keyword",
      "metas completos",
      "CTA y formulario existentes del sitio",
      "sin datos inventados",
    ],
    signals: ["landing", "página de servicio", "página para ciudad", "página de producto", "crear landing", "landing page"],
    negativeSignals: ["blog", "artículo", "crear página sin servicio ni ubicación"],
    absorbs: ["update_meta", "fix_headings", "schema", "add_faq", "internal_links"],
    complexity: "high",
    risk: "medium",
    wordRange: WORD_RANGES.landing,
  },

  {
    actionType: "keyword_research",
    class: "diagnostic",
    category: "technical",
    tags: ["keywords", "research", "tracking"],
    modes: {
      NEXTJS: { mode: "HYBRID" },
      WORDPRESS: { mode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "keyword_research", title: "Investigar y seleccionar keywords", type: "AI" },
        { kind: "review", title: "Aprobar tabla de keywords", type: "HM", humanReason: "Selección estratégica: define en qué invierte el mes." },
        { kind: "apply_keywords", title: "Aplicar keywords aprobadas", type: "AI" },
      ],
      WORDPRESS: [
        { kind: "keyword_research", title: "Investigar y seleccionar keywords", type: "AI" },
        { kind: "review", title: "Aprobar tabla de keywords", type: "HM", humanReason: "Selección estratégica: define en qué invierte el mes." },
        { kind: "apply_keywords", title: "Aplicar keywords aprobadas", type: "AI" },
      ],
    },
    inputs: z.object({ seeds: z.array(z.string()).min(1).optional(), location: z.string().optional() }),
    gates: ["G1", "G2"],
    acceptance: [
      "Tabla con volumen, KD, intención y URL objetivo",
      "Sin keywords asignadas a dos URLs",
      "Costo registrado en ApiUsage",
    ],
    signals: ["investigar keywords", "palabras clave prioritarias", "keyword research", "configurar keywords", "rank tracking"],
    negativeSignals: ["competencia sin keywords", "competidores sin keywords", "verificar tracking", "configurar tracking en herramienta", "rank tracker", "depurar", "Semrush", "Ahrefs", "plugin Cerebro"],
    complexity: "medium",
    risk: "low",
  },

  {
    actionType: "schema",
    class: "execution",
    category: "technical",
    tags: ["schema", "json-ld", "structured data", "rich results"],
    modes: {
      NEXTJS: { mode: "AI" },
      WORDPRESS: { mode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "agent", title: "Implementar JSON-LD", type: "AI" },
      ],
      WORDPRESS: [
        { kind: "content_package", title: "Generar y validar JSON-LD", type: "AI" },
        { kind: "wp_manual", title: "Pegar en Rank Math/Yoast", type: "HM", humanReason: "El plugin no escribe schema; se pega en el plugin SEO." },
      ],
    },
    inputs: z.object({ targetUrl: z.string().min(1), schemaType: z.string().optional() }),
    gates: ["G1", "G2", "G8"],
    acceptance: [
      "JSON válido",
      "Todo lo marcado está visible en la página",
      "Prohibido aggregateRating/review sin reseñas reales",
    ],
    signals: ["schema", "json-ld", "datos estructurados", "structured data", "rich results"],
    negativeSignals: ["meta title", "meta description"],
    complexity: "medium",
    risk: "medium",
  },

  {
    actionType: "internal_links",
    class: "execution",
    category: "content",
    tags: ["interlinking"],
    modes: {
      NEXTJS: { mode: "AI" },
      WORDPRESS: { mode: "AI", condition: "elementor_write", fallbackMode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "agent", title: "Agregar/optimizar enlaces internos", type: "AI" },
      ],
      WORDPRESS: [
        { kind: "analysis", title: "Mapa de enlaces: origen, ancla, destino", type: "AI" },
        { kind: "elementor_edit", title: "Aplicar en widgets de texto", type: "AI", requiredCapability: "elementor_write",
          fallback: { kind: "wp_manual", title: "Aplicar en Elementor", type: "HM", humanReason: "El plugin no tiene la capability para hacerlo." } },
      ],
    },
    inputs: z.object({ targetUrl: z.string().min(1) }),
    gates: ["G1", "G2", "G8"],
    acceptance: [
      "Destinos con 200",
      "Máx 3 enlaces nuevos por página origen",
      "Anclas variadas (no siempre exact-match)",
      "Sin autoenlaces",
    ],
    signals: ["enlaces internos", "interlinking", "internal links", "enlazar desde"],
    negativeSignals: ["backlinks", "enlaces externos", "enlaces rotos"],
    complexity: "medium",
    risk: "low",
  },

  {
    actionType: "edit_page_text",
    class: "execution",
    category: "content",
    tags: ["optimize", "copy", "rewrite"],
    modes: {
      NEXTJS: { mode: "AI" },
      WORDPRESS: { mode: "AI", condition: "elementor_write", fallbackMode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "agent", title: "Editar contenido de la página", type: "AI" },
      ],
      WORDPRESS: [
        { kind: "elementor_edit", title: "Duplicar y editar widgets", type: "AI", requiredCapability: "elementor_write",
          fallback: { kind: "wp_manual", title: "Aplicar cambios en Elementor", type: "HM", humanReason: "El plugin no tiene la capability para hacerlo." } },
      ],
    },
    inputs: z.object({ targetUrl: z.string().min(1), keyword: z.string().optional(), improvement: z.string().optional() }),
    gates: ["G1", "G2", "G7", "G8"],
    acceptance: [
      "Mismos servicios y datos duros",
      "Keyword en H1/H2/primer párrafo sin stuffing",
      "Diff legible antes→después",
    ],
    signals: ["optimizar texto", "reescribir contenido", "mejorar copy", "ampliar contenido", "optimizar on-page", "optimizar contenido"],
    negativeSignals: ["meta", "title tag", "H1 solo", "artículo de blog", "FAQ"],
    absorbs: ["update_meta", "fix_headings"],
    complexity: "medium",
    risk: "medium",
  },

  {
    actionType: "add_image",
    class: "execution",
    category: "content",
    tags: ["image", "media", "photo"],
    modes: {
      NEXTJS: { mode: "HYBRID" },
      WORDPRESS: { mode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "input", title: "Proporcionar imagen (o generar con IA)", type: "HM", humanReason: "La IA no debe inventar este material." },
        { kind: "agent", title: "Optimizar e insertar", type: "AI" },
      ],
      WORDPRESS: [
        { kind: "input", title: "Proporcionar imagen (o generar con IA)", type: "HM", humanReason: "La IA no debe inventar este material." },
        { kind: "image", title: "Optimizar + subir", type: "AI", requiredCapability: "media",
          fallback: { kind: "wp_manual", title: "Subir manualmente en WP Admin", type: "HM", humanReason: "El plugin no tiene la capability para hacerlo." } },
      ],
    },
    inputs: z.object({ targetUrl: z.string().min(1), origin: z.enum(["provided", "generated"]).optional() }),
    gates: ["G1", "G2", "G8"],
    acceptance: [
      "Alt descriptivo ≤125 chars",
      "Sin keyword stuffing en alt",
      "≤200 KB",
    ],
    signals: ["imagen", "foto", "media"],
    negativeSignals: ["alt text solo"],
    complexity: "low",
    risk: "low",
  },

  // ── §3 HUMAN-FOCUSED ──────────────────────────────────────────────────────

  {
    actionType: "verify_indexation",
    class: "offsite",
    category: "technical",
    tags: ["indexation", "gsc", "coverage"],
    modes: {
      NEXTJS: { mode: "HYBRID" },
      WORDPRESS: { mode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "analysis", title: "Revisar URLs con GSC URL Inspection", type: "AI" },
        { kind: "external_tool", title: "Solicitar indexación de las no indexadas", type: "HM", humanReason: "GSC no permite solicitar indexación por API para páginas normales." },
      ],
      WORDPRESS: [
        { kind: "analysis", title: "Revisar URLs con GSC URL Inspection", type: "AI" },
        { kind: "external_tool", title: "Solicitar indexación de las no indexadas", type: "HM", humanReason: "GSC no permite solicitar indexación por API para páginas normales." },
      ],
    },
    inputs: z.object({ urls: z.array(z.string()).min(1).optional() }),
    gates: ["G1", "G2"],
    acceptance: ["URLs indexadas o solicitud enviada", "Documentar motivo de no-indexación"],
    signals: ["indexación", "indexar", "no indexada", "cobertura"],
    negativeSignals: ["noindex", "desindexar", "bloquear"],
    complexity: "low",
    risk: "low",
  },

  {
    actionType: "fix_redirect",
    class: "execution",
    category: "technical",
    tags: ["redirect", "301", "404"],
    modes: {
      NEXTJS: { mode: "AI" },
      WORDPRESS: { mode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "analysis", title: "Tabla origen→destino", type: "AI" },
        { kind: "agent", title: "Implementar en next.config o middleware", type: "AI" },
      ],
      WORDPRESS: [
        { kind: "analysis", title: "Tabla origen→destino", type: "AI" },
        { kind: "wp_manual", title: "Configurar en plugin Redirection", type: "HM", humanReason: "Cerebro Conector no gestiona redirecciones." },
      ],
    },
    inputs: z.object({ redirects: z.array(z.object({ from: z.string(), to: z.string() })).optional() }),
    gates: ["G1", "G2"],
    acceptance: ["301 por defecto", "Sin cadenas ni loops", "Destino responde 200"],
    signals: ["redirección", "redirect", "301", "URL antigua", "migración de URLs"],
    negativeSignals: ["enlace roto interno", "404 sola"],
    complexity: "low",
    risk: "medium",
  },

  {
    actionType: "verify_analytics",
    class: "offsite",
    category: "measurement_conversion",
    tags: ["ga4", "gtm", "analytics", "conversions"],
    modes: {
      NEXTJS: { mode: "HYBRID" },
      WORDPRESS: { mode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "analysis", title: "Revisar eventos vía GA4 Data API", type: "AI" },
        { kind: "external_tool", title: "Corregir en GTM/GA4", type: "HM", humanReason: "Herramienta externa sin API de escritura disponible." },
      ],
      WORDPRESS: [
        { kind: "analysis", title: "Revisar eventos vía GA4 Data API", type: "AI" },
        { kind: "external_tool", title: "Corregir en GTM/GA4", type: "HM", humanReason: "Herramienta externa sin API de escritura disponible." },
      ],
    },
    inputs: noInputs,
    gates: ["G1", "G2"],
    acceptance: ["Eventos configurados y con datos", "Conversiones registrándose"],
    signals: ["GA4", "GTM", "analytics", "conversiones", "eventos", "medición"],
    negativeSignals: ["rastreo", "crawl", "posiciones", "ranking"],
    complexity: "medium",
    risk: "low",
  },

  // ── §4.1 NEW FROM AUDIT ───────────────────────────────────────────────────

  {
    actionType: "optimize_alt_text",
    class: "execution",
    category: "technical",
    tags: ["alt", "images", "accessibility"],
    modes: {
      NEXTJS: { mode: "AI" },
      WORDPRESS: { mode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "agent", title: "Actualizar alt en componentes/MDX", type: "AI" },
      ],
      WORDPRESS: [
        { kind: "content_package", title: "Generar alt text descriptivo", type: "AI" },
        { kind: "wp_manual", title: "Aplicar alt en medios", type: "HM", humanReason: "El plugin no tiene la capability para hacerlo." },
      ],
    },
    inputs: urlInput,
    gates: ["G1", "G2", "G8"],
    acceptance: ["Alt descriptivo ≤125 chars", "Sin keyword stuffing", "Decorativas con alt=\"\""],
    signals: ["alt text", "alt de imágenes", "texto alternativo"],
    negativeSignals: ["imagen nueva", "generar imagen"],
    complexity: "low",
    risk: "low",
  },

  {
    actionType: "configure_sitemap",
    class: "execution",
    category: "technical",
    modes: {
      NEXTJS: { mode: "HYBRID" },
      WORDPRESS: { mode: "MANUAL" },
    },
    steps: {
      NEXTJS: [
        { kind: "agent", title: "Configurar app/sitemap.ts", type: "AI" },
        { kind: "external_tool", title: "Enviar en GSC", type: "HM", humanReason: "Herramienta externa sin API de escritura disponible." },
      ],
      WORDPRESS: [
        { kind: "wp_manual", title: "Verificar sitemap en Yoast/Rank Math", type: "HM", humanReason: "El plugin no tiene la capability para hacerlo." },
        { kind: "external_tool", title: "Enviar en GSC", type: "HM", humanReason: "Herramienta externa sin API de escritura disponible." },
      ],
    },
    inputs: noInputs,
    gates: ["G1", "G2"],
    acceptance: ["Incluye URLs indexables", "Excluye noindex/redirect"],
    signals: ["sitemap", "sitemap.xml"],
    negativeSignals: ["robots.txt"],
    complexity: "low",
    risk: "low",
  },

  {
    actionType: "improve_speed",
    class: "execution",
    category: "technical",
    modes: {
      NEXTJS: { mode: "HYBRID" },
      WORDPRESS: { mode: "MANUAL" },
    },
    steps: {
      NEXTJS: [
        { kind: "analysis", title: "Diagnóstico PSI", type: "AI" },
        { kind: "agent", title: "Optimizar (next/image, fuentes, lazy)", type: "AI" },
        { kind: "review", title: "Verificar sin regresión", type: "HM", humanReason: "Decisión editorial o de negocio: requiere criterio humano." },
      ],
      WORDPRESS: [
        { kind: "wp_manual", title: "Configurar caché, CDN, plugin optimización", type: "HM", humanReason: "El plugin no tiene la capability para hacerlo." },
      ],
    },
    inputs: z.object({ targetUrl: z.string().min(1), metric: z.string().optional() }),
    gates: ["G1", "G2"],
    acceptance: ["PSI antes/después sin regresión"],
    signals: ["velocidad", "Core Web Vitals", "LCP", "CLS", "INP", "performance"],
    negativeSignals: [],
    complexity: "high",
    risk: "high",
  },

  {
    actionType: "setup_gbp",
    class: "offsite",
    category: "authority_local",
    modes: {
      NEXTJS: { mode: "HYBRID" },
      WORDPRESS: { mode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "content_package", title: "Descripción, categorías, posts", type: "AI" },
        { kind: "input", title: "NAP, horarios y accesos", type: "HM", humanReason: "La IA no debe inventar este material." },
        { kind: "external_tool", title: "Configurar en Google Business Profile", type: "HM", humanReason: "Herramienta externa sin API de escritura disponible." },
      ],
      WORDPRESS: [
        { kind: "content_package", title: "Descripción, categorías, posts", type: "AI" },
        { kind: "input", title: "NAP, horarios y accesos", type: "HM", humanReason: "La IA no debe inventar este material." },
        { kind: "external_tool", title: "Configurar en Google Business Profile", type: "HM", humanReason: "Herramienta externa sin API de escritura disponible." },
      ],
    },
    inputs: noInputs,
    gates: ["G1", "G2"],
    acceptance: ["NAP idéntico al sitio", "Nunca inventar horarios ni direcciones"],
    signals: ["Google Business", "GBP", "ficha de Google", "Google Maps"],
    negativeSignals: [],
    complexity: "medium",
    risk: "low",
  },

  {
    actionType: "audit_duplicate",
    class: "diagnostic",
    category: "technical",
    modes: {
      NEXTJS: { mode: "HYBRID" },
      WORDPRESS: { mode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "analysis", title: "Análisis de contenido duplicado + queries GSC", type: "AI" },
        { kind: "review", title: "Decidir fusión/canonical/redirect", type: "HM", humanReason: "Decisión editorial o de negocio: requiere criterio humano." },
      ],
      WORDPRESS: [
        { kind: "analysis", title: "Análisis de contenido duplicado + queries GSC", type: "AI" },
        { kind: "review", title: "Decidir fusión/canonical/redirect", type: "HM", humanReason: "Decisión editorial o de negocio: requiere criterio humano." },
      ],
    },
    inputs: noInputs,
    gates: ["G1", "G2"],
    acceptance: ["Produce tareas hijas: merge_content, configure_canonical, fix_redirect, edit_page_text"],
    signals: ["duplicado", "canibalización", "contenido duplicado"],
    negativeSignals: ["fusionar con URLs"],
    complexity: "medium",
    risk: "low",
  },

  {
    actionType: "optimize_images",
    class: "execution",
    category: "technical",
    modes: {
      NEXTJS: { mode: "AI" },
      WORDPRESS: { mode: "MANUAL" },
    },
    steps: {
      NEXTJS: [
        { kind: "agent", title: "Comprimir a WebP/AVIF + next/image sizes", type: "AI" },
      ],
      WORDPRESS: [
        { kind: "wp_manual", title: "Plugin de compresión/WebP", type: "HM", humanReason: "El plugin no tiene la capability para hacerlo." },
      ],
    },
    inputs: noInputs,
    gates: ["G1", "G2"],
    acceptance: ["≤200 KB por imagen", "Sin cambio visual"],
    signals: ["optimizar imágenes", "comprimir imágenes", "WebP", "peso de imágenes"],
    negativeSignals: ["alt text", "generar imagen"],
    complexity: "medium",
    risk: "low",
  },

  {
    actionType: "configure_robots",
    class: "execution",
    category: "technical",
    modes: {
      NEXTJS: { mode: "HYBRID" },
      WORDPRESS: { mode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "agent", title: "Configurar app/robots.ts", type: "AI" },
        { kind: "review", title: "Revisar antes de publicar", type: "HM", humanReason: "Decisión editorial o de negocio: requiere criterio humano." },
      ],
      WORDPRESS: [
        { kind: "content_package", title: "Generar robots.txt", type: "AI" },
        { kind: "wp_manual", title: "Pegar en plugin SEO", type: "HM", humanReason: "El plugin no tiene la capability para hacerlo." },
      ],
    },
    inputs: noInputs,
    gates: ["G1", "G2"],
    acceptance: [
      "Sin Disallow: / global",
      "Sin bloqueo de GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot",
      "Referencia al sitemap",
    ],
    signals: ["robots.txt", "robots", "crawl budget"],
    negativeSignals: ["sitemap"],
    complexity: "low",
    risk: "high",
  },

  {
    actionType: "configure_canonical",
    class: "execution",
    category: "technical",
    modes: {
      NEXTJS: { mode: "AI" },
      WORDPRESS: { mode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "agent", title: "Configurar canonical en alternates", type: "AI" },
      ],
      WORDPRESS: [
        { kind: "content_package", title: "Determinar URL canonical correcta", type: "AI" },
        { kind: "wp_manual", title: "Configurar canonical en Yoast/Rank Math", type: "HM", humanReason: "El plugin no tiene la capability para hacerlo." },
      ],
    },
    inputs: z.object({ targetUrl: z.string().min(1), canonicalUrl: z.string().min(1) }),
    gates: ["G1", "G2", "G8"],
    acceptance: ["Absoluta", "Self-referencing por defecto", "Coherente con sitemap y redirects"],
    signals: ["canonical", "rel canonical", "URL canónica"],
    negativeSignals: ["duplicado sin decisión"],
    complexity: "low",
    risk: "medium",
  },

  {
    actionType: "link_building",
    class: "offsite",
    category: "authority_local",
    modes: {
      NEXTJS: { mode: "HYBRID" },
      WORDPRESS: { mode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "analysis", title: "Gaps de backlinks vs competencia", type: "AI" },
        { kind: "review", title: "Aprobar prospectos", type: "HM", humanReason: "Decisión editorial o de negocio: requiere criterio humano." },
        { kind: "external_tool", title: "Outreach", type: "HM", humanReason: "Herramienta externa sin API de escritura disponible." },
      ],
      WORDPRESS: [
        { kind: "analysis", title: "Gaps de backlinks vs competencia", type: "AI" },
        { kind: "review", title: "Aprobar prospectos", type: "HM", humanReason: "Decisión editorial o de negocio: requiere criterio humano." },
        { kind: "external_tool", title: "Outreach", type: "HM", humanReason: "Herramienta externa sin API de escritura disponible." },
      ],
    },
    inputs: noInputs,
    gates: ["G1", "G2"],
    acceptance: ["Solo prospectos que salen de los datos", "Costo DataForSEO registrado"],
    signals: ["backlinks", "link building", "autoridad", "enlaces externos"],
    negativeSignals: ["enlaces internos"],
    complexity: "high",
    risk: "low",
  },

  // ── §4.2 NEW FROM AUDIT (additional) ──────────────────────────────────────

  {
    actionType: "fix_headings",
    class: "execution",
    category: "technical",
    modes: {
      NEXTJS: { mode: "AI" },
      WORDPRESS: { mode: "AI", condition: "elementor_write", fallbackMode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "agent", title: "Corregir jerarquía de encabezados", type: "AI" },
      ],
      WORDPRESS: [
        { kind: "elementor_edit", title: "Editar widgets heading", type: "AI", requiredCapability: "elementor_write",
          fallback: { kind: "wp_manual", title: "Editar encabezados en Elementor", type: "HM", humanReason: "El plugin no tiene la capability para hacerlo." } },
      ],
    },
    inputs: urlInput,
    gates: ["G1", "G2", "G8"],
    acceptance: ["1 H1 por página", "Jerarquía sin saltos (H1→H2→H3)"],
    signals: ["H1", "encabezado", "heading", "jerarquía de títulos"],
    negativeSignals: ["meta title", "title tag"],
    complexity: "low",
    risk: "low",
  },

  {
    actionType: "fix_broken_links",
    class: "execution",
    category: "technical",
    modes: {
      NEXTJS: { mode: "AI" },
      WORDPRESS: { mode: "AI", condition: "elementor_write", fallbackMode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "analysis", title: "Listar enlaces rotos", type: "AI" },
        { kind: "agent", title: "Corregir enlaces", type: "AI" },
      ],
      WORDPRESS: [
        { kind: "analysis", title: "Listar enlaces rotos", type: "AI" },
        { kind: "elementor_edit", title: "Corregir en widgets", type: "AI", requiredCapability: "elementor_write",
          fallback: { kind: "wp_manual", title: "Corregir en Elementor", type: "HM", humanReason: "El plugin no tiene la capability para hacerlo." } },
      ],
    },
    inputs: noInputs,
    gates: ["G1", "G2"],
    acceptance: ["Todos los enlaces apuntan a URLs con 200"],
    signals: ["enlace roto", "broken link", "link roto", "error 404 interno"],
    negativeSignals: ["redirección", "301"],
    complexity: "low",
    risk: "low",
  },

  {
    actionType: "refresh_content",
    class: "execution",
    category: "content",
    modes: {
      NEXTJS: { mode: "HYBRID" },
      WORDPRESS: { mode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "nextjs_blog_generate", title: "Actualizar artículo", type: "AI" },
        { kind: "review", title: "Revisar cambios", type: "HM", humanReason: "Revisión editorial antes de publicar en producción." },
        { kind: "content_lane", title: "Publicar actualización", type: "AI" },
      ],
      WORDPRESS: [
        { kind: "content_package", title: "Paquete de actualización", type: "AI" },
        { kind: "review", title: "Revisar y aplicar", type: "HM", humanReason: "Decisión editorial o de negocio: requiere criterio humano." },
      ],
    },
    inputs: z.object({ targetUrl: z.string().min(1) }),
    gates: ["G1", "G2", "G8"],
    acceptance: ["Contenido actualizado con datos vigentes", "Sin perder posicionamiento existente"],
    signals: ["actualizar artículo", "refrescar contenido", "artículo desactualizado", "contenido viejo"],
    negativeSignals: ["crear artículo", "nuevo artículo"],
    complexity: "medium",
    risk: "medium",
    wordRange: WORD_RANGES.informational,
  },

  {
    actionType: "add_faq",
    class: "execution",
    category: "aeo_geo",
    modes: {
      NEXTJS: { mode: "AI" },
      WORDPRESS: { mode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "agent", title: "Agregar sección FAQ + FAQPage schema", type: "AI" },
      ],
      WORDPRESS: [
        { kind: "content_package", title: "Generar FAQ y schema", type: "AI" },
        { kind: "wp_manual", title: "Agregar FAQ en la página", type: "HM", humanReason: "El plugin no tiene la capability para hacerlo." },
      ],
    },
    inputs: urlInput,
    gates: ["G1", "G2", "G8"],
    acceptance: ["Respuestas solo con información verificada", "FAQPage schema válido"],
    signals: ["FAQ", "preguntas frecuentes", "featured snippet", "respuestas directas", "bloques de respuesta"],
    negativeSignals: [],
    absorbs: ["schema"],
    complexity: "medium",
    risk: "low",
    wordRange: WORD_RANGES.short_answer_aeo,
  },

  {
    actionType: "aeo_readiness",
    class: "execution",
    category: "aeo_geo",
    modes: {
      NEXTJS: { mode: "AI" },
      WORDPRESS: { mode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "agent", title: "Implementar llms.txt, rutas .md, robots para bots IA", type: "AI" },
      ],
      WORDPRESS: [
        { kind: "content_package", title: "Generar llms.txt y configuración", type: "AI" },
        { kind: "wp_manual", title: "Aplicar en WP", type: "HM", humanReason: "El plugin no tiene la capability para hacerlo." },
      ],
    },
    inputs: noInputs,
    gates: ["G1", "G2"],
    acceptance: ["Nunca cloaking ni user-agent sniffing", "llms.txt válido"],
    signals: ["llms.txt", "AEO", "AI Overviews", "ChatGPT", "Perplexity", "legibilidad IA"],
    negativeSignals: [],
    complexity: "medium",
    risk: "medium",
  },

  {
    actionType: "merge_content",
    class: "execution",
    category: "content",
    modes: {
      NEXTJS: { mode: "HYBRID" },
      WORDPRESS: { mode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "analysis", title: "Plan de fusión", type: "AI" },
        { kind: "review", title: "Aprobar plan", type: "HM", humanReason: "Decisión editorial o de negocio: requiere criterio humano." },
        { kind: "agent", title: "Fusionar contenido + redirect", type: "AI" },
      ],
      WORDPRESS: [
        { kind: "analysis", title: "Plan de fusión", type: "AI" },
        { kind: "review", title: "Aprobar plan", type: "HM", humanReason: "Decisión editorial o de negocio: requiere criterio humano." },
        { kind: "wp_manual", title: "Fusionar en WP Admin", type: "HM", humanReason: "El plugin no tiene la capability para hacerlo." },
      ],
    },
    inputs: z.object({ sourceUrls: z.array(z.string()).min(2), targetUrl: z.string().min(1) }),
    gates: ["G1", "G2"],
    acceptance: ["Contenido fusionado sin pérdida", "Redirects configurados"],
    signals: ["fusionar", "consolidar", "merge", "canibalización con decisión"],
    negativeSignals: ["duplicado sin decisión"],
    complexity: "high",
    risk: "high",
  },

  {
    actionType: "add_human_evidence",
    class: "execution",
    category: "content",
    tags: ["testimonial", "case study", "evidence"],
    modes: {
      NEXTJS: { mode: "HYBRID" },
      WORDPRESS: { mode: "HYBRID" },
    },
    steps: {
      NEXTJS: [
        { kind: "input", title: "Aportar caso/testimonio/datos reales", type: "HM", humanReason: "La IA no debe inventar este material." },
        { kind: "agent", title: "Integrar en la página", type: "AI" },
      ],
      WORDPRESS: [
        { kind: "input", title: "Aportar caso/testimonio/datos reales", type: "HM", humanReason: "La IA no debe inventar este material." },
        { kind: "content_package", title: "Formatear contenido", type: "AI" },
        { kind: "wp_manual", title: "Insertar en la página", type: "HM", humanReason: "El plugin no tiene la capability para hacerlo." },
      ],
    },
    inputs: noInputs, // input step collects the material
    gates: ["G1", "G2"],
    acceptance: ["Sin input → no arranca", "Material real verificable"],
    signals: ["testimonio", "caso de éxito", "caso real", "reseña", "evidencia humana"],
    negativeSignals: [],
    complexity: "medium",
    risk: "high",
  },

  {
    actionType: "security_fix",
    class: "execution",
    category: "technical",
    modes: {
      NEXTJS: { mode: "HYBRID" },
      WORDPRESS: { mode: "MANUAL" },
    },
    steps: {
      NEXTJS: [
        { kind: "agent", title: "Aplicar fix de seguridad", type: "AI" },
        { kind: "review", title: "Verificar fix", type: "HM", humanReason: "Decisión editorial o de negocio: requiere criterio humano." },
      ],
      WORDPRESS: [
        { kind: "wp_manual", title: "Actualizar plugins/tema/fix", type: "HM", humanReason: "El plugin no tiene la capability para hacerlo." },
      ],
    },
    inputs: z.object({ finding: z.string().min(1) }),
    gates: ["G1", "G2"],
    acceptance: ["Hallazgo resuelto", "Sin regresiones"],
    signals: ["seguridad", "vulnerabilidad", "security", "XSS", "CORS", "headers"],
    negativeSignals: [],
    complexity: "medium",
    risk: "high",
  },

  // ── OTHER (catch-all) ─────────────────────────────────────────────────────

  {
    actionType: "other",
    class: "execution",
    category: "technical",
    modes: {
      NEXTJS: { mode: "MANUAL" },
      WORDPRESS: { mode: "MANUAL" },
    },
    steps: {
      NEXTJS: [
        { kind: "terminal", title: "Ejecutar manualmente", type: "HM", humanReason: "Tarea fuera de catálogo." },
      ],
      WORDPRESS: [
        { kind: "wp_manual", title: "Ejecutar manualmente", type: "HM", humanReason: "Tarea fuera de catálogo." },
      ],
    },
    inputs: noInputs,
    gates: ["G1", "G2"],
    acceptance: ["Tarea completada según el objetivo"],
    signals: [],
    negativeSignals: [],
    complexity: "medium",
    risk: "low",
  },
];

// ─── Lookup helpers ─────────────────────────────────────────────────────────

const _byType = new Map(CATALOG.map((e) => [e.actionType, e]));

export function getCatalogEntry(actionType: ActionType): CatalogEntry | undefined {
  return _byType.get(actionType);
}

export function getAllActionTypes(): ActionType[] {
  return [...ACTION_TYPES];
}

export function isValidActionType(value: string): value is ActionType {
  return ACTION_TYPES.includes(value as ActionType);
}
