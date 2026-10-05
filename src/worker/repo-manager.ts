/**
 * Gestión de repos de clientes en el workspace del worker.
 *
 * - Clona si no existe
 * - Fetch + reset si ya existe
 * - Crea ramas para tareas
 * - Commit, push y PR vía GitHub API
 *
 * El PAT nunca aparece en logs, .git/config ni URLs guardadas.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { workerEnv } from "./env";

const PAT = workerEnv.GITHUB_PAT_CLIENT_REPOS;
const WORKSPACES = workerEnv.WORKSPACES_DIR;

/** Sanitiza strings para que el PAT nunca aparezca en logs */
export function sanitizePat(text: string): string {
  return text.replaceAll(PAT, "***PAT***");
}

function exec(cmd: string, opts: { cwd: string; silent?: boolean }): string {
  try {
    const result = execSync(cmd, {
      cwd: opts.cwd,
      encoding: "utf-8",
      timeout: 120_000,
      env: {
        ...process.env,
        // PAT via extraheader — nunca se guarda en .git/config
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.extraheader",
        GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${PAT}`).toString("base64")}`,
      },
    });
    return opts.silent ? result : sanitizePat(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(sanitizePat(msg));
  }
}

export function repoDir(owner: string, name: string): string {
  return join(WORKSPACES, `${owner}__${name}`);
}

export function branchName(taskId: string): string {
  return `cr/${taskId.slice(0, 8)}`;
}

/**
 * Clona o actualiza el repo. Retorna la ruta al workspace.
 */
export async function ensureRepo(
  githubRepo: string,
  defaultBranch: string
): Promise<string> {
  const [owner, name] = githubRepo.split("/");
  if (!owner || !name) throw new Error(`githubRepo inválido: ${githubRepo}`);

  const dir = repoDir(owner, name);
  const cloneUrl = `https://github.com/${owner}/${name}.git`;

  if (!existsSync(join(dir, ".git"))) {
    // Clone fresco — PAT en extraheader, no en URL
    exec(`git clone ${cloneUrl} "${dir}"`, { cwd: WORKSPACES });
  } else {
    // Fetch + reset al branch default
    exec(`git fetch origin`, { cwd: dir });
    exec(`git checkout ${defaultBranch}`, { cwd: dir });
    exec(`git reset --hard origin/${defaultBranch}`, { cwd: dir });
    exec(`git clean -fd`, { cwd: dir });
  }

  // Configurar autor para que Vercel no bloquee los deploys
  exec(`git config user.name "${workerEnv.GIT_AUTHOR_NAME}"`, { cwd: dir, silent: true });
  exec(`git config user.email "${workerEnv.GIT_AUTHOR_EMAIL}"`, { cwd: dir, silent: true });

  return dir;
}

/**
 * Crea y cambia a la rama de la tarea.
 */
export function checkoutBranch(dir: string, branch: string): void {
  // Borra la rama local si ya existe (re-run de la misma tarea)
  try {
    exec(`git branch -D ${branch}`, { cwd: dir, silent: true });
  } catch {
    // ok si no existía
  }
  exec(`git checkout -b ${branch}`, { cwd: dir });
}

/**
 * Hash del lockfile se guarda fuera del repo del cliente
 * en WORKSPACES_DIR/.meta/<owner>__<repo>.hash para no contaminar el workspace.
 */
function metaHashPath(dir: string): string {
  const repoName = dir.split("/").pop() ?? "unknown";
  const metaDir = join(WORKSPACES, ".meta");
  if (!existsSync(metaDir)) {
    execSync(`mkdir -p "${metaDir}"`);
  }
  return join(metaDir, `${repoName}.hash`);
}

/**
 * Verifica si npm ci es necesario (lockfile cambió).
 */
export function needsInstall(dir: string): boolean {
  const lockPath = join(dir, "package-lock.json");
  if (!existsSync(lockPath)) return false;

  const lockContent = readFileSync(lockPath, "utf-8");
  const currentHash = createHash("sha256").update(lockContent).digest("hex");
  const hashPath = metaHashPath(dir);

  if (existsSync(hashPath)) {
    const savedHash = readFileSync(hashPath, "utf-8").trim();
    if (savedHash === currentHash) return false;
  }

  return true;
}

export function saveInstallHash(dir: string): void {
  const lockPath = join(dir, "package-lock.json");
  if (!existsSync(lockPath)) return;
  const lockContent = readFileSync(lockPath, "utf-8");
  const hash = createHash("sha256").update(lockContent).digest("hex");
  writeFileSync(metaHashPath(dir), hash);
}

/**
 * Instala dependencias con npm ci --include=dev.
 * --include=dev es necesario porque NODE_ENV=production omite devDeps
 * y los repos de clientes necesitan tailwindcss, postcss, etc. para el build.
 *
 * Si npm ci falla por lockfile desincronizado, la tarea falla con
 * LOCKFILE_OUT_OF_SYNC — no se "arregla" en silencio.
 */
export function runInstall(dir: string): void {
  try {
    exec("npm ci --include=dev", { cwd: dir });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("npm ci") && (msg.includes("in sync") || msg.includes("Missing:"))) {
      throw new Error("LOCKFILE_OUT_OF_SYNC");
    }
    throw err;
  }
  saveInstallHash(dir);
}

