/**
 * Lista blanca de permisos para el agente.
 *
 * canUseTool: callback que decide si una invocación de herramienta es permitida.
 * Solo permite operaciones dentro del repo y un subset de comandos Bash.
 */

import { normalize, resolve, relative } from "path";

/** Comandos Bash permitidos exactos (con o sin args de ruta) */
const ALLOWED_BASH_PREFIXES = [
  "npm run build",
  "npm run lint",
  "git status",
  "git diff",
];

/** Patrones prohibidos en rutas */
const FORBIDDEN_PATH_PATTERNS = [".env", ".env.local", ".env.production"];

export interface ToolUseInput {
  tool_name: string;
  input: Record<string, unknown>;
}

export interface CanUseToolResult {
  behavior: "allow" | "deny";
  message?: string;
}

/**
 * Verifica si una ruta está dentro del directorio del repo.
 */
function isInsideRepo(filePath: string, repoCwd: string): boolean {
  const resolved = resolve(repoCwd, filePath);
  const normalized = normalize(resolved);
  const rel = relative(repoCwd, normalized);
  // Fuera del repo si la ruta relativa sube con ..
  return !rel.startsWith("..");
}

/**
 * Verifica si una ruta toca archivos .env*
 */
function isEnvFile(filePath: string): boolean {
  const name = filePath.split("/").pop() ?? "";
  return FORBIDDEN_PATH_PATTERNS.some((p) => name.startsWith(p.split("/").pop()!));
}

/**
 * Crea el callback canUseTool para una sesión del agente.
 */
export function createCanUseTool(repoCwd: string) {
  return async (input: ToolUseInput): Promise<CanUseToolResult> => {
    const { tool_name } = input;
    const toolInput = input.input;

    // ── File tools: Read, Edit, Write, Glob, Grep ──────────────────────
    if (["Read", "FileRead"].includes(tool_name)) {
      const filePath = String(toolInput.file_path ?? toolInput.path ?? "");
      if (!filePath) return deny("Ruta de archivo vacía.");
      if (isEnvFile(filePath)) return deny(`Prohibido leer archivos .env: ${filePath}`);
      if (!isInsideRepo(filePath, repoCwd)) return deny(`Fuera del repo: ${filePath}`);
      return allow();
    }

    if (["Edit", "FileEdit"].includes(tool_name)) {
      const filePath = String(toolInput.file_path ?? "");
      if (!filePath) return deny("Ruta de archivo vacía.");
      if (isEnvFile(filePath)) return deny(`Prohibido editar archivos .env: ${filePath}`);
      if (!isInsideRepo(filePath, repoCwd)) return deny(`Fuera del repo: ${filePath}`);
      return allow();
    }

    if (["Write", "FileWrite"].includes(tool_name)) {
      const filePath = String(toolInput.file_path ?? "");
      if (!filePath) return deny("Ruta de archivo vacía.");
      if (isEnvFile(filePath)) return deny(`Prohibido escribir archivos .env: ${filePath}`);
      if (!isInsideRepo(filePath, repoCwd)) return deny(`Fuera del repo: ${filePath}`);
      return allow();
    }

    if (tool_name === "Glob") {
      return allow();
    }

    if (tool_name === "Grep") {
      const path = String(toolInput.path ?? "");
      if (path && !isInsideRepo(path, repoCwd)) return deny(`Fuera del repo: ${path}`);
      return allow();
    }

    // ── Bash: solo comandos en lista blanca ────────────────────────────
    if (tool_name === "Bash") {
      const command = String(toolInput.command ?? "").trim();
      if (!command) return deny("Comando vacío.");

      const isAllowed = ALLOWED_BASH_PREFIXES.some((prefix) =>
        command === prefix || command.startsWith(prefix + " ")
      );

      if (!isAllowed) {
        return deny(
          `Comando no permitido: "${command}". Solo se permiten: ${ALLOWED_BASH_PREFIXES.join(", ")}`
        );
      }
      return allow();
    }

    // ── Todo lo demás: deny ────────────────────────────────────────────
    return deny(`Herramienta no permitida: ${tool_name}`);
  };
}

function allow(): CanUseToolResult {
  return { behavior: "allow" };
}

function deny(message: string): CanUseToolResult {
  return { behavior: "deny", message };
}
