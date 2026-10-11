/**
 * Guard de marcadores: detecta `[COMPLETAR` en los archivos modificados.
 *
 * Si el working tree contiene marcadores de placeholder, la tarea NO puede pasar a DONE.
 * El plan NO puede pasar a revisión ni hacer merge mientras exista algún marcador.
 *
 * Retorna la lista de archivos + líneas donde aparece el marcador.
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

const PLACEHOLDER_PATTERN = "[COMPLETAR";

export interface PlaceholderHit {
  file: string;
  line: number;
  text: string;
}

/**
 * Encuentra archivos con cambios (nuevos o modificados) y busca `[COMPLETAR` en ellos.
 * Retorna los hits encontrados. Array vacío = limpio.
 */
export function scanPlaceholders(dir: string): PlaceholderHit[] {
  // Stage everything and get list of changed files vs HEAD
  let nameOutput: string;
  try {
    execSync("git add -A", { cwd: dir, timeout: 15_000 });
    nameOutput = execSync("git diff --cached --name-only HEAD", {
      cwd: dir,
      encoding: "utf-8",
      timeout: 15_000,
    });
  } catch {
    return [];
  }

  if (!nameOutput.trim()) return [];

  const changedFiles: string[] = [];
  for (const line of nameOutput.split("\n")) {
    const filePath = line.trim();
    if (!filePath) continue;
    // Skip binary-looking files
    if (/\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|pdf)$/i.test(filePath)) continue;
    changedFiles.push(filePath);
  }

  const hits: PlaceholderHit[] = [];

  for (const file of changedFiles) {
    let content: string;
    try {
      content = readFileSync(join(dir, file), "utf-8");
    } catch {
      continue; // deleted file or binary
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(PLACEHOLDER_PATTERN)) {
        hits.push({
          file,
          line: i + 1,
          text: lines[i].trim(),
        });
      }
    }
  }

  return hits;
}

/**
 * Formats placeholder hits for display.
 */
export function formatPlaceholderHits(hits: PlaceholderHit[]): string {
  if (hits.length === 0) return "";
  const lines = hits.map(
    (h) => `  ${h.file}:${h.line} → ${h.text.slice(0, 120)}`
  );
  return `Marcadores [COMPLETAR encontrados en ${hits.length} lugar(es):\n${lines.join("\n")}`;
}
