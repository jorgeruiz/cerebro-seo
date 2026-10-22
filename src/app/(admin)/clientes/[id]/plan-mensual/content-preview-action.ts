"use server";

import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export interface ContentPreviewData {
  title: string;
  description: string;
  coverImage: string | null;
  hasBorrador: boolean;
  internalLinks: string[];
  bodyPreview: string;
  route: string;
  filePath: string;
  /** Claves del frontmatter detectadas — para debug */
  frontmatterKeys: string[];
  /** true si es landing page (.tsx/.jsx), false si es blog (.mdx) */
  isCode: boolean;
  /** Enlace al archivo en GitHub (rama del plan) */
  githubUrl: string;
  /** Frontmatter raw (primeras líneas) para diagnóstico */
  frontmatterRaw: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      const k = line.slice(0, colon).trim();
      const v = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
      fm[k] = v;
    }
  }
  return { frontmatter: fm, body: match[2] };
}

function extractInternalLinks(body: string): string[] {
  const links: string[] = [];
  const re = /\[([^\]]+)\]\((\/[^)]+)\)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    links.push(m[2]);
  }
  return Array.from(new Set(links));
}

async function fetchGitHubFile(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  pat: string
): Promise<{ content: string; sha: string } | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
      {
        headers: { Authorization: `Bearer ${pat}`, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { content: string; sha: string; encoding: string };
    if (data.encoding !== "base64") return null;
    return {
      content: Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf-8"),
      sha: data.sha,
    };
  } catch {
    return null;
  }
}

