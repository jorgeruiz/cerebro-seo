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
  exec(`git push origin ${branch}`, { cwd: dir });

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

// ─── Plan-branch operations (S2e) ─────────────────────────────────────────

export interface MergeResult {
  ok: boolean;
  conflictingFiles?: string[];
}

/**
 * Clona o actualiza el repo y checkout la rama del plan.
 * Si la rama existe remotamente, la reutiliza (nunca la borra).
 * Si no existe, la crea desde el defaultBranch.
 */
export async function ensureRepoPlanBranch(
  githubRepo: string,
  defaultBranch: string,
  planBranch: string
): Promise<string> {
  const [owner, name] = githubRepo.split("/");
  if (!owner || !name) throw new Error(`githubRepo inválido: ${githubRepo}`);

  const dir = repoDir(owner, name);
  const cloneUrl = `https://github.com/${owner}/${name}.git`;

  if (!existsSync(join(dir, ".git"))) {
    exec(`git clone ${cloneUrl} "${dir}"`, { cwd: WORKSPACES });
  } else {
    exec("git fetch origin", { cwd: dir });
  }

  // Git author config
  exec(`git config user.name "${workerEnv.GIT_AUTHOR_NAME}"`, { cwd: dir, silent: true });
  exec(`git config user.email "${workerEnv.GIT_AUTHOR_EMAIL}"`, { cwd: dir, silent: true });

  // Check if plan branch exists remotely
  let branchExists = false;
  try {
    exec(`git rev-parse --verify origin/${planBranch}`, { cwd: dir, silent: true });
    branchExists = true;
  } catch {
    // Branch doesn't exist remotely
  }

  if (branchExists) {
    // Checkout and pull existing plan branch
    try {
      exec(`git checkout ${planBranch}`, { cwd: dir, silent: true });
    } catch {
      // Local branch might not exist yet
      exec(`git checkout -b ${planBranch} origin/${planBranch}`, { cwd: dir, silent: true });
    }
    exec(`git reset --hard origin/${planBranch}`, { cwd: dir });
    exec("git clean -fd", { cwd: dir });
  } else {
    // Branch doesn't exist remotely — create or reuse local
    exec(`git checkout ${defaultBranch}`, { cwd: dir, silent: true });
    exec(`git reset --hard origin/${defaultBranch}`, { cwd: dir });
    exec("git clean -fd", { cwd: dir });

    // Delete stale local branch if it exists (leftover from a previous failed run)
    try { exec(`git branch -D ${planBranch}`, { cwd: dir, silent: true }); } catch { /* ok */ }
    exec(`git checkout -b ${planBranch}`, { cwd: dir });
  }

  return dir;
}

/**
 * Merge default branch into the plan branch.
 * If conflict, aborts the merge and returns the conflicting files.
 */
export function mergeDefaultIntoPlan(
  dir: string,
  defaultBranch: string
): MergeResult {
  exec("git fetch origin", { cwd: dir });

  try {
    exec(`git merge origin/${defaultBranch} --no-edit`, { cwd: dir });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Extract conflicting files from git status
    const conflictFiles: string[] = [];
    try {
      const status = exec("git status --porcelain", { cwd: dir, silent: true });
      for (const line of status.split("\n")) {
        if (line.startsWith("UU ") || line.startsWith("AA ") || line.startsWith("DD ")) {
          conflictFiles.push(line.slice(3).trim());
        }
      }
    } catch {
      // Can't get status
    }

    // Abort the merge to leave working tree clean
    try {
      exec("git merge --abort", { cwd: dir, silent: true });
    } catch {
      // Merge abort failed — try reset
      try { exec("git reset --hard HEAD", { cwd: dir, silent: true }); } catch { /* last resort */ }
    }

    if (conflictFiles.length > 0 || msg.includes("CONFLICT") || msg.includes("Merge conflict")) {
      return { ok: false, conflictingFiles: conflictFiles.length > 0 ? conflictFiles : ["(archivos en conflicto no identificados)"] };
    }

    // Non-conflict merge failure → rethrow
    throw new Error(msg);
  }
}

/**
 * Commit with [task:<id>] prefix. Normal push (never --force).
 */
