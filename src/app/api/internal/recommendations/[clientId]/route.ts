export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveSite } from "@/server/sites/resolve-site";
import { validateNotionClientId } from "@/lib/notion-client-id";
import { getServiceOAuth2Client } from "@/lib/google-oauth";
import { GoogleSearchConsoleProvider } from "@/server/providers/google-search-console";
import {
  buildOpportunitiesReport,
  type SeoOpportunity,
} from "@/lib/seo-opportunities";
import type {
  AnalysisOpportunity,
  AnalysisRisk,
  AnalysisResult,
} from "@/lib/claude-analysis";

// ── Auth ────────────────────────────────────────────────────────────────────

function authorize(req: NextRequest): boolean {
  const secret = process.env.SEO_INTERNAL_SECRET;
  if (!secret) return false; // fail-closed
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Offset UTC-6 (America/Mexico_City sin horario de verano — México
// eliminó DST en 2022). Los planes se generan en hora de México;
// interpretar el mes en esa zona evita que un plan del 31 a las 20:00
// CST caiga en el mes siguiente por UTC.
const MX_OFFSET_HOURS = -6;

function monthRange(yearMonth: string): { gte: Date; lte: Date } {
  const [year, month] = yearMonth.split("-").map(Number);
  const gte = new Date(Date.UTC(year, month - 1, 1, -MX_OFFSET_HOURS));
  const lastDay = new Date(year, month, 0).getDate();
  const lte = new Date(Date.UTC(year, month - 1, lastDay, 23 - MX_OFFSET_HOURS, 59, 59, 999));
  return { gte, lte };
}

// ── GSC Opportunities (best-effort) ─────────────────────────────────────────

interface GscOpportunityPayload {
  oppType: string;
  keyword?: string | null;
  url?: string | null;
  ctr?: number | null;
  impressions?: number | null;
  position?: number | null;
  action: string;
  priority: string;
}

async function fetchGscOpportunities(
  internalClientId: string
): Promise<GscOpportunityPayload[]> {
  try {
    const site = await resolveSite(internalClientId).catch(() => null);
    if (!site?.gscProperty) return [];

    const oauth = await getServiceOAuth2Client();
    if (!oauth) return [];

    const gsc = new GoogleSearchConsoleProvider(oauth);

    const end = new Date().toISOString().split("T")[0];
    const start = new Date(Date.now() - 28 * 86400000).toISOString().split("T")[0];

    const [queries, pages, keywordsDb, queryPageMap] = await Promise.all([
      gsc.getQueries({ siteUrl: site.gscProperty, startDate: start, endDate: end, rowLimit: 500 }).catch(() => []),
      gsc.getPages({ siteUrl: site.gscProperty, startDate: start, endDate: end, rowLimit: 200 }).catch(() => []),
      prisma.keyword.findMany({
        where: { clientId: internalClientId, isPriority: true, deletedAt: null },
        select: { term: true },
      }),
      gsc.getQueryTopPages({ siteUrl: site.gscProperty, startDate: start, endDate: end }).catch(() => new Map<string, string>()),
    ]);

    const report = buildOpportunitiesReport(
      queries, pages,
      keywordsDb.map((k) => k.term),
      queryPageMap,
    );

    const allOpps: SeoOpportunity[] = [
      ...report.quickWins,
      ...report.ctrIssuesQuery,
      ...report.noCoverage,
      ...report.poorPosition,
      ...report.ctrIssuesPage,
    ];

    return allOpps
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((opp) => ({
        oppType: opp.type,
        keyword: opp.keyword ?? null,
        url: opp.url ?? null,
        ctr: opp.ctr ?? null,
        impressions: opp.impressions ?? null,
        position: opp.position ?? null,
        action: opp.action,
        priority: opp.priority,
      }));
  } catch (err) {
    console.error("[recommendations] GSC opportunities fetch failed (non-fatal):", err);
    return [];
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { clientId: string } }
): Promise<NextResponse> {
  // 1. Auth
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validar month
  const month = req.nextUrl.searchParams.get("month");
  if (!month || !MONTH_RE.test(month)) {
    return NextResponse.json(
      { error: "month query param required (format: YYYY-MM)" },
      { status: 400 }
    );
  }

  // 3. Validar y normalizar cerebroClientId (acepta con o sin guiones)
  const idValidation = validateNotionClientId(params.clientId);
  if (!idValidation.valid) {
    return NextResponse.json({ error: idValidation.message }, { status: 400 });
  }
  const cerebroClientId = idValidation.normalized;

  const range = monthRange(month);

  // 4. Resolver cliente por cerebroClientId (Notion page ID)
  const client = await prisma.client.findUnique({
    where: { cerebroClientId },
    select: { id: true },
  });
  if (!client) {
    return NextResponse.json(
      {
        error: `Cliente con cerebroClientId "${cerebroClientId}" no está sincronizado en Cerebro SEO`,
      },
      { status: 404 }
    );
  }

  const internalId = client.id;

  // 5. Determinar tipo de plan solicitado
  const planType = req.nextUrl.searchParams.get("type"); // "monthly" | null

  if (planType === "monthly") {
    // SeoAdvisor retirado en S2c — responder vacío para monthly
    return NextResponse.json({
      clientId: cerebroClientId,
      month,
      type: "monthly",
      planId: null,
      planStatus: null,
      model: null,
      stale: false,
      nextSteps: [],
      analysis: null,
      gscOpportunities: [],
      generatedAt: null,
    });
  }

  // ── Plan diario — NextStepPlan retirado en S2c ──

  // 6. ClientAnalysis más reciente del mes
  const analysis = await prisma.clientAnalysis.findFirst({
    where: {
      clientId: internalId,
      createdAt: { gte: range.gte, lte: range.lte },
    },
    orderBy: { createdAt: "desc" },
  });

  // 7. Si no hay análisis → 404
  if (!analysis) {
    return NextResponse.json(
      { error: `Sin recomendaciones para ${cerebroClientId} en ${month}` },
      { status: 404 }
    );
  }

  // 8. Parsear contenido del análisis
  let analysisData: {
    resumenEjecutivo: string | null;
    oportunidades: AnalysisOpportunity[];
    riesgos: AnalysisRisk[];
  } | null = null;

  if (analysis) {
    try {
      const parsed = JSON.parse(analysis.content) as AnalysisResult;
      analysisData = {
        resumenEjecutivo: parsed.resumenEjecutivo ?? null,
        oportunidades: parsed.oportunidades ?? [],
        riesgos: parsed.riesgos ?? [],
      };
    } catch {
      analysisData = null;
    }
  }

  // 10. GSC Opportunities (best-effort, live data)
  const gscOpportunities = await fetchGscOpportunities(internalId);

  // 11. Respuesta enriquecida — NextStepPlan retirado, campos vacíos
  return NextResponse.json({
    clientId: cerebroClientId,
    month,
    type: "daily",
    planId: null,
    planStatus: null,
    model: null,
    stale: false,
    nextSteps: [],
    analysis: analysisData,
    gscOpportunities,
    generatedAt: null,
  });
}
