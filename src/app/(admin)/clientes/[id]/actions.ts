"use server";

import { google } from "googleapis";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getOAuth2Client } from "@/lib/google-oauth";
import { prisma } from "@/lib/db";
import { GoogleSearchConsoleProvider } from "@/server/providers/google-search-console";
import type { GscQueryRow } from "@/server/providers/google-search-console";
import { GoogleAnalytics4Provider } from "@/server/providers/google-analytics-4";
import type { Ga4PageRow } from "@/server/providers/google-analytics-4";

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

export type GscRange = "28d" | "90d" | "12m";
export type { GscQueryRow };

export type GscQueriesDevice = "all" | "desktop" | "mobile" | "tablet";
export type GscQueriesSortBy = "clicks" | "impressions" | "ctr" | "position";

export interface GscQueriesParams {
  clientId: string;
  range: GscRange;
  device: GscQueriesDevice;
  country: string; // "all" | ISO 3166-1 alpha-3 lowercase
  sortBy: GscQueriesSortBy;
  sortDir: "asc" | "desc";
}

export interface GscQueriesResult {
  queries: GscQueryRow[];
  total: number;
}

export type PageTrafficSortBy =
  | "sessions" | "users" | "conversions" | "bounceRate"
  | "clicks" | "impressions" | "ctr" | "position";

export interface PageTrafficRow {
  page: string;
  // GA4 (null si la página no aparece en GA4)
  sessions: number | null;
  users: number | null;
  conversions: number | null;
  bounceRate: number | null;
  avgSessionDuration: number | null;
  // GSC (null si la página no aparece en GSC)
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
}

export interface PagesTrafficResult {
  pages: PageTrafficRow[];
  total: number;
  hasGsc: boolean;
  hasGa4: boolean;
}

export interface Ga4Snapshot {
  sessions: number;
  users: number;
  bounceRate: number;
  conversions: number;
  sessionsDelta: number;
  usersDelta: number;
  bounceRateDelta: number;
  conversionsDelta: number;
}

