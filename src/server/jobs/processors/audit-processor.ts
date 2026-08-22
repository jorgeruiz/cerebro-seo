/**
 * Audit Processor — lógica central de auditoría SEO técnica.
 *
 * Dos modos:
 *   - "quick": solo PageSpeed (mobile) de la homepage. ~15s, $0 costo.
 *   - "complete": crawler completo (hasta 50 págs) + PageSpeed mobile + desktop.
 *
 * Resultados se guardan en Audit + AuditIssue en BD.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { crawlSite, type PageIssue } from "@/server/crawler/site-crawler";
import { runPageSpeed } from "@/server/providers/pagespeed";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuditMode = "quick" | "complete";

export interface AuditJobData {
  clientId: string;
  mode: AuditMode;
}

export interface AuditResult {
  auditId: string;
  mode: AuditMode;
  pagesCrawled: number;
  issuesFound: number;
  scores: {
    overall: number;
    technical: number;
    performance: number;
    content: number;
    seo: number;
    accessibility: number;
  };
  durationMs: number;
}

// ─── Score helpers ────────────────────────────────────────────────────────────

/**
 * Calcula score técnico (0-100) basado en issues de severidad.
 * Cada issue deduce puntos según su severidad.
 */
function calcTechnicalScore(issues: PageIssue[], totalPages: number): number {
  if (totalPages === 0) return 50;

  const deductions = issues.reduce((acc, issue) => {
    const penalty =
      issue.severity === "critical" ? 15
      : issue.severity === "high" ? 8
      : issue.severity === "medium" ? 3
      : issue.severity === "low" ? 1
      : 0;
    return acc + penalty;
  }, 0);

  // Normalizar: penalizar más si hay pocas páginas
  const normalizedDeduction = Math.min(deductions / Math.max(totalPages, 1), 100);
  return Math.max(0, Math.round(100 - normalizedDeduction));
}

/**
 * Calcula score de contenido (0-100) basado en problemas de contenido.
 */
function calcContentScore(issues: PageIssue[], totalPages: number): number {
  if (totalPages === 0) return 50;

  const contentIssues = issues.filter((i) =>
    ["missing_title", "missing_meta_description", "missing_h1",
     "multiple_h1", "thin_content", "title_too_short", "title_too_long",
     "meta_description_too_short", "meta_description_too_long"].includes(i.type)
  );

  const deduction = contentIssues.length * 4;
  return Math.max(0, Math.round(100 - Math.min(deduction, 100)));
}

/**
 * Score overall = promedio ponderado de todas las dimensiones.
 */
function calcOverallScore(scores: {
  technical: number;
  performance: number;
  content: number;
  seo: number;
  accessibility: number;
}): number {
  return Math.round(
    scores.technical * 0.30 +
    scores.performance * 0.30 +
    scores.content * 0.20 +
    scores.seo * 0.10 +
    scores.accessibility * 0.10
  );
}

// ─── Main processor ───────────────────────────────────────────────────────────

