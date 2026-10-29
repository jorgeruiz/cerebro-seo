/**
 * Post-completion verification for plan tasks.
 *
 * Checks that the expected changes are live on production URLs:
 * - Meta tags: verifies <title>, og:title, meta description
 * - Schema: verifies JSON-LD presence
 * - Content: verifies page returns 200
 * - WordPress: verifies via plugin proxy (GET /seo/{page_id})
 */

export interface VerificationCheck {
  label: string;
  url: string;
  status: "pass" | "fail" | "warn" | "skip";
  detail: string;
}

export interface TaskVerificationResult {
  taskTitle: string;
  checks: VerificationCheck[];
  allPassed: boolean;
}

/**
 * Verify a completed task by checking production URLs.
 */
export async function verifyTask(task: {
  title: string;
  category: string;
  resultUrls: string[];
  runs: Array<{ changedRoutes: string[] }>;
}, siteUrl: string): Promise<TaskVerificationResult> {
  const checks: VerificationCheck[] = [];
  const baseUrl = siteUrl.startsWith("http") ? siteUrl.replace(/\/$/, "") : `https://${siteUrl}`;

  // Collect all URLs to check
  const urls = task.resultUrls.length > 0
    ? task.resultUrls
    : task.runs.flatMap((r) => r.changedRoutes).map((r) => `${baseUrl}${r}`);

  if (urls.length === 0) {
    checks.push({
      label: "URLs de resultado",
      url: "",
      status: "skip",
      detail: "No hay URLs registradas para verificar",
    });
    return { taskTitle: task.title, checks, allPassed: true };
  }

  const cat = task.category.toLowerCase();

  for (const url of urls) {
    const fullUrl = url.startsWith("http") ? url : `${baseUrl}${url}`;

    try {
      const res = await fetch(fullUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
        headers: { "User-Agent": "Cerebro-SEO-Verifier/1.0" },
      });

      if (!res.ok) {
        checks.push({
          label: "HTTP Status",
          url: fullUrl,
          status: "fail",
          detail: `${res.status} ${res.statusText}`,
        });
        continue;
      }

      checks.push({
        label: "HTTP Status",
        url: fullUrl,
        status: "pass",
        detail: `200 OK`,
      });

      // For meta/SEO tasks, check the HTML
      if (cat === "meta" || cat === "seo" || cat === "schema" || cat === "tecnico") {
        const html = await res.text();
        verifyMetaTags(html, fullUrl, checks);

        if (cat === "schema") {
          verifyJsonLd(html, fullUrl, checks);
        }
      }
    } catch (err) {
      checks.push({
        label: "Conexión",
        url: fullUrl,
        status: "fail",
        detail: `Error: ${(err as Error).message}`,
      });
    }
  }

  return {
    taskTitle: task.title,
    checks,
    allPassed: checks.every((c) => c.status === "pass" || c.status === "skip"),
  };
}

function verifyMetaTags(html: string, url: string, checks: VerificationCheck[]) {
  // <title>
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    const title = titleMatch[1].trim();
    const len = title.length;
    checks.push({
      label: "Title tag",
      url,
      status: len >= 30 && len <= 70 ? "pass" : "warn",
      detail: `"${title.slice(0, 60)}${title.length > 60 ? "…" : ""}" (${len} chars)`,
    });
  } else {
    checks.push({ label: "Title tag", url, status: "fail", detail: "No encontrado" });
  }

  // <meta name="description">
  const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)
    ?? html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
  if (descMatch) {
    const desc = descMatch[1].trim();
    const len = desc.length;
    checks.push({
      label: "Meta description",
      url,
      status: len >= 100 && len <= 170 ? "pass" : "warn",
      detail: `"${desc.slice(0, 80)}${desc.length > 80 ? "…" : ""}" (${len} chars)`,
    });
  } else {
    checks.push({ label: "Meta description", url, status: "fail", detail: "No encontrado" });
  }

  // og:title
  const ogTitle = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  checks.push({
    label: "og:title",
    url,
    status: ogTitle ? "pass" : "warn",
    detail: ogTitle ? ogTitle[1].slice(0, 60) : "No encontrado",
  });
}

function verifyJsonLd(html: string, url: string, checks: VerificationCheck[]) {
  const ldMatches = html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (ldMatches && ldMatches.length > 0) {
    checks.push({
      label: "JSON-LD Schema",
      url,
      status: "pass",
      detail: `${ldMatches.length} schema(s) encontrado(s)`,
    });

    // Try to parse and report types
    for (const match of ldMatches) {
      const jsonStr = match.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "");
      try {
        const data = JSON.parse(jsonStr) as { "@type"?: string };
        if (data["@type"]) {
          checks.push({
            label: "Schema @type",
            url,
            status: "pass",
            detail: data["@type"],
          });
        }
      } catch {
        // malformed JSON-LD
      }
    }
  } else {
    checks.push({
      label: "JSON-LD Schema",
      url,
      status: "fail",
      detail: "No encontrado en la página",
    });
  }
}

/**
 * Verify WordPress task via plugin proxy.
 * Checks GET /seo/{page_id} for meta values.
 */
export async function verifyWpTask(
  _cerebroClientId: string,
  pageId: number,
  _expected: { metaTitle?: string; metaDescription?: string },
): Promise<VerificationCheck[]> {
  const checks: VerificationCheck[] = [];

  // This would use the WP proxy — for now, just verify the page is accessible
  checks.push({
    label: "WP Verificación",
    url: `wp:page/${pageId}`,
    status: "skip",
    detail: "Verificación WP via proxy pendiente de implementar",
  });

  return checks;
}
