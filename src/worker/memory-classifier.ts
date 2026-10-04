/**
 * Clasifica la "memoria" del sitio — archivos que el agente necesita
 * para entender el contexto del proyecto.
 *
 * Estado: FULL (archivo real con contenido), TEMPLATE (tiene placeholders
 * sin llenar), ABSENT (no existe).
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

const MEMORY_FILES: Record<keyof MemoryStatus, string> = {
  "site-spec": "docs/site-spec.md",
  "site-map": "docs/site-map.md",
  "site-state": "docs/site-state.md",
  "catalog-schemas": "docs/catalog-schemas.md",
};

// Placeholders típicos de plantillas sin llenar
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
  // Si tiene más de 3 marcadores de plantilla, es template
  let hits = 0;
  for (const marker of TEMPLATE_MARKERS) {
    if (upper.includes(marker.toUpperCase())) hits++;
    if (hits >= 2) return true;
  }
  // Si tiene menos de 100 caracteres de contenido real (sin headers ni whitespace)
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

export function isMemoryComplete(status: MemoryStatus): boolean {
  return Object.values(status).every((v) => v === "FULL");
}
