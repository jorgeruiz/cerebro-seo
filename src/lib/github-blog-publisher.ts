/**
 * Direct-to-main blog publisher for Next.js sites.
 *
 * Content lane: blogs skip the plan branch entirely.
 * Claude generates article data → staged in PlanStep.stagedChange →
 * user reviews → "Publicar" → atomic commit to main via GitHub API.
 *
 * Ported from Constructor's publish-blog-article.ts + github-writer.ts.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BlogArticleData {
  titulo: string;
  slug: string;
  categoria: string;
  tags?: string[];
  extracto: string;
  cuerpo: string;
  autor: string;
  imagen_portada?: string;
}

export interface CommitFileEntry {
  path: string;
  content: string;
  /** "utf-8" (default) or "base64" for binary files */
  encoding?: "utf-8" | "base64";
}

export interface PublishResult {
  sha: string;
  url: string;
  slug: string;
  filesCreated: string[];
}

/** Staged change for a Next.js blog article (content lane). */
export interface NextjsStagedBlogChange {
  type: "nextjs_blog";
  titulo: string;
  slug: string;
  categoria: string;
  tags: string[];
  extracto: string;
  cuerpo: string;
  autor: string;
  /** Base64 WebP cover image (if generated) */
  coverImageBase64: string | null;
  /** Path where the image will be committed */
  coverImagePath: string | null;
  staged_at: string;
}

// ─── MDX Builder ────────────────────────────────────────────────────────────

