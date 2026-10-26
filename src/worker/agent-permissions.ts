/**
 * Lista blanca de permisos para el agente.
 *
 * canUseTool: callback con firma del Agent SDK:
 *   (toolName: string, input: Record<string, unknown>, options: { signal }) => PermissionResult
 *
 * Solo permite operaciones dentro del repo y un subset de comandos Bash.
 */

import { normalize, resolve, relative } from "path";

/** Comandos Bash permitidos (prefijos — pueden tener args después) */
const ALLOWED_BASH_PREFIXES = [
  // Build & lint
  "npm run build",
  "npm run lint",
  // Git (read-only)
  "git status",
  "git diff",
  "git log",
  // File inspection
  "cat ",
  "ls ",
  "ls",
  "find ",
  "head ",
  "tail ",
  "wc ",
  // Image optimization
  "npx sharp",
  "npx svgo",
  // Node scripts in the repo
  "npx tsx ",
  "node ",
];

/** Patrones prohibidos en rutas */
const FORBIDDEN_PATH_PATTERNS = [".env", ".env.local", ".env.production"];

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
  return !rel.startsWith("..");
}

/**
 * Verifica si una ruta toca archivos .env*
 */
function isEnvFile(filePath: string): boolean {
  const name = filePath.split("/").pop() ?? "";
  return FORBIDDEN_PATH_PATTERNS.some((p) => name.startsWith(p.split("/").pop()!));
}

/** Paths allowed for content-only tasks (blog articles) */
const CONTENT_ALLOWED_PREFIXES = ["content/blog/", "public/blog/"];

function isContentAllowedPath(filePath: string, repoCwd: string): boolean {
  const resolved = resolve(repoCwd, filePath);
  const rel = relative(repoCwd, normalize(resolved));
  return CONTENT_ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

/**
 * Crea el callback canUseTool con la firma real del Agent SDK:
 *   (toolName: string, input: Record<string, unknown>, options: { signal }) => Promise<PermissionResult>
 *
 * @param contentOnly - If true, restricts writes to content/blog/** and public/blog/** only.
 */
export function createCanUseTool(repoCwd: string, contentOnly = false) {
  return async (
    toolName: string,
    toolInput: Record<string, unknown>,
    _options: { signal: AbortSignal }
  ): Promise<CanUseToolResult> => {

    // ── File tools: Read, Edit, Write ──────────────────────────────────
    if (["Read", "FileRead"].includes(toolName)) {
      const filePath = String(toolInput.file_path ?? toolInput.path ?? "");
      if (!filePath) return deny("Ruta de archivo vacía.");
      if (isEnvFile(filePath)) return deny(`Prohibido leer archivos .env: ${filePath}`);
      if (!isInsideRepo(filePath, repoCwd)) return deny(`Fuera del repo: ${filePath}`);
      return allow();
    }

    if (["Edit", "FileEdit"].includes(toolName)) {
      const editPath = String(toolInput.file_path ?? "");
      if (!editPath) return deny("Ruta de archivo vacía.");
      if (isEnvFile(editPath)) return deny(`Prohibido editar archivos .env: ${editPath}`);
      if (!isInsideRepo(editPath, repoCwd)) return deny(`Fuera del repo: ${editPath}`);
      if (contentOnly && !isContentAllowedPath(editPath, repoCwd)) {
        return deny(`Tarea de contenido: solo puede editar content/blog/** o public/blog/**. Ruta: ${editPath}`);
      }
      return allow();
    }

    if (["Write", "FileWrite"].includes(toolName)) {
      const filePath = String(toolInput.file_path ?? "");
      if (!filePath) return deny("Ruta de archivo vacía.");
      if (isEnvFile(filePath)) return deny(`Prohibido escribir archivos .env: ${filePath}`);
      if (!isInsideRepo(filePath, repoCwd)) return deny(`Fuera del repo: ${filePath}`);
      if (contentOnly && !isContentAllowedPath(filePath, repoCwd)) {
        return deny(`Tarea de contenido: solo puede escribir en content/blog/** o public/blog/**. Ruta: ${filePath}`);
      }
      return allow();
    }

    if (toolName === "Glob") {
      const path = String(toolInput.path ?? "");
      if (path && !isInsideRepo(path, repoCwd)) return deny(`Fuera del repo: ${path}`);
      return allow();
    }

    if (toolName === "Grep") {
      const path = String(toolInput.path ?? "");
      if (path && !isInsideRepo(path, repoCwd)) return deny(`Fuera del repo: ${path}`);
      return allow();
    }

    // ── Bash: solo comandos en lista blanca ────────────────────────────
    if (toolName === "Bash") {
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
    return deny(`Herramienta no permitida: ${toolName}`);
  };
}

function allow(): CanUseToolResult {
  return { behavior: "allow" };
}

function deny(message: string): CanUseToolResult {
  return { behavior: "deny", message };
}