export function commitStep(
  dir: string,
  branch: string,
  taskId: string,
  stepTitle: string
): string | null {
  if (!hasDiff(dir)) return null;

  const message = `[task:${taskId.slice(0, 8)}] ${stepTitle}`;
  const authorName = workerEnv.GIT_AUTHOR_NAME;
  const authorEmail = workerEnv.GIT_AUTHOR_EMAIL;

  exec("git add -A", { cwd: dir });
  exec(`git commit -m "${message.replace(/"/g, '\\"')}" --author="${authorName} <${authorEmail}>"`, { cwd: dir });
  exec(`git push origin ${branch}`, { cwd: dir });

  return exec("git rev-parse HEAD", { cwd: dir, silent: true }).trim();
}

/**
 * Find all commits for a task on the current branch and revert them in reverse order.
 * Returns the list of revert commit SHAs, or null if revert had conflicts.
 */
export function revertTaskCommits(
  dir: string,
  taskId: string,
  branch: string
): { ok: true; revertShas: string[] } | { ok: false; error: string } {
  const tag = `[task:${taskId.slice(0, 8)}]`;

  // Find commits matching this task (newest first)
  let logOutput: string;
  try {
    logOutput = exec(`git log --oneline --fixed-strings --grep="${tag}" --format="%H"`, { cwd: dir, silent: true });
  } catch {
    return { ok: true, revertShas: [] }; // no commits found
  }

  const shas = logOutput.trim().split("\n").filter(Boolean);
  if (shas.length === 0) return { ok: true, revertShas: [] };

  const revertShas: string[] = [];

  // Revert in order (newest first, which is how git log returns them)
  for (const sha of shas) {
    try {
      exec(`git revert ${sha} --no-edit`, { cwd: dir });
      const revertSha = exec("git rev-parse HEAD", { cwd: dir, silent: true }).trim();
      revertShas.push(revertSha);
    } catch (err) {
      // Revert conflict
      try { exec("git revert --abort", { cwd: dir, silent: true }); } catch { /* */ }
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: sanitizePat(`Revert conflict on ${sha}: ${msg.slice(0, 200)}`) };
    }
  }

  // Push the reverts
  exec(`git push origin ${branch}`, { cwd: dir });

  return { ok: true, revertShas };
}

/**
 * Create or update the plan-level PR.
 * If a PR already exists for this branch, update its body.
 * If not, create a new one.
 */
export async function createOrUpdatePlanPR(params: {
  githubRepo: string;
  planBranch: string;
  defaultBranch: string;
  title: string;
  body: string;
}): Promise<{ number: number; url: string; isNew: boolean }> {
  const [owner] = params.githubRepo.split("/");

  // Check for existing open PR
  const searchRes = await fetch(
    `https://api.github.com/repos/${params.githubRepo}/pulls?` +
      `head=${encodeURIComponent(`${owner}:${params.planBranch}`)}&state=open`,
    {
      headers: {
        Authorization: `Bearer ${PAT}`,
        Accept: "application/vnd.github+json",
      },
    }
  );

  if (searchRes.ok) {
    const prs = (await searchRes.json()) as Array<{ number: number; html_url: string }>;
    if (prs.length > 0) {
      // Update existing PR body
      const pr = prs[0];
      await fetch(`https://api.github.com/repos/${params.githubRepo}/pulls/${pr.number}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${PAT}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ body: params.body }),
      });
      return { number: pr.number, url: pr.html_url, isNew: false };
    }
  }

  // Create new PR
  const createRes = await fetch(`https://api.github.com/repos/${params.githubRepo}/pulls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAT}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: params.title,
      body: params.body,
      head: params.planBranch,
      base: params.defaultBranch,
    }),
  });

  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`GitHub API error ${createRes.status}: ${sanitizePat(text.slice(0, 500))}`);
  }

  const data = (await createRes.json()) as { number: number; html_url: string };
  return { number: data.number, url: data.html_url, isNew: true };
}

/**
 * Scan plan branch diff against default for [COMPLETAR markers.
 * Used for plan-level guard before IN_REVIEW.
 */
export function scanPlanPlaceholders(
  dir: string,
  defaultBranch: string
): { file: string; line: number; text: string }[] {
  let diffOutput: string;
  try {
    diffOutput = exec(`git diff origin/${defaultBranch}...HEAD`, { cwd: dir, silent: true });
  } catch {
    return [];
  }

  const hits: { file: string; line: number; text: string }[] = [];
  let currentFile = "";

  for (const rawLine of diffOutput.split("\n")) {
    const fileMatch = rawLine.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }
    if (!rawLine.startsWith("+") || rawLine.startsWith("+++")) continue;
    if (rawLine.includes("[COMPLETAR")) {
      hits.push({ file: currentFile, line: 0, text: rawLine.slice(1).trim() });
    }
  }

  return hits;
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
