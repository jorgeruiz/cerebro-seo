/**
 * Task Templates — deterministic step catalog by actionType × platform.
 *
 * Replaces enforceModeRules for mode assignment: Claude only classifies actionType;
 * the template defines the steps (type, humanReason, action) and resolveTaskMode
 * derives the task mode from the generated steps.
 *
 * Templates define the STRUCTURE. The decomposer LLM fills prompts and criteria
 * for each step but cannot add, remove, or change the type of steps.
 *
 * For WordPress, /capabilities determines whether each AI step is actually
 * executable or must degrade to HUMAN wp_manual.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type ActionType =
  | "create_blog"
  | "update_meta"
  | "keyword_research"
  | "schema"
  | "internal_links"
  | "edit_page_text"
  | "create_landing"
  | "upload_media"
  | "generate_image"
  | "other";

export type Platform = "NEXTJS" | "WORDPRESS";

export type HumanReason = "terminal" | "config" | "external_tool" | "wp_manual";

export interface TemplateStep {
  title: string;
  type: "AI" | "HUMAN";
  humanReason: HumanReason | null;
  /** JSON action key for AI steps (e.g. "keyword_research", "content_package") */
  action: string | null;
  /** Required WP capability for this step (null = always executable) */
  requiredCapability: string | null;
}

export interface TaskTemplate {
  actionType: ActionType;
  platform: Platform;
  steps: TemplateStep[];
}

// ─── Template Catalog ───────────────────────────────────────────────────────

const TEMPLATES: TaskTemplate[] = [
  // ── create_blog ─────────────────────────────────────────────────────────
  {
    actionType: "create_blog",
    platform: "NEXTJS",
    steps: [
      { title: "Generar artículo de blog", type: "AI", humanReason: null, action: "nextjs_blog_generate", requiredCapability: null },
      { title: "Generar imagen de portada", type: "AI", humanReason: null, action: "image", requiredCapability: null },
      { title: "Revisar y publicar artículo", type: "HUMAN", humanReason: "config", action: null, requiredCapability: null },
    ],
  },
  {
    actionType: "create_blog",
    platform: "WORDPRESS",
    steps: [
      { title: "Paquete de contenido", type: "AI", humanReason: null, action: "content_package", requiredCapability: null },
      { title: "Crear borrador en WordPress", type: "AI", humanReason: null, action: "publish", requiredCapability: "publish" },
      { title: "Imagen de portada", type: "AI", humanReason: null, action: "image", requiredCapability: "media" },
      { title: "Revisar y publicar borrador", type: "HUMAN", humanReason: "wp_manual", action: null, requiredCapability: null },
    ],
  },

  // ── update_meta ─────────────────────────────────────────────────────────
  {
    actionType: "update_meta",
    platform: "NEXTJS",
    steps: [
      { title: "Optimizar meta tags", type: "AI", humanReason: null, action: "agent", requiredCapability: null },
    ],
  },
  {
    actionType: "update_meta",
    platform: "WORDPRESS",
    steps: [
      { title: "Generar meta tags", type: "AI", humanReason: null, action: "seo", requiredCapability: "seo_write" },
    ],
  },

  // ── keyword_research ────────────────────────────────────────────────────
  {
    actionType: "keyword_research",
    platform: "NEXTJS",
    steps: [
      { title: "Investigar y seleccionar keywords", type: "AI", humanReason: null, action: "keyword_research", requiredCapability: null },
      { title: "Aprobar tabla de keywords", type: "HUMAN", humanReason: "config", action: null, requiredCapability: null },
      { title: "Aplicar keywords aprobadas", type: "AI", humanReason: null, action: "apply_keywords", requiredCapability: null },
    ],
  },
  {
    actionType: "keyword_research",
    platform: "WORDPRESS",
    steps: [
      { title: "Investigar y seleccionar keywords", type: "AI", humanReason: null, action: "keyword_research", requiredCapability: null },
      { title: "Aprobar tabla de keywords", type: "HUMAN", humanReason: "config", action: null, requiredCapability: null },
      { title: "Aplicar keywords aprobadas", type: "AI", humanReason: null, action: "apply_keywords", requiredCapability: null },
    ],
  },

  // ── schema ──────────────────────────────────────────────────────────────
  {
    actionType: "schema",
    platform: "NEXTJS",
    steps: [
      { title: "Implementar/optimizar schema markup", type: "AI", humanReason: null, action: "agent", requiredCapability: null },
    ],
  },
  {
    actionType: "schema",
    platform: "WORDPRESS",
    steps: [
      { title: "Configurar schema en Yoast/Rank Math", type: "HUMAN", humanReason: "wp_manual", action: null, requiredCapability: null },
    ],
  },

  // ── internal_links ──────────────────────────────────────────────────────
  {
    actionType: "internal_links",
    platform: "NEXTJS",
    steps: [
      { title: "Agregar/optimizar enlaces internos", type: "AI", humanReason: null, action: "agent", requiredCapability: null },
    ],
  },
  {
    actionType: "internal_links",
    platform: "WORDPRESS",
    steps: [
      { title: "Agregar enlaces internos en páginas", type: "HUMAN", humanReason: "wp_manual", action: null, requiredCapability: null },
    ],
  },

  // ── edit_page_text ──────────────────────────────────────────────────────
  {
    actionType: "edit_page_text",
    platform: "NEXTJS",
    steps: [
      { title: "Editar contenido de la página", type: "AI", humanReason: null, action: "agent", requiredCapability: null },
    ],
  },
  {
    actionType: "edit_page_text",
    platform: "WORDPRESS",
    steps: [
      { title: "Paquete de cambios", type: "AI", humanReason: null, action: "content_package", requiredCapability: null },
      { title: "Aplicar cambios en Elementor", type: "HUMAN", humanReason: "wp_manual", action: null, requiredCapability: null },
    ],
  },

  // ── create_landing ──────────────────────────────────────────────────────
  {
    actionType: "create_landing",
    platform: "NEXTJS",
    steps: [
      { title: "Crear landing page", type: "AI", humanReason: null, action: "agent", requiredCapability: null },
    ],
  },
  {
    actionType: "create_landing",
    platform: "WORDPRESS",
    steps: [
      { title: "Paquete de contenido para landing", type: "AI", humanReason: null, action: "content_package", requiredCapability: null },
      { title: "Crear landing en Elementor", type: "HUMAN", humanReason: "wp_manual", action: null, requiredCapability: null },
      { title: "Revisar y publicar", type: "HUMAN", humanReason: "wp_manual", action: null, requiredCapability: null },
    ],
  },

  // ── upload_media ────────────────────────────────────────────────────────
  {
    actionType: "upload_media",
    platform: "NEXTJS",
    steps: [
      { title: "Optimizar y agregar imagen", type: "AI", humanReason: null, action: "image", requiredCapability: null },
    ],
  },
  {
    actionType: "upload_media",
    platform: "WORDPRESS",
    steps: [
      { title: "Subir imagen a WordPress", type: "AI", humanReason: null, action: "image", requiredCapability: "media" },
    ],
  },

  // ── generate_image ──────────────────────────────────────────────────────
  {
    actionType: "generate_image",
    platform: "NEXTJS",
    steps: [
      { title: "Generar imagen AI", type: "AI", humanReason: null, action: "image", requiredCapability: null },
    ],
  },
  {
    actionType: "generate_image",
    platform: "WORDPRESS",
    steps: [
      { title: "Generar imagen AI", type: "AI", humanReason: null, action: "image", requiredCapability: "media" },
    ],
  },
];