/**
 * Verifica el build del proyecto.
 * Retorna { passed: true } o { passed: false, logTail: string }.
 */
export function verifyBuild(dir: string): { passed: boolean; logTail?: string } {
  try {
    exec("NODE_OPTIONS=--max-old-space-size=2048 npm run build", { cwd: dir });
    return { passed: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lines = msg.split("\n");
    const tail = lines.slice(-100).join("\n");
    return { passed: false, logTail: tail };
  }
}

/**
 * Retorna true si hay cambios (staged o unstaged).
 */
export function hasDiff(dir: string): boolean {
  const status = exec("git status --porcelain", { cwd: dir, silent: true });
  return status.trim().length > 0;
}

/**
 * Commit + push de la rama.
 */
export function commitAndPush(
  dir: string,
  branch: string,
  message: string
): string {
  const authorName = workerEnv.GIT_AUTHOR_NAME;
  const authorEmail = workerEnv.GIT_AUTHOR_EMAIL;

  exec("git add -A", { cwd: dir });
  exec(`git commit -m "${message.replace(/"/g, '\\"')}" --author="${authorName} <${authorEmail}>"`, { cwd: dir });
  exec(`git push origin ${branch} --force`, { cwd: dir });

  const sha = exec("git rev-parse HEAD", { cwd: dir, silent: true }).trim();
  return sha;
}

/**
 * Crea un Pull Request vía GitHub API.
 */
export async function createPullRequest(params: {
  githubRepo: string;
  branch: string;
  defaultBranch: string;
  title: string;
  body: string;
}): Promise<{ number: number; url: string }> {
  const res = await fetch(`https://api.github.com/repos/${params.githubRepo}/pulls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAT}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: params.title,
      body: params.body,
      head: params.branch,
      base: params.defaultBranch,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${sanitizePat(text.slice(0, 500))}`);
  }

  const data = (await res.json()) as { number: number; html_url: string };
  return { number: data.number, url: data.html_url };
}

/**
 * Intenta obtener la preview URL de los deployment statuses de Vercel.
 */
export async function getPreviewUrl(
  githubRepo: string,
  sha: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${githubRepo}/commits/${sha}/statuses`,
      {
        headers: {
          Authorization: `Bearer ${PAT}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (!res.ok) return null;

    const statuses = (await res.json()) as Array<{
      target_url?: string;
      context?: string;
      state?: string;
    }>;

    const vercel = statuses.find(
      (s) => s.context?.includes("vercel") && s.target_url
    );
    return vercel?.target_url ?? null;
  } catch {
    return null;
  }
}