async function findMdxFile(
  owner: string,
  repo: string,
  route: string,
  branch: string,
  pat: string
): Promise<{ content: string; sha: string; filePath: string; isCode: boolean } | null> {
  const slug = route.replace(/^\/+|\/+$/g, "");
  const bare = slug.replace(/^blog\//, "");
  const mdxCandidates = [
    `src/content/${slug}.mdx`,
    `src/content/${slug}/index.mdx`,
    `content/${slug}.mdx`,
    `content/${slug}/index.mdx`,
    `src/app/${slug}/page.mdx`,
    `app/${slug}/page.mdx`,
    `_posts/${bare}.mdx`,
    `posts/${bare}.mdx`,
    `src/posts/${bare}.mdx`,
  ];
  for (const fp of mdxCandidates) {
    const r = await fetchGitHubFile(owner, repo, fp, branch, pat);
    if (r) return { ...r, filePath: fp, isCode: false };
  }
  // Fallback: landing pages are .tsx files
  const tsxCandidates = [
    `src/app/${slug}/page.tsx`,
    `app/${slug}/page.tsx`,
    `src/app/(pages)/${slug}/page.tsx`,
    `src/pages/${slug}.tsx`,
    `pages/${slug}.tsx`,
  ];
  for (const fp of tsxCandidates) {
    const r = await fetchGitHubFile(owner, repo, fp, branch, pat);
    if (r) return { ...r, filePath: fp, isCode: true };
  }
  return null;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function actionFetchContentPreview(
  taskId: string
): Promise<{ ok: true; data: ContentPreviewData } | { ok: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { ok: false, error: "Sin sesión." };

  const pat = process.env.GITHUB_PAT_CLIENT_REPOS;
  if (!pat) return { ok: false, error: "GITHUB_PAT_CLIENT_REPOS no configurado en el servidor." };

  const task = await prisma.planTask.findUnique({
    where: { id: taskId },
    include: {
      plan: { select: { branchName: true } },
      site: { select: { githubRepo: true } },
      runs: { where: { status: "SUCCEEDED" }, select: { changedRoutes: true } },
    },
  });

  if (!task) return { ok: false, error: "Tarea no encontrada." };
  if (task.status !== "DONE") return { ok: false, error: "La tarea no está DONE." };

  const branchName = task.plan?.branchName;
  const githubRepo = task.site?.githubRepo;
  if (!branchName || !githubRepo) {
    return { ok: false, error: "Sin rama de plan o repositorio configurado." };
  }

  const parts = githubRepo.split("/");
  if (parts.length < 2) return { ok: false, error: `Formato de repo inválido: ${githubRepo}` };
  const owner = parts[0];
  const repo = parts[1];

  const routes = Array.from(new Set(task.runs.flatMap((r) => r.changedRoutes)));
  if (routes.length === 0) {
    return { ok: false, error: "No hay rutas registradas para esta tarea. Puede que el contenido aún no se haya commiteado." };
  }

  const route = routes[0];
  const fileResult = await findMdxFile(owner, repo, route, branchName, pat);
  if (!fileResult) {
    return { ok: false, error: `No se encontró el archivo MDX para la ruta ${route} en la rama ${branchName}.` };
  }

  const githubUrl = `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branchName)}/${fileResult.filePath}`;
  const frontmatterRaw = fileResult.content.split(/\n---\n/)[1]
    ? `---\n${fileResult.content.split(/\n---\n/)[1].split(/\n---\n/)[0]}\n---`
    : fileResult.content.slice(0, 400);

  const { frontmatter, body } = parseFrontmatter(fileResult.content);
  const title =
    frontmatter.title ??
    frontmatter.titulo ??       // Brainet
    frontmatter.seoTitle ??
    frontmatter.metaTitle ??
    frontmatter.pageTitle ??
    "";
  const description =
    frontmatter.description ??
    frontmatter.extracto ??     // Brainet
    frontmatter.seoDescription ??
    frontmatter.metaDescription ??
    frontmatter.excerpt ??
    frontmatter.summary ??
    "";
  const coverImage =
    frontmatter.coverImage ??
    frontmatter.imagen_portada ?? // Brainet
    frontmatter.image ??
    frontmatter.cover ??
    frontmatter.thumbnail ??
    null;
  const hasBorrador =
    frontmatter.borrador === "true" || frontmatter.draft === "true";
  const internalLinks = extractInternalLinks(body);
  const bodyPreview = body
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/\*\*/g, "")
    .slice(0, 700);

  return {
    ok: true,
    data: {
      title,
      description,
      coverImage,
      hasBorrador,
      internalLinks,
      bodyPreview,
      route,
      filePath: fileResult.filePath,
      frontmatterKeys: Object.keys(frontmatter),
      isCode: fileResult.isCode,
      githubUrl,
      frontmatterRaw,
    },
  };
}

export async function actionFixBorrador(
  taskId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== "ADMIN") return { ok: false, error: "Solo administradores." };

  const pat = process.env.GITHUB_PAT_CLIENT_REPOS;
  if (!pat) return { ok: false, error: "GITHUB_PAT_CLIENT_REPOS no configurado." };

  const task = await prisma.planTask.findUnique({
    where: { id: taskId },
    include: {
      plan: { select: { branchName: true } },
      site: { select: { githubRepo: true } },
      runs: { where: { status: "SUCCEEDED" }, select: { changedRoutes: true } },
    },
  });
  if (!task) return { ok: false, error: "Tarea no encontrada." };

  const branchName = task.plan?.branchName;
  const githubRepo = task.site?.githubRepo;
  if (!branchName || !githubRepo) return { ok: false, error: "Sin rama o repo." };

  const [owner, repo] = githubRepo.split("/");
  const routes = Array.from(new Set(task.runs.flatMap((r) => r.changedRoutes)));
  if (routes.length === 0) return { ok: false, error: "Sin rutas registradas." };

  const fileResult = await findMdxFile(owner, repo, routes[0], branchName, pat);
  if (!fileResult) {
    return { ok: false, error: `Archivo MDX no encontrado para ${routes[0]}` };
  }

  const fixed = fileResult.content
    .replace(/^borrador:\s*true\s*\n/m, "")
    .replace(/^draft:\s*true\s*\n/m, "");

  if (fixed === fileResult.content) {
    return { ok: false, error: "No se encontró borrador: true ni draft: true en el archivo." };
  }

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(fileResult.filePath)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `fix: remove borrador: true from frontmatter\n\n[task:${task.id.slice(0, 8)}]`,
        content: Buffer.from(fixed).toString("base64"),
        sha: fileResult.sha,
        branch: branchName,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return { ok: false, error: `Commit fallido (${res.status}): ${err.slice(0, 200)}` };
  }

  return { ok: true };
}
