/**
 * Tipos para PlanStep.stagedChange — cambios pendientes de aplicar en WordPress.
 *
 * Un "staged change" es un cambio generado por el worker que aún no se ha aplicado
 * al sitio WordPress en producción. Se aplica cuando el usuario hace clic en
 * "Publicar Plan" (publishWpPlanAction).
 *
 * Tres tipos:
 * - "blog"      → borrador de artículo creado via POST /publish
 * - "seo"       → meta tags generados, pendientes de aplicar via POST /seo/{page_id}
 * - "elementor" → borrador de página Elementor creado via POST /elementor/duplicate + PATCH /widgets
 *
 * Guardado en PlanStep.stagedChange (campo Json en Prisma).
 * Nunca en step.notes — notes es solo texto legible para el equipo.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface WpStagedBlogChange {
  type: "blog";
  /** post_id devuelto por POST /publish */
  post_id: number;
  title: string;
  /** URL de borrador (para preview en la UI) */
  draft_url: string | null;
  focus_keyword: string | null;
  /** true si el HTML generado contiene [COMPLETAR — bloquea la publicación */
  has_placeholders: boolean;
  placeholder_count: number;
  /** primeras 3 frases con [COMPLETAR para mostrar en el error de bloqueo */
  placeholder_samples: string[];
  staged_at: string;
}

export interface WpStagedSeoChange {
  type: "seo";
  /**
   * ID de la página/post en WordPress.
   * 0 = desconocido — debe resolverse via GET /pages antes de publicar.
   */
  page_id: number;
  meta_title: string;
  meta_description: string;
  focus_keyword: string | null;
  /** Texto del objetivo — usado para resolver page_id=0 por matching de título/slug */
  objective: string;
  generated: boolean;
  staged_at: string;
}

export interface WpStagedElementorChange {
  type: "elementor";
  /** ID de la página original en WordPress. */
  page_id: number;
  page_title: string;
  /** ID del borrador Elementor creado por el worker (eliminar al aplicar). */
  draft_id: number;
  draft_title: string;
  /** Número de widgets actualizados en el borrador. */
  widgets_updated: number;
  /** URL de edición Elementor del borrador (para preview del equipo). */
  edit_url: string;
  staged_at: string;
  /** Revisión WP creada antes del apply — para revertir si es necesario. */
  revision_id?: number;
  /** Timestamp del apply exitoso. */
  applied_at?: string;
}

/**
 * Paquete de contenido generado por el worker.
 * Primer paso AI en toda tarea CONTENT de WordPress.
 * No requiere plugin WP — es generación pura con Claude + perfil del sitio.
 */
export interface WpStagedContentPackageChange {
  type: "content_package";
  kind: "blog" | "landing" | "optimization";
  keyword: string;
  page_title: string;
  h1: string;
  /** Secciones de contenido: H2 + cuerpo + H3s opcionales */
  sections: Array<{
    h2: string;
    h3s?: string[];
    text: string;
    table?: { headers: string[]; rows: string[][] };
  }>;
  meta_title: string;
  meta_description: string;
  schema_jsonld: Record<string, unknown>;
  internal_links: Array<{ anchor: string; url: string; context: string }>;
  faq: Array<{ q: string; a: string }>;
  cta: string;
  image_brief?: string;
  /**
   * Solo para kind=optimization: cambios antes→después por widget.
   * Usados en el paso HUMAN "Aplicar en Elementor".
   */
  optimization_changes?: Array<{
    page_title: string;
    page_id: number;
    widgets: Array<{
      section: string;
      widget_type: string;
      before: string;
      after: string;
    }>;
  }>;
  staged_at: string;
}

export type WpStagedChange =
  | WpStagedBlogChange
  | WpStagedSeoChange
  | WpStagedElementorChange
  | WpStagedContentPackageChange;

// ─── Type guards ──────────────────────────────────────────────────────────────

export function isBlogChange(c: WpStagedChange): c is WpStagedBlogChange {
  return c.type === "blog";
}

export function isSeoChange(c: WpStagedChange): c is WpStagedSeoChange {
  return c.type === "seo";
}

export function isElementorChange(c: WpStagedChange): c is WpStagedElementorChange {
  return c.type === "elementor";
}

export function isContentPackageChange(c: WpStagedChange): c is WpStagedContentPackageChange {
  return c.type === "content_package";
}

// ─── Parser con fallback ──────────────────────────────────────────────────────

/**
 * Parsea PlanStep.stagedChange desde el Json de Prisma.
 * Devuelve null si el campo no existe o tiene formato inválido.
 */
export function parseStagedChange(raw: unknown): WpStagedChange | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const validTypes = ["blog", "seo", "elementor", "content_package"];
  if (!validTypes.includes(obj.type as string)) return null;
  return raw as WpStagedChange;
}