// ─── Lookup ─────────────────────────────────────────────────────────────────

/**
 * Find a template for the given actionType and platform.
 * Returns null if no template exists (free-form decomposition).
 */
export function getTemplate(actionType: ActionType, platform: Platform): TaskTemplate | null {
  return TEMPLATES.find((t) => t.actionType === actionType && t.platform === platform) ?? null;
}

/**
 * Apply WP capabilities to a template: degrade AI steps to HUMAN wp_manual
 * if the required capability is missing.
 */
export function applyCapabilities(
  template: TaskTemplate,
  capabilities: string[] | null,
): TemplateStep[] {
  if (!capabilities || template.platform !== "WORDPRESS") return template.steps;

  return template.steps.map((step) => {
    if (step.type !== "AI" || !step.requiredCapability) return step;

    const hasCap = capabilities.some(
      (c) => c === step.requiredCapability || c.startsWith(`${step.requiredCapability}/`)
        // Compat: "seo" is equivalent to "seo_write" for plugins < 1.6.0
        || (step.requiredCapability === "seo_write" && (c === "seo" || c.startsWith("seo/")))
    );

    if (hasCap) return step;

    // Degrade to HUMAN
    return {
      ...step,
      type: "HUMAN" as const,
      humanReason: "wp_manual" as const,
    };
  });
}

// ─── Mode Resolution ────────────────────────────────────────────────────────

/**
 * Derives task mode from its steps. Single source of truth.
 *
 * - All AI → AI
 * - Mix of AI + HUMAN → HYBRID
 * - All HUMAN → HUMAN
 */
export function resolveTaskMode(steps: Array<{ type: "AI" | "HUMAN" }>): "AI" | "HYBRID" | "HUMAN" {
  if (steps.length === 0) return "HUMAN";
  const hasAI = steps.some((s) => s.type === "AI");
  const hasHuman = steps.some((s) => s.type === "HUMAN");
  if (hasAI && hasHuman) return "HYBRID";
  if (hasAI) return "AI";
  return "HUMAN";
}

/**
 * Build a modeReason string from steps.
 */
export function buildModeReason(steps: Array<{ type: "AI" | "HUMAN"; humanReason?: string | null }>): string {
  const aiCount = steps.filter((s) => s.type === "AI").length;
  const humanCount = steps.filter((s) => s.type === "HUMAN").length;
  const reasons = steps
    .filter((s) => s.humanReason)
    .map((s) => s.humanReason)
    .filter((v, i, a) => a.indexOf(v) === i);

  if (humanCount === 0) return `${aiCount} pasos AI`;
  if (aiCount === 0) return `${humanCount} pasos manuales (${reasons.join(", ")})`;
  return `${aiCount} AI + ${humanCount} manual (${reasons.join(", ")})`;
}

// ─── Version ────────────────────────────────────────────────────────────────

/** Bump when templates or decomposer rules change significantly. */
export const DECOMPOSER_VERSION = "2026-10-28-v1";
export const ANALYSIS_VERSION = "2026-10-28-v1";