function escapeYaml(s: string): string {
  return s.replace(/"/g, '\\"');
}

export function buildMdxContent(data: BlogArticleData): string {
  const lines = [
    "---",
    `titulo: "${escapeYaml(data.titulo)}"`,
    `slug: ${data.slug}`,
    `categoria: "${escapeYaml(data.categoria)}"`,
  ];

  if (data.tags && data.tags.length > 0) {
    lines.push(`tags: [${data.tags.map((t) => `"${escapeYaml(t)}"`).join(", ")}]`);
  }

  lines.push(`extracto: "${escapeYaml(data.extracto)}"`);

  if (data.imagen_portada) {
    lines.push(`imagen_portada: "${data.imagen_portada}"`);
  }

  lines.push(
    `autor: "${escapeYaml(data.autor || "Equipo editorial")}"`,
    `fecha_publicacion: "${new Date().toISOString().slice(0, 10)}"`,
    "---",
    "",
    data.cuerpo,
  );

  return lines.join("\n");
}

// ─── Catalog Schemas Detection ──────────────────────────────────────────────

/**
 * Checks if a catalog-schemas.md has a specific section that is bootstrapped.
 *
 * Tolerant matching: accepts "## Blog", "## Blog — Implementado", "## Blog (listo)"
 * but rejects "## Blog Post", "## Blogs".
 * A section containing "No implementado" or "Pendiente" is considered not ready.
 */
export function hasSection(schemas: string | null, sectionName: string): boolean {
  if (!schemas) return false;

  // Match heading: "## Blog" optionally followed by space + decorator (—, -, :, ()
  // but NOT followed by more word characters (rejects "Blog Post", "Blogs")
  const headingRegex = new RegExp(
    `^##\\s+${escapeRegex(sectionName)}\\s*(?:$|[—\\-:(])`,
    "m"
  );

  const headingMatch = schemas.match(headingRegex);
  if (!headingMatch) return false;

  // Extract section content (from heading to next ## or end)
  const startIdx = headingMatch.index!;
  const rest = schemas.slice(startIdx);
  const nextHeading = rest.match(/\n(?=## )/);
  const sectionContent = nextHeading
    ? rest.slice(0, nextHeading.index!)
    : rest;

  // Only check the heading line and **Estado:** line for "not implemented" markers.
  // Body text like "categorías pendientes de definir" should NOT block.
  const sectionLines = sectionContent.split("\n");
  const headingLine = sectionLines[0] ?? "";
  if (/no implementado|pendiente/i.test(headingLine)) {
    return false;
  }
  for (const line of sectionLines) {
    if (/^\*\*Estado:\*\*/i.test(line.trim()) && /no implementado|pendiente/i.test(line)) {
      return false;
    }
  }

  return true;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse existing blog categories from catalog-schemas.md.
 */
export function parseBlogCategories(schemas: string | null): string[] {
  if (!schemas) return [];

  const match = schemas.match(
    /\*\*Categor[ií]as existentes:\*\*([\s\S]*?)(?=\n\*\*|\n##|\n---\s*$|$)/
  );
  if (!match) return [];

  return match[1]
    .split("\n")
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter((l) => l && !l.includes("(ninguna todav") && l !== "");
}

/**
 * Update catalog-schemas.md to add a new category.
 * Returns updated content, or null if category already exists or no insertion point.
 */
export function updateCatalogSchemas(
  existing: string,
  category: string,
  existingCategories: string[]
): string | null {
  if (existingCategories.includes(category)) return null;

  const newEntry = `- ${category}`;

  // Try replacing "(ninguna todavia)" marker
  const markerRegex = /- \(ninguna todav[ií]a\)/;
  if (markerRegex.test(existing)) {
    return existing.replace(markerRegex, newEntry);
  }

  // Try inserting before "**Reglas SEO:**"
  const rulesIdx = existing.indexOf("**Reglas SEO:**");
  if (rulesIdx !== -1) {
    return existing.slice(0, rulesIdx) + newEntry + "\n\n" + existing.slice(rulesIdx);
  }

  return null;
}

/**
 * Update site-state.md with a new blog entry.
 */
export function updateSiteState(
  existing: string,
  articleTitle: string,
  slug: string,
  requestCode: string
): string {
  const timestamp = new Date().toISOString().slice(0, 10);
  const entry = `- [${timestamp}] Blog: "${articleTitle}" → /blog/${slug} (${requestCode})`;

  const noChangesMarker = /_Sin cambios registrados a[uú]n\._/;
  if (noChangesMarker.test(existing)) {
    return existing.replace(noChangesMarker, entry);
  }

  return existing.trimEnd() + "\n" + entry + "\n";
}

// ─── GitHub API: Atomic Commit ──────────────────────────────────────────────

/**
 * Reads a file from a GitHub repo.
 * Returns null if the file doesn't exist (404).
 */
export async function readGitHubFile(
  owner: string,
  repo: string,
  filePath: string,
  pat: string,
  ref?: string
): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github.raw",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GitHub read ${filePath}: ${res.status} ${await res.text().catch(() => "")}`);
  }

  return res.text();
}

/**
 * Commits multiple files atomically to a branch via GitHub's Git Data API.
 *
 * Flow: get latest commit → create blobs → create tree → create commit → update ref.
 * This is a direct commit — no PR, no merge.
 */
export async function commitFiles(
  owner: string,
  repo: string,
  branch: string,
  files: CommitFileEntry[],
  message: string,
  pat: string
): Promise<{ sha: string }> {
  const headers = {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

  // 1. Get latest commit SHA on the branch
  const refRes = await fetch(`${apiBase}/git/refs/heads/${branch}`, { headers });
  if (!refRes.ok) {
    throw new Error(`GitHub get ref: ${refRes.status} ${await refRes.text().catch(() => "")}`);
  }
  const refData = (await refRes.json()) as { object: { sha: string } };
  const latestCommitSha = refData.object.sha;

  // 2. Get the tree SHA from the latest commit
  const commitRes = await fetch(`${apiBase}/git/commits/${latestCommitSha}`, { headers });
  if (!commitRes.ok) {
    throw new Error(`GitHub get commit: ${commitRes.status}`);
  }
  const commitData = (await commitRes.json()) as { tree: { sha: string } };
  const baseTreeSha = commitData.tree.sha;

  // 3. Create blobs for each file
  const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];

  for (const file of files) {
    const blobRes = await fetch(`${apiBase}/git/blobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        content: file.content,
        encoding: file.encoding ?? "utf-8",
      }),
    });
    if (!blobRes.ok) {
      throw new Error(`GitHub create blob (${file.path}): ${blobRes.status}`);
    }
    const blobData = (await blobRes.json()) as { sha: string };
    treeEntries.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: blobData.sha,
    });
  }

  // 4. Create tree with base_tree
  const treeRes = await fetch(`${apiBase}/git/trees`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeEntries,
    }),
  });
  if (!treeRes.ok) {
    throw new Error(`GitHub create tree: ${treeRes.status}`);
  }
  const treeData = (await treeRes.json()) as { sha: string };

  // 5. Create commit
  const newCommitRes = await fetch(`${apiBase}/git/commits`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message,
      tree: treeData.sha,
      parents: [latestCommitSha],
    }),
  });
  if (!newCommitRes.ok) {
    throw new Error(`GitHub create commit: ${newCommitRes.status}`);
  }
  const newCommitData = (await newCommitRes.json()) as { sha: string };

  // 6. Update ref to point to new commit
  const updateRefRes = await fetch(`${apiBase}/git/refs/heads/${branch}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ sha: newCommitData.sha }),
  });
  if (!updateRefRes.ok) {
    throw new Error(`GitHub update ref: ${updateRefRes.status}`);
  }

  return { sha: newCommitData.sha };
}

// ─── Publish Orchestrator ───────────────────────────────────────────────────

/**
 * Publishes a blog article directly to main via GitHub API.
 *
 * Guards (must be checked by caller):
 * - hasBlogSection(catalogSchemas) === true
 * - slug doesn't already exist
 *
 * Files committed:
 * - content/blog/{slug}.mdx
 * - public/blog/{slug}/portada.webp (if cover image provided)
 * - docs/catalog-schemas.md (if new category)
 * - docs/site-state.md (always, append entry)
 */
export async function publishBlogArticle(
  githubRepo: string,
  defaultBranch: string,
  data: BlogArticleData,
  coverImageBase64: string | null,
  pat: string
): Promise<PublishResult> {
  const [owner, repo] = githubRepo.split("/");
  if (!owner || !repo) throw new Error(`githubRepo inválido: ${githubRepo}`);

  const slug = data.slug;

  // Guard: slug must not already exist
  const existing = await readGitHubFile(owner, repo, `content/blog/${slug}.mdx`, pat, defaultBranch);
  if (existing !== null) {
    throw new Error(`SLUG_EXISTS: El artículo /blog/${slug} ya existe en main. No se puede sobrescribir.`);
  }

  // Read current catalog-schemas and site-state
  const catalogSchemas = await readGitHubFile(owner, repo, "docs/catalog-schemas.md", pat, defaultBranch);
  const siteState = await readGitHubFile(owner, repo, "docs/site-state.md", pat, defaultBranch);

  // Inject cover image path if provided
  if (coverImageBase64) {
    data.imagen_portada = `/blog/${slug}/portada.webp`;
  }

  // Build files to commit
  const files: CommitFileEntry[] = [];

  // 1. MDX article
  const mdxContent = buildMdxContent(data);
  files.push({ path: `content/blog/${slug}.mdx`, content: mdxContent });

  // 2. Cover image (binary, base64)
  if (coverImageBase64) {
    files.push({
      path: `public/blog/${slug}/portada.webp`,
      content: coverImageBase64,
      encoding: "base64",
    });
  }

  // 3. Catalog schemas update (new category)
  if (catalogSchemas) {
    const existingCategories = parseBlogCategories(catalogSchemas);
    const updated = updateCatalogSchemas(catalogSchemas, data.categoria, existingCategories);
    if (updated) {
      files.push({ path: "docs/catalog-schemas.md", content: updated });
    }
  }

  // 4. Site state update
  const requestCode = `CEREBRO-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${slug.slice(0, 20)}`;
  if (siteState) {
    const updatedState = updateSiteState(siteState, data.titulo, slug, requestCode);
    files.push({ path: "docs/site-state.md", content: updatedState });
  }

  // Atomic commit
  const { sha } = await commitFiles(
    owner,
    repo,
    defaultBranch,
    files,
    `blog: ${data.titulo} [${requestCode}]`,
    pat
  );

  return {
    sha,
    url: `/blog/${slug}`,
    slug,
    filesCreated: files.map((f) => f.path),
  };
}
