import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock fetch ───────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// robots-parser mock
vi.mock("robots-parser", () => ({
  default: vi.fn().mockReturnValue({
    isAllowed: vi.fn().mockReturnValue(true),
  }),
}));

// ─── HTML fixtures ────────────────────────────────────────────────────────────

const GOOD_PAGE_HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>Molino Azteca — Harinas Industriales</title>
  <meta name="description" content="Proveedor líder de harinas industriales en México con más de 30 años de experiencia en el sector.">
  <link rel="canonical" href="https://molinoazteca.mx/">
</head>
<body>
  <h1>Harinas Industriales de Alta Calidad</h1>
  <h2>Nuestros Productos</h2>
  <p>Ofrecemos una amplia gama de harinas industriales para todas las necesidades de tu negocio.</p>
  <a href="/productos">Ver productos</a>
  <a href="https://proveedor.com">Proveedor externo</a>
  <img src="/logo.png" alt="Molino Azteca logo">
</body>
</html>
`;

const MISSING_TITLE_HTML = `
<!DOCTYPE html>
<html>
<head></head>
<body>
  <p>Sin title, sin meta description, sin H1.</p>
</body>
</html>
`;

const NOINDEX_HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>Página privada</title>
  <meta name="robots" content="noindex,nofollow">
</head>
<body><h1>Privado</h1></body>
</html>
`;

function makeResponse(html: string, status = 200, url = "https://molinoazteca.mx/") {
  return {
    ok: status < 400,
    status,
    url,
    redirected: false,
    text: () => Promise.resolve(html),
  };
}

describe("crawlSite — analyzePage (via crawlSite with maxPages=1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("página bien optimizada: sin issues críticos", async () => {
    // robots.txt → ok, homepage → good
    mockFetch
      .mockResolvedValueOnce(makeResponse("User-agent: *\nDisallow:", 200, "https://molinoazteca.mx/robots.txt")) // robots.txt
      .mockResolvedValueOnce(makeResponse(GOOD_PAGE_HTML));

    const { crawlSite } = await import("../site-crawler");
    const result = await crawlSite("https://molinoazteca.mx", 1);

    expect(result.pagesCrawled).toBe(1);
    const page = result.pages[0];
    expect(page.title).toBe("Molino Azteca — Harinas Industriales");
    expect(page.h1Count).toBe(1);
    expect(page.h1Text).toBe("Harinas Industriales de Alta Calidad");
    expect(page.imagesWithoutAlt).toBe(0);
    expect(page.externalLinks).toBe(1);

    const criticalIssues = page.issues.filter((i) => i.severity === "critical");
    expect(criticalIssues).toHaveLength(0);
  });

  it("detecta missing_title, missing_meta_description, missing_h1", async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse("", 404, "https://molinoazteca.mx/robots.txt")) // robots.txt 404
      .mockResolvedValueOnce(makeResponse(MISSING_TITLE_HTML));

    const { crawlSite } = await import("../site-crawler");
    const result = await crawlSite("https://molinoazteca.mx", 1);

    const issues = result.pages[0].issues;
    const types = issues.map((i) => i.type);
    expect(types).toContain("missing_title");
    expect(types).toContain("missing_meta_description");
    expect(types).toContain("missing_h1");
  });

  it("detecta noindex como issue crítico", async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse("", 404, "https://molinoazteca.mx/robots.txt"))
      .mockResolvedValueOnce(makeResponse(NOINDEX_HTML));

    const { crawlSite } = await import("../site-crawler");
    const result = await crawlSite("https://molinoazteca.mx", 1);

    const noindexIssue = result.pages[0].issues.find((i) => i.type === "noindex");
    expect(noindexIssue).toBeDefined();
    expect(noindexIssue!.severity).toBe("critical");
  });

  it("página 404 se registra como not_found crítico", async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse("", 404, "https://molinoazteca.mx/robots.txt"))
      .mockResolvedValueOnce(makeResponse("Not Found", 404));

    const { crawlSite } = await import("../site-crawler");
    const result = await crawlSite("https://molinoazteca.mx", 1);

    expect(result.brokenPages).toBe(1);
    const issue = result.pages[0].issues[0];
    expect(issue.type).toBe("not_found");
    expect(issue.severity).toBe("critical");
  });

  it("pagesIndexable no cuenta páginas noindex", async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse("", 404, "https://molinoazteca.mx/robots.txt"))
      .mockResolvedValueOnce(makeResponse(NOINDEX_HTML));

    const { crawlSite } = await import("../site-crawler");
    const result = await crawlSite("https://molinoazteca.mx", 1);

    expect(result.pagesIndexable).toBe(0);
  });

  it("retorna robotsTxtFound=true si robots.txt existe", async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse("User-agent: *\nAllow: /", 200))
      .mockResolvedValueOnce(makeResponse(GOOD_PAGE_HTML));

    const { crawlSite } = await import("../site-crawler");
    const result = await crawlSite("https://molinoazteca.mx", 1);

    expect(result.robotsTxtFound).toBe(true);
  });

  it("fetch error de red → issue fetch_error, no crashea", async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse("", 404)) // robots.txt
      .mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const { crawlSite } = await import("../site-crawler");
    const result = await crawlSite("https://molinoazteca.mx", 1);

    expect(result.pagesCrawled).toBe(1);
    const issue = result.pages[0].issues[0];
    expect(issue.type).toBe("fetch_error");
  });
});
