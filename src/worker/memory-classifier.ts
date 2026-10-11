/**
 * Clasifica la "memoria" del sitio — archivos que el agente necesita
 * para entender el contexto del proyecto.
 *
 * Estado: FULL (archivo real con contenido), TEMPLATE (tiene placeholders
 * sin llenar), ABSENT (no existe).
 *
 * Gate por tipo de tarea (spec §4 regla 5):
 * - CODE/SETUP en AI/HYBRID: requiere site-spec, site-map, site-state FULL.
 * - CONTENT (blog/landing/micrositio) en AI/HYBRID: además requiere
 *   catalog-schemas con la sección correspondiente.
 */

import { readFile } from "fs/promises";
import { join } from "path";

export type MemoryFileStatus = "FULL" | "TEMPLATE" | "ABSENT";

export interface MemoryStatus {
  "site-spec": MemoryFileStatus;
  "site-map": MemoryFileStatus;
  "site-state": MemoryFileStatus;
  "catalog-schemas": MemoryFileStatus;
}

/** Sections detected in catalog-schemas.md */
export interface CatalogSections {
  blog: boolean;
  landing: boolean;
  micrositios: boolean;
}

const MEMORY_FILES: Record<keyof MemoryStatus, string> = {
  "site-spec": "docs/site-spec.md",
  "site-map": "docs/site-map.md",
  "site-state": "docs/site-state.md",
  "catalog-schemas": "docs/catalog-schemas.md",
};

const TEMPLATE_MARKERS = [
  "[NOMBRE DEL PROYECTO]",
  "[DESCRIPCIÓN]",
  "[TODO]",
  "{{",
  "PLACEHOLDER",
  "[INSERTAR",
  "Lorem ipsum",
  "ejemplo.com",
  "tu-dominio",
];

export function isTemplatePlaceholder(content: string): boolean {
  const upper = content.toUpperCase();
  let hits = 0;
  for (const marker of TEMPLATE_MARKERS) {
    if (upper.includes(marker.toUpperCase())) hits++;
    if (hits >= 2) return true;
  }
  const stripped = content.replace(/^#+\s.*$/gm, "").replace(/\s+/g, " ").trim();
  if (stripped.length < 100 && hits > 0) return true;
  return false;
}

export async function classifyMemory(repoDir: string): Promise<MemoryStatus> {
  const status: MemoryStatus = {
    "site-spec": "ABSENT",
    "site-map": "ABSENT",
    "site-state": "ABSENT",
    "catalog-schemas": "ABSENT",
  };

  for (const [key, relPath] of Object.entries(MEMORY_FILES)) {
    try {
      const content = await readFile(join(repoDir, relPath), "utf-8");
      if (!content.trim()) {
        status[key as keyof MemoryStatus] = "ABSENT";
      } else if (isTemplatePlaceholder(content)) {
        status[key as keyof MemoryStatus] = "TEMPLATE";
      } else {
        status[key as keyof MemoryStatus] = "FULL";
      }
    } catch {
      status[key as keyof MemoryStatus] = "ABSENT";
    }
  }

  return status;
}

/**
 * Detects which content sections exist in catalog-schemas.md.
 */
export async function detectCatalogSections(repoDir: string): Promise<CatalogSections> {
  const result: CatalogSections = { blog: false, landing: false, micrositios: false };

  try {
    const content = await readFile(join(repoDir, MEMORY_FILES["catalog-schemas"]), "utf-8");
    const headings = content.match(/^##\s+.+$/gm) ?? [];

    for (const heading of headings) {
      const lower = heading.toLowerCase();
      if (lower.includes("blog")) result.blog = true;
      if (lower.includes("landing")) result.landing = true;
      if (lower.includes("micrositio")) result.micrositios = true;
    }
  } catch {
    // File doesn't exist
  }

  return result;
}

// ─── Eligibility by task type ─────────────────────────────────────────────

export type ContentCategory = "blog" | "landing" | "micrositio" | null;

/**
 * Returns which content category a task targets based on its category field.
 */
export function contentCategoryForTask(taskCategory: string): ContentCategory {
  const lower = taskCategory.toLowerCase();
  if (lower === "blog" || lower.includes("articulo") || lower.includes("artículo")) return "blog";
  if (lower === "landing" || lower.includes("landing")) return "landing";
  if (lower === "micrositio" || lower.includes("micrositio")) return "micrositio";
  return null; // CODE, SETUP, tecnico, etc. — not content
}

/** All memory checks pass (legacy — use the specific ones below). */
export function isMemoryComplete(status: MemoryStatus): boolean {
  return Object.values(status).every((v) => v === "FULL");
}

export interface MemoryGateResult {
  ready: boolean;
  missing: string[]; // human-readable list of what's missing
}

/**
 * Gate for CODE and SETUP tasks in AI/HYBRID mode.
 * Requires: site-spec, site-map, site-state FULL.
 * Does NOT require catalog-schemas.
 */
export function isMemoryReadyForCode(status: MemoryStatus): MemoryGateResult {
  const required: (keyof MemoryStatus)[] = ["site-spec", "site-map", "site-state"];
  const missing: string[] = [];

  for (const key of required) {
    if (status[key] !== "FULL") {
      missing.push(`${key} (${status[key]})`);
    }
  }

  return { ready: missing.length === 0, missing };
}

/**
 * Gate for CONTENT tasks in AI/HYBRID mode.
 * Requires: site-spec, site-map, site-state FULL + catalog-schemas
 * with the corresponding section for the content category.
 */
export function isMemoryReadyForContent(
  status: MemoryStatus,
  catalogSections: CatalogSections,
  category: ContentCategory
): MemoryGateResult {
  // Start with the CODE requirements
  const result = isMemoryReadyForCode(status);

  // Also require catalog-schemas to be FULL
  if (status["catalog-schemas"] !== "FULL") {
    result.missing.push(`catalog-schemas (${status["catalog-schemas"]})`);
    result.ready = false;
    return result;
  }

  // Check the specific section exists
  if (category === "blog" && !catalogSections.blog) {
    result.missing.push("catalog-schemas: falta sección ## Blog");
    result.ready = false;
  } else if (category === "landing" && !catalogSections.landing) {
    result.missing.push("catalog-schemas: falta sección ## Landing Pages");
    result.ready = false;
  } else if (category === "micrositio" && !catalogSections.micrositios) {
    result.missing.push("catalog-schemas: falta sección ## Micrositios");
    result.ready = false;
  }

  return result;
}
