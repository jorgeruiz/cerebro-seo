export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { prisma } from "@/lib/db";
import { GoogleAnalytics4Provider, DailyGa4Metric } from "@/server/providers/google-analytics-4";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers de fecha
// ──────────────────────────────────────────────────────────────────────────────

const MONTHS_ES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function daysBack(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

function formatLabel(dateStr: string, range: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  if (range === "12m") return MONTHS_ES[d.getUTCMonth()];
  return `${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

// ──────────────────────────────────────────────────────────────────────────────
// Normalización del Property ID
// El provider GA4 añade "properties/" internamente — siempre pasarle el número
// puro. Constructor puede pasar cualquier formato.
// ──────────────────────────────────────────────────────────────────────────────

function normalizePropertyId(raw: string): string {
  return raw.startsWith("properties/") ? raw.slice("properties/".length) : raw;
}

// ──────────────────────────────────────────────────────────────────────────────
// Agrupación de métricas diarias en la serie temporal
// ──────────────────────────────────────────────────────────────────────────────

interface SeriesPoint {
  label: string;
  date: string;
  organico: number;
  pago: number;
}

function groupByStep(rows: DailyGa4Metric[], stepDays: number, range: string): SeriesPoint[] {
  const result: SeriesPoint[] = [];
  for (let i = 0; i < rows.length; i += stepDays) {
    const chunk = rows.slice(i, i + stepDays);
    const organico = chunk.reduce((s, r) => s + r.sessions, 0);
    result.push({
      label: formatLabel(chunk[0].date, range),
      date: new Date(chunk[0].date + "T00:00:00Z").toISOString(),
      organico,
      pago: 0,
    });
  }
  return result;
}

function groupByMonth(rows: DailyGa4Metric[], range: string): SeriesPoint[] {
  const byMonth: Record<string, { sessions: number; firstDate: string }> = {};
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = { sessions: 0, firstDate: row.date };
    byMonth[month].sessions += row.sessions;
  }
  return Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({
      label: formatLabel(v.firstDate, range),
      date: new Date(v.firstDate + "T00:00:00Z").toISOString(),
      organico: v.sessions,
      pago: 0,
    }));
}

// ──────────────────────────────────────────────────────────────────────────────
// OAuth client — usa tokens del primer usuario con Google conectado.
// En esta etapa no hay service account; cuando se implemente, reemplazar aquí.
// ──────────────────────────────────────────────────────────────────────────────

async function getAnyOAuth2Client() {
  const account = await prisma.account.findFirst({
    where: { provider: "google", access_token: { not: null } },
  });
  if (!account?.access_token) return null;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL}/api/auth/callback/google`
  );
  oauth2Client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token ?? undefined,
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
  });
  oauth2Client.on("tokens", async (tokens) => {
    await prisma.account.update({
      where: { id: account.id },
      data: {
        access_token: tokens.access_token ?? account.access_token,
        ...(tokens.refresh_token && { refresh_token: tokens.refresh_token }),
        ...(tokens.expiry_date && { expires_at: Math.floor(tokens.expiry_date / 1000) }),
      },
    });
  });
  return oauth2Client;
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/internal/constructor/metrics
// ──────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  // 1. Autenticación Bearer token
  const authHeader = req.headers.get("authorization");
  const secret = process.env.SEO_INTERNAL_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parámetros
  const ga4PropertyIdRaw = req.nextUrl.searchParams.get("ga4PropertyId");
  const range = req.nextUrl.searchParams.get("range") ?? "28d";

  if (!ga4PropertyIdRaw) {
    return NextResponse.json({ error: "ga4PropertyId is required" }, { status: 400 });
  }
  if (!["28d", "90d", "12m"].includes(range)) {
    return NextResponse.json(
      { error: "range must be one of: 28d, 90d, 12m" },
      { status: 400 }
    );
  }

  // 3. Normalizar ID — buscar en BD con o sin prefijo
  const bareId = normalizePropertyId(ga4PropertyIdRaw);

  const site = await prisma.site.findFirst({
    where: {
      OR: [
        { ga4Property: bareId },
        { ga4Property: `properties/${bareId}` },
      ],
    },
  });

  if (!site?.ga4Property) {
    return NextResponse.json(
      { error: `No site found with ga4PropertyId: ${ga4PropertyIdRaw}` },
      { status: 404 }
    );
  }

  // 4. OAuth client
  const oauth = await getAnyOAuth2Client();
  if (!oauth) {
    return NextResponse.json(
      { error: "No Google OAuth credentials available in this instance" },
      { status: 503 }
    );
  }

  // 5. Rangos de fechas — período actual y período anterior del mismo largo
  const rangeDays = range === "28d" ? 28 : range === "90d" ? 90 : 365;
  const endCurrent = today();
  const startCurrent = daysBack(rangeDays);
  const endPrev = daysBack(rangeDays + 1);
  const startPrev = daysBack(rangeDays * 2 + 1);

  // 6. Llamadas GA4
  const propId = normalizePropertyId(site.ga4Property); // garantizar número puro para el provider
  const ga4 = new GoogleAnalytics4Provider(oauth);

  let dailyMetrics, overviewCurrent, overviewPrev;
  try {
    [dailyMetrics, overviewCurrent, overviewPrev] = await Promise.all([
      ga4.getDailyMetrics(propId, startCurrent, endCurrent),
      ga4.getOverview(propId, startCurrent, endCurrent),
      ga4.getOverview(propId, startPrev, endPrev),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `GA4 API error: ${msg}` },
      { status: 502 }
    );
  }

  // 7. Serie temporal
  let series: SeriesPoint[];
  if (range === "28d") {
    series = groupByStep(dailyMetrics, 2, range);
  } else if (range === "90d") {
    series = groupByStep(dailyMetrics, 7, range);
  } else {
    series = groupByMonth(dailyMetrics, range);
  }

  // 8. Cards con delta vs período anterior
  const totalSessions = overviewCurrent.totalSessions;
  const prevSessions = overviewPrev.totalSessions;
  const sessionsDelta = totalSessions - prevSessions;

  const totalConversions = overviewCurrent.totalConversions;
  const prevConversions = overviewPrev.totalConversions;
  const conversionsDelta = totalConversions - prevConversions;

  const fmtDelta = (delta: number) =>
    delta >= 0 ? `+${fmtNum(delta)}` : fmtNum(delta);

  const trend = (delta: number): "up" | "down" | "flat" =>
    delta > 0 ? "up" : delta < 0 ? "down" : "flat";

  const cards = [
    {
      key: "visitas",
      label: "VISITAS",
      icon: "eye",
      value: fmtNum(totalSessions),
      delta: prevSessions > 0 ? fmtDelta(sessionsDelta) : null,
      trend: prevSessions > 0 ? trend(sessionsDelta) : "none",
    },
    {
      key: "conversiones",
      label: "CONVERSIONES",
      icon: "target",
      value: totalConversions > 0 ? fmtNum(totalConversions) : "—",
      delta: totalConversions > 0 && prevConversions > 0 ? fmtDelta(conversionsDelta) : null,
      trend: totalConversions > 0 && prevConversions > 0 ? trend(conversionsDelta) : ("none" as const),
    },
    {
      key: "clics_pago",
      label: "CLICS DE PAGO",
      icon: "ad",
      value: "0",
      delta: null,
      trend: "none" as const,
    },
  ];

  return NextResponse.json({
    range,
    lastUpdated: new Date().toISOString(),
    hasPaidCampaign: false,
    series,
    cards,
  });
}
