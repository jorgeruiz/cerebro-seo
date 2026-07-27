export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateNotionClientId } from "@/lib/notion-client-id";
import type { NextStep } from "@/lib/seo-advisor/types";
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
  // Primer instante del mes en CST, expresado en UTC
  const gte = new Date(Date.UTC(year, month - 1, 1, -MX_OFFSET_HOURS));
  // Último instante del mes en CST, expresado en UTC
  const lastDay = new Date(year, month, 0).getDate(); // días en el mes
  const lte = new Date(Date.UTC(year, month - 1, lastDay, 23 - MX_OFFSET_HOURS, 59, 59, 999));
  return { gte, lte };
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

  // 5. NextStepPlan más reciente del mes
  const plan = await prisma.nextStepPlan.findFirst({
    where: {
      clientId: internalId,
      generatedAt: { gte: range.gte, lte: range.lte },
    },
    orderBy: { generatedAt: "desc" },
  });

  // 6. ClientAnalysis más reciente del mes
  const analysis = await prisma.clientAnalysis.findFirst({
    where: {
      clientId: internalId,
      createdAt: { gte: range.gte, lte: range.lte },
    },
    orderBy: { createdAt: "desc" },
  });

  // 7. Si no hay nada → 404
  if (!plan && !analysis) {
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
      // content corrupto — devolver null en vez de fallar
      analysisData = null;
    }
  }

  // 9. Respuesta — clientId devuelve el cerebroClientId (Notion page ID)
  return NextResponse.json({
    clientId: cerebroClientId,
    month,
    nextSteps: plan ? (plan.steps as NextStep[]) : [],
    analysis: analysisData,
    generatedAt: plan?.generatedAt.toISOString() ?? null,
  });
}