export async function runAuditProcessor(data: AuditJobData): Promise<AuditResult> {
  const start = Date.now();
  const { clientId, mode } = data;

  // ── Buscar site del cliente ─────────────────────────────────────────────────

  const site = await prisma.site.findFirst({
    where: { clientId },
    select: { id: true, url: true },
  });

  if (!site) {
    throw new Error(`No site found for client ${clientId}`);
  }

  const siteUrl = site.url.startsWith("http") ? site.url : `https://${site.url}`;

  // ── Crear registro Audit en estado "running" ────────────────────────────────

  const audit = await prisma.audit.create({
    data: {
      clientId,
      siteId: site.id,
      type: mode,
      status: "running",
      startedAt: new Date(),
      scoreOverall: 0,
      scoreTechnical: 0,
      scorePerformance: 0,
      scoreContent: 0,
    },
  });

  try {
    // ── PageSpeed (siempre se corre, al menos mobile) ───────────────────────

    const [psiMobile, psiDesktop] = await Promise.allSettled([
      runPageSpeed(siteUrl, "mobile"),
      mode === "complete" ? runPageSpeed(siteUrl, "desktop") : Promise.resolve(null),
    ]);

    const psiMobileResult = psiMobile.status === "fulfilled" ? psiMobile.value : null;
    const psiDesktopResult = psiDesktop.status === "fulfilled" ? psiDesktop.value : null;

    // ── Crawl (solo mode complete) ──────────────────────────────────────────

    let crawlResult = null;
    if (mode === "complete") {
      crawlResult = await crawlSite(siteUrl, 50);
    }

    // ── Aggregate all issues ────────────────────────────────────────────────

    const allPageIssues: PageIssue[] = crawlResult?.pages.flatMap((p) => p.issues) ?? [];

    // Añadir issues de PageSpeed opportunities como issues de audit
    const psiIssues: PageIssue[] = (psiMobileResult?.opportunities ?? []).map((opp) => ({
      type: opp.id,
      severity: opp.score === null ? "info" : opp.score < 0.5 ? "high" : "medium" as PageIssue["severity"],
      message: opp.title + (opp.displayValue ? ` (${opp.displayValue})` : ""),
      ...(opp.resources?.length ? { data: { resources: opp.resources } } : {}),
    }));

    // ── Scores ──────────────────────────────────────────────────────────────

    const perfScore = psiMobileResult?.scores.performance ?? 0;
    const seoScore = psiMobileResult?.scores.seo ?? 0;
    const accessibilityScore = psiMobileResult?.scores.accessibility ?? 0;

    const totalPages = crawlResult?.pagesCrawled ?? 1;
    const technicalScore = calcTechnicalScore([...allPageIssues, ...psiIssues], totalPages);
    const contentScore = calcContentScore(allPageIssues, totalPages);
    const overallScore = calcOverallScore({
      technical: technicalScore,
      performance: perfScore,
      content: contentScore,
      seo: seoScore,
      accessibility: accessibilityScore,
    });

    // ── CWV data ────────────────────────────────────────────────────────────

    const cwvData = psiMobileResult
      ? {
          mobile: psiMobileResult.cwv,
          desktop: psiDesktopResult?.cwv ?? null,
          mobileScores: psiMobileResult.scores,
          desktopScores: psiDesktopResult?.scores ?? null,
        }
      : null;

    // ── Persistir AuditIssues ───────────────────────────────────────────────

    // Agrupar issues por tipo para no duplicar
    const issueMap = new Map<string, { issue: PageIssue; count: number; affectedUrl?: string }>();

    for (const page of crawlResult?.pages ?? []) {
      for (const issue of page.issues) {
        const key = issue.type;
        const existing = issueMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          issueMap.set(key, { issue, count: 1, affectedUrl: page.url });
        }
      }
    }

    // PSI issues (no tienen URL específica — aplican a homepage)
    for (const issue of psiIssues) {
      if (!issueMap.has(issue.type)) {
        issueMap.set(issue.type, { issue, count: 1, affectedUrl: siteUrl });
      }
    }

    const auditIssuesData = Array.from(issueMap.values()).map(({ issue, count, affectedUrl }) => ({
      auditId: audit.id,
      category: categorizeIssue(issue.type),
      severity: issue.severity,
      type: issue.type,
      title: issue.message,
      description: getIssueDescription(issue.type),
      affectedUrl: affectedUrl ?? null,
      count,
      data: issue.data ? (issue.data as Prisma.InputJsonValue) : Prisma.JsonNull,
    }));

    if (auditIssuesData.length > 0) {
      await prisma.auditIssue.createMany({ data: auditIssuesData });
    }

    // ── Actualizar Audit con resultados finales ──────────────────────────────

    await prisma.audit.update({
      where: { id: audit.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        scoreOverall: overallScore,
        scoreTechnical: technicalScore,
        scorePerformance: perfScore,
        scoreContent: contentScore,
        accessibilityScore,
        seoScore,
        issues: auditIssuesData.map((i) => ({ type: i.type, severity: i.severity, count: i.count })),
        pagesCrawled: crawlResult?.pagesCrawled ?? 1,
        pagesIndexable: crawlResult?.pagesIndexable ?? (psiMobileResult ? 1 : 0),
        brokenPages: crawlResult?.brokenPages ?? 0,
        redirectPages: crawlResult?.redirectPages ?? 0,
        cwvData: cwvData ? (JSON.parse(JSON.stringify(cwvData)) as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });

    const durationMs = Date.now() - start;
    console.log(
      `[audit-processor] ${mode} audit complete for ${clientId} — ` +
      `${totalPages} pages, ${auditIssuesData.length} issues, score ${overallScore} — ${durationMs}ms`
    );

    return {
      auditId: audit.id,
      mode,
      pagesCrawled: totalPages,
      issuesFound: auditIssuesData.length,
      scores: {
        overall: overallScore,
        technical: technicalScore,
        performance: perfScore,
        content: contentScore,
        seo: seoScore,
        accessibility: accessibilityScore,
      },
      durationMs,
    };
  } catch (err) {
    // Marcar audit como fallido
    await prisma.audit.update({
      where: { id: audit.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function categorizeIssue(type: string): string {
  if (["missing_title", "title_too_short", "title_too_long",
       "missing_meta_description", "meta_description_too_short",
       "meta_description_too_long", "thin_content"].includes(type)) {
    return "content";
  }
  if (["missing_h1", "multiple_h1", "images_missing_alt"].includes(type)) {
    return "seo";
  }
  if (["slow_ttfb", ...["render-blocking-resources", "unused-css-rules",
       "unused-javascript", "uses-optimized-images", "uses-webp-images",
       "uses-text-compression", "total-blocking-time", "largest-contentful-paint-element"]].includes(type)) {
    return "performance";
  }
  if (["not_found", "server_error", "fetch_error", "noindex",
       "missing_canonical"].includes(type)) {
    return "technical";
  }
  return "technical";
}

const ISSUE_DESCRIPTIONS: Record<string, string> = {
  missing_title: "La etiqueta <title> es uno de los factores SEO más importantes. Sin ella, Google no sabe cómo nombrar la página en los resultados.",
  title_too_short: "Los titles cortos desaprovechan el espacio disponible para incluir keywords relevantes.",
  title_too_long: "Google trunca titles mayores a ~60 caracteres en los resultados de búsqueda.",
  missing_meta_description: "Aunque no es un factor de ranking directo, la meta description afecta el CTR en los resultados.",
  missing_h1: "El H1 es la señal de relevancia más importante para el contenido de la página.",
  multiple_h1: "Múltiples H1 diluyen la señal de relevancia. Cada página debe tener exactamente un H1.",
  images_missing_alt: "El texto alternativo ayuda a los motores de búsqueda a entender las imágenes y mejora la accesibilidad.",
  noindex: "Una página con meta robots noindex no será indexada por Google.",
  missing_canonical: "Sin canonical, Google puede indexar variantes duplicadas de la misma URL.",
  thin_content: "Páginas con poco contenido tienen menos señales de relevancia para Google.",
  slow_ttfb: "El TTFB lento indica problemas de servidor o base de datos que afectan todos los Core Web Vitals.",
  not_found: "Las páginas 404 dañan la experiencia del usuario y desperdician crawl budget.",
  server_error: "Los errores 5xx impiden que Google indexe la página.",
};

function getIssueDescription(type: string): string {
  return ISSUE_DESCRIPTIONS[type] ?? "Problema detectado durante la auditoría técnica.";
}