export interface GscSnapshot {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  // Deltas vs período anterior (absoluto para clics/imps, puntos para posición/ctr)
  clicksDelta: number;
  impressionsDelta: number;
  ctrDelta: number;
  positionDelta: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysBack(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().split("T")[0];
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

// ── Actions ──────────────────────────────────────────────────────────────────

/**
 * Lista todas las propiedades de GSC accesibles por el usuario actual.
 * Devuelve [] si no hay OAuth token o si el scope webmasters no fue otorgado.
 */
export async function listGscSites(): Promise<GscSite[]> {
  const session = await getSession();
  if (!session?.user?.id) return [];

  const oauth = await getOAuth2Client(session.user.id);
  if (!oauth) return [];

  try {
    const wmt = google.webmasters({ version: "v3", auth: oauth });
    const { data } = await wmt.sites.list();
    return (data.siteEntry ?? []).map((s) => ({
      siteUrl: s.siteUrl ?? "",
      permissionLevel: s.permissionLevel ?? "siteUnverifiedUser",
    }));
  } catch {
    // Sin scope webmasters o sin sitios — devolver vacío
    return [];
  }
}

/**
 * Persiste la propiedad GSC elegida en el Site del cliente.
 * Requiere sesión activa.
 */
export async function setClientGscProperty(
  clientId: string,
  siteUrl: string
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.user?.id) return { ok: false, error: "No autenticado" };

  const parsed = z.string().min(1).safeParse(siteUrl);
  if (!parsed.success) return { ok: false, error: "URL de propiedad inválida" };

  const site = await prisma.site.findFirst({ where: { clientId } });
  if (!site) return { ok: false, error: "Cliente sin sitio configurado" };

  await prisma.site.update({
    where: { id: site.id },
    data: { gscProperty: siteUrl },
  });

  return { ok: true };
}

/**
 * Devuelve el snapshot de 28d con comparativa vs los 28d anteriores.
 * Utiliza el provider de GSC con caché 24h.
 */
export async function getGscSnapshot(
  clientId: string
): Promise<GscSnapshot | null> {
  const session = await getSession();
  if (!session?.user?.id) return null;

  const site = await prisma.site.findFirst({ where: { clientId } });
  if (!site?.gscProperty) return null;

  const oauth = await getOAuth2Client(session.user.id);
  if (!oauth) return null;

  const gsc = new GoogleSearchConsoleProvider(oauth);

  // Período actual: últimos 28 días
  const endCurrent = today();
  const startCurrent = daysBack(28);

  // Período anterior: 28 días antes del actual
  const endPrev = daysBack(29);
  const startPrev = daysBack(57);

  const [current, prev] = await Promise.all([
    gsc.getOverview(site.gscProperty, startCurrent, endCurrent),
    gsc.getOverview(site.gscProperty, startPrev, endPrev),
  ]);

  return {
    clicks: current.totalClicks,
    impressions: current.totalImpressions,
    ctr: current.avgCtr,
    position: current.avgPosition,
    clicksDelta: current.totalClicks - prev.totalClicks,
    impressionsDelta: current.totalImpressions - prev.totalImpressions,
    ctrDelta: parseFloat((current.avgCtr - prev.avgCtr).toFixed(2)),
    positionDelta: parseFloat((current.avgPosition - prev.avgPosition).toFixed(1)),
  };
}

/**
 * Snapshot GA4 de 28 días con comparativa vs los 28 días anteriores.
 * Filtra por canal Organic Search. Caché Redis 4h.
 */
export async function getGa4Snapshot(
  clientId: string
): Promise<Ga4Snapshot | null> {
  const session = await getSession();
  if (!session?.user?.id) return null;

  const site = await prisma.site.findFirst({ where: { clientId } });
  if (!site?.ga4Property) return null;

  const oauth = await getOAuth2Client(session.user.id);
  if (!oauth) return null;

  const ga4 = new GoogleAnalytics4Provider(oauth);

  const endCurrent = today();
  const startCurrent = daysBack(28);
  const endPrev = daysBack(29);
  const startPrev = daysBack(57);

  const [current, prev] = await Promise.all([
    ga4.getOverview(site.ga4Property, startCurrent, endCurrent),
    ga4.getOverview(site.ga4Property, startPrev, endPrev),
  ]);

  return {
    sessions: current.totalSessions,
    users: current.totalUsers,
    bounceRate: current.avgBounceRate,
    conversions: current.totalConversions,
    sessionsDelta: current.totalSessions - prev.totalSessions,
    usersDelta: current.totalUsers - prev.totalUsers,
    bounceRateDelta: parseFloat((current.avgBounceRate - prev.avgBounceRate).toFixed(1)),
    conversionsDelta: current.totalConversions - prev.totalConversions,
  };
}

function rangeToDates(range: GscRange): { startDate: string; endDate: string } {
  const days = range === "28d" ? 28 : range === "90d" ? 90 : 365;
  return { startDate: daysBack(days), endDate: today() };
}

/**
 * Devuelve las queries GSC del cliente filtradas por device/country/range.
 * Top 200 queries ordenadas en memoria (paginación en Fase 3).
 */
export async function getGscQueries(
  params: GscQueriesParams
): Promise<GscQueriesResult | { error: string }> {
  const session = await getSession();
  if (!session?.user?.id) return { error: "no_session" };

  const site = await prisma.site.findFirst({
    where: { clientId: params.clientId },
  });
  if (!site?.gscProperty) return { error: "no_property_configured" };

  const oauth = await getOAuth2Client(session.user.id);
  if (!oauth) return { error: "no_oauth_token" };

  const { startDate, endDate } = rangeToDates(params.range);

  const gsc = new GoogleSearchConsoleProvider(oauth);
  const rows = await gsc.getQueries({
    siteUrl: site.gscProperty,
    startDate,
    endDate,
    device: params.device,
    country: params.country,
  });

  // Log a ApiUsage (GSC es free tier — cost: 0)
  await prisma.apiUsage.create({
    data: {
      provider: "gsc",
      endpoint: "searchanalytics.query/queries",
      cost: 0,
      clientId: params.clientId,
    },
  });

  // Ordenar en memoria
  const sorted = [...rows].sort((a, b) => {
    const av = a[params.sortBy];
    const bv = b[params.sortBy];
    return params.sortDir === "desc" ? bv - av : av - bv;
  });

  const limited = sorted.slice(0, 200);
  return { queries: limited, total: rows.length };
}

// Quita el dominio de una URL GSC para obtener la pagePath relativa
// "https://molino.com/servicios" → "/servicios"
function normalizePagePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.startsWith("/") ? url : `/${url}`;
  }
}

