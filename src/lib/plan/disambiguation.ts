/**
 * Disambiguation Rules — resolves conflicts when signals match multiple actionTypes.
 *
 * Spec §6. Declarative rules applied after the classifier returns candidates.
 * NOT connected to the flow yet (F1b).
 */

import type { ActionType } from "./task-catalog";

export interface DisambiguationRule {
  /** Primary signal that triggers the ambiguity. */
  trigger: string;
  /** Additional context that resolves the ambiguity. */
  context: string;
  /** Resolved actionType. */
  result: ActionType;
}

export const DISAMBIGUATION_RULES: DisambiguationRule[] = [
  // "optimizar" without object
  { trigger: "optimizar", context: "meta, title, description, CTR", result: "update_meta" },
  { trigger: "optimizar", context: "texto, contenido, copy + URL de página", result: "edit_page_text" },
  { trigger: "optimizar", context: "artículo o URL de /blog/ existente", result: "refresh_content" },
  { trigger: "optimizar", context: "imágenes, peso, WebP", result: "optimize_images" },
  { trigger: "optimizar", context: "velocidad, Core Web Vitals, LCP", result: "improve_speed" },
  { trigger: "optimizar", context: "(nada más)", result: "other" },

  // "crear página / nueva página"
  { trigger: "crear página", context: "servicio, ciudad o producto", result: "create_landing" },
  { trigger: "nueva página", context: "servicio, ciudad o producto", result: "create_landing" },
  { trigger: "crear página", context: "(sin servicio ni ubicación)", result: "other" },
  { trigger: "nueva página", context: "(sin servicio ni ubicación)", result: "other" },

  // "yoast / rank math"
  { trigger: "yoast", context: "schema", result: "schema" },
  { trigger: "rank math", context: "schema", result: "schema" },
  { trigger: "yoast", context: "title, description, keyword", result: "update_meta" },
  { trigger: "rank math", context: "title, description, keyword", result: "update_meta" },

  // "404"
  { trigger: "404", context: "redirigir, URL antigua, backlinks a URL muerta", result: "fix_redirect" },
  { trigger: "404", context: "enlace roto dentro del sitio", result: "fix_broken_links" },

  // "rastreo, crawl"
  { trigger: "rastreo", context: "robots", result: "configure_robots" },
  { trigger: "crawl", context: "robots", result: "configure_robots" },
  { trigger: "rastreo", context: "sitemap", result: "configure_sitemap" },
  { trigger: "crawl", context: "sitemap", result: "configure_sitemap" },

  // "tracking"
  { trigger: "tracking", context: "GA4, GTM, conversiones", result: "verify_analytics" },
  { trigger: "tracking", context: "posiciones, keywords", result: "keyword_research" },

  // "indexar"
  { trigger: "indexar", context: "(sin 'no')", result: "verify_indexation" },
  { trigger: "noindex", context: "—", result: "configure_robots" },
  { trigger: "desindexar", context: "—", result: "configure_robots" },

  // "enlaces"
  { trigger: "enlaces", context: "internos, interlinking", result: "internal_links" },
  { trigger: "enlaces", context: "backlinks, externos", result: "link_building" },

  // "duplicado, canibalización"
  { trigger: "duplicado", context: "sin decisión tomada", result: "audit_duplicate" },
  { trigger: "canibalización", context: "sin decisión", result: "audit_duplicate" },
  { trigger: "duplicado", context: "fusionar, consolidar + URLs", result: "merge_content" },
  { trigger: "canibalización", context: "fusionar + URLs", result: "merge_content" },

  // "imagen"
  { trigger: "imagen", context: "nuevo blog", result: "create_blog" }, // sub-paso, not standalone
  { trigger: "imagen", context: "alt", result: "optimize_alt_text" },
  { trigger: "imagen", context: "foto real, del cliente", result: "add_human_evidence" },

  // "crear contenido" / "guía" / "artículo pilar" / "página pilar" — intent decides
  { trigger: "crear contenido", context: "informacional, qué es, cómo, guía, tipos", result: "create_blog" },
  { trigger: "crear contenido", context: "venta, cotización, precio, servicio, ciudad", result: "create_landing" },
  { trigger: "guía", context: "informacional, qué es, cómo, tipos, normas", result: "create_blog" },
  { trigger: "guía", context: "precio, cotización, venta, servicio", result: "create_landing" },
  { trigger: "artículo pilar", context: "—", result: "create_blog" },
  { trigger: "página pilar", context: "informacional, guía, tipos", result: "create_blog" },
  { trigger: "página pilar", context: "servicio, producto, venta", result: "create_landing" },
  { trigger: "qué es", context: "—", result: "create_blog" },
  { trigger: "cómo", context: "informacional, guía, tutorial", result: "create_blog" },

  // Specific topics
  { trigger: "testimonios", context: "—", result: "add_human_evidence" },
  { trigger: "casos de éxito", context: "—", result: "add_human_evidence" },
  { trigger: "FAQ", context: "—", result: "add_faq" },
  { trigger: "preguntas frecuentes", context: "—", result: "add_faq" },
  { trigger: "llms.txt", context: "—", result: "aeo_readiness" },
  { trigger: "AEO", context: "legibilidad o rastreo de bots IA", result: "aeo_readiness" },
];
