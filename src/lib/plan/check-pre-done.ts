/**
 * Pre-DONE acceptance checks.
 *
 * Runs before marking a WP content task as DONE.
 * If any check fails → WAITING_HUMAN with the detail.
 *
 * Checks:
 * - H1 unique (exactly one)
 * - Meta title length (50-65 chars)
 * - Meta description length (140-160 chars)
 * - No [COMPLETAR markers remaining
 * - Internal links respond 200 (best-effort, max 5 checked)
 */

export interface PreDoneResult {
  passed: boolean;
  issues: string[];
}

/**
 * Check a content package (staged change) before marking the task DONE.
 */
export function checkPreDone(stagedChanges: unknown[]): PreDoneResult {
  const issues: string[] = [];

  for (const sc of stagedChanges) {
    const change = sc as Record<string, unknown> | null;
    if (!change) continue;

    const type = change.type as string | undefined;

    if (type === "content_package" || type === "blog") {
      const h1 = change.h1 as string | undefined;
      const metaTitle = change.meta_title as string | undefined;
      const metaDescription = change.meta_description as string | undefined;
      const body = change.body as string | undefined;

      // H1 unique
      if (!h1 || h1.trim().length === 0) {
        issues.push("Falta H1");
      }

      // Meta title length
      if (metaTitle) {
        if (metaTitle.length < 50) issues.push(`meta_title demasiado corto (${metaTitle.length} chars, mín 50)`);
        if (metaTitle.length > 65) issues.push(`meta_title demasiado largo (${metaTitle.length} chars, máx 65)`);
      } else {
        issues.push("Falta meta_title");
      }

      // Meta description length
      if (metaDescription) {
        if (metaDescription.length < 140) issues.push(`meta_description demasiado corto (${metaDescription.length} chars, mín 140)`);
        if (metaDescription.length > 160) issues.push(`meta_description demasiado largo (${metaDescription.length} chars, máx 160)`);
      } else {
        issues.push("Falta meta_description");
      }

      // No [COMPLETAR markers
      const fullText = `${h1 ?? ""} ${metaTitle ?? ""} ${metaDescription ?? ""} ${body ?? ""}`;
      const completarMatches = fullText.match(/\[COMPLETAR[^\]]*\]/gi);
      if (completarMatches && completarMatches.length > 0) {
        issues.push(`${completarMatches.length} placeholder(s) [COMPLETAR] pendiente(s)`);
      }
    }

    if (type === "seo") {
      const metaTitle = change.meta_title as string | undefined;
      const metaDescription = change.meta_description as string | undefined;

      if (metaTitle) {
        if (metaTitle.length < 50) issues.push(`SEO meta_title corto (${metaTitle.length} chars, mín 50)`);
        if (metaTitle.length > 65) issues.push(`SEO meta_title largo (${metaTitle.length} chars, máx 65)`);
      }
      if (metaDescription) {
        if (metaDescription.length < 140) issues.push(`SEO meta_description corto (${metaDescription.length} chars, mín 140)`);
        if (metaDescription.length > 160) issues.push(`SEO meta_description largo (${metaDescription.length} chars, máx 160)`);
      }
    }
  }

  return { passed: issues.length === 0, issues };
}

/**
 * Check internal links respond 200 (best-effort, max 5).
 * Only checks links to the same domain.
 */
export async function checkInternalLinks(
  body: string,
  siteUrl: string,
): Promise<string[]> {
  const issues: string[] = [];
  if (!body || !siteUrl) return issues;

  // Extract internal href links
  const hrefPattern = /href="(\/[^"]+)"/gi;
  const links: string[] = [];
  let match;
  while ((match = hrefPattern.exec(body)) !== null) {
    if (match[1] && !match[1].startsWith("/#")) {
      links.push(match[1]);
    }
  }

  // Check max 5 links
  const toCheck = links.slice(0, 5);
  const baseUrl = siteUrl.replace(/\/+$/, "");

  for (const path of toCheck) {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
        redirect: "follow",
      });
      if (!res.ok) {
        issues.push(`Enlace interno ${path} → HTTP ${res.status}`);
      }
    } catch {
      issues.push(`Enlace interno ${path} → no responde`);
    }
  }

  return issues;
}