/**
 * Fusiona datos de tráfico de páginas desde GA4 (sesiones, usuarios, conversiones,
 * rebote) y GSC (clics, impresiones, CTR, posición) en una sola tabla por URL.
 * Outer join: incluye páginas que aparezcan en cualquiera de las dos fuentes.
 * Nulls al final al ordenar.
 */
export async function getPagesTraffic({
  clientId,
  range,
  sortBy,
  sortDir,
}: {
  clientId: string;
  range: GscRange;
  sortBy: PageTrafficSortBy;
  sortDir: "asc" | "desc";
}): Promise<PagesTrafficResult | { error: string }> {
  const session = await getSession();
  if (!session?.user?.id) return { error: "no_session" };

  const site = await prisma.site.findFirst({ where: { clientId } });
  if (!site?.gscProperty && !site?.ga4Property) {
    return { error: "no_properties_configured" };
  }

  const oauth = await getOAuth2Client(session.user.id);
  if (!oauth) return { error: "no_oauth_token" };

  const { startDate, endDate } = rangeToDates(range);
  const hasGsc = !!site.gscProperty;
  const hasGa4 = !!site.ga4Property;

  // Llamadas en paralelo — solo las propiedades configuradas
  const [gscPages, ga4Pages] = await Promise.all([
    hasGsc
      ? new GoogleSearchConsoleProvider(oauth).getPages({
          siteUrl: site.gscProperty!,
          startDate,
          endDate,
        })
      : Promise.resolve([] as Awaited<ReturnType<GoogleSearchConsoleProvider["getPages"]>>),
    hasGa4
      ? new GoogleAnalytics4Provider(oauth).getPagesMetrics(
          site.ga4Property!,
          startDate,
          endDate
        )
      : Promise.resolve([] as Ga4PageRow[]),
  ]);

  // Log ApiUsage por cada fuente consultada
  const usageEntries = [];
  if (hasGsc && gscPages.length > 0) {
    usageEntries.push({ provider: "gsc", endpoint: "searchanalytics.query.pages", cost: 0, clientId });
  }
  if (hasGa4 && ga4Pages.length > 0) {
    usageEntries.push({ provider: "ga4", endpoint: "runReport.pages", cost: 0, clientId });
  }
  if (usageEntries.length > 0) {
    await prisma.apiUsage.createMany({ data: usageEntries });
  }

  // Outer join por pagePath normalizada
  // Mapa: pagePath → row combinada
  const merged = new Map<string, PageTrafficRow>();

  // Insertar páginas de GA4 (pagePath ya es relativa)
  for (const row of ga4Pages) {
    const path = row.page.startsWith("/") ? row.page : `/${row.page}`;
    merged.set(path, {
      page: path,
      sessions: row.sessions,
      users: row.users,
      conversions: row.conversions,
      bounceRate: row.bounceRate,
      avgSessionDuration: row.avgSessionDuration,
      clicks: null,
      impressions: null,
      ctr: null,
      position: null,
    });
  }

  // Insertar/actualizar páginas de GSC (normalizar URL absoluta → pagePath)
  for (const row of gscPages) {
    const path = normalizePagePath(row.page);
    const existing = merged.get(path);
    if (existing) {
      existing.clicks = row.clicks;
      existing.impressions = row.impressions;
      existing.ctr = row.ctr;
      existing.position = row.position;
    } else {
      merged.set(path, {
        page: path,
        sessions: null,
        users: null,
        conversions: null,
        bounceRate: null,
        avgSessionDuration: null,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
      });
    }
  }

  const all = Array.from(merged.values());

  // Ordenar con nulls al final
  const sorted = [...all].sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return sortDir === "desc" ? bv - av : av - bv;
  });

  return {
    pages: sorted.slice(0, 200),
    total: all.length,
    hasGsc,
    hasGa4,
  };
}
