/**
 * Page Metrics Processor — fetches GSC page×date data and writes to PageMetric.
 *
 * Uses dimensions ["page", "date"] so each row has its own date.
 * Paginates with startRow to fetch all data (not capped at 1000).
 * Normalizes URLs to path-only with normalizeUrl().
 *
 * Daily job uses a 10-day rolling window to fill late-arriving GSC data.
 * Backfill mode processes months in 30-day blocks with reanudable cursor.
 */

import { prisma } from "@/lib/db";
import { google } from "googleapis";
import { getServiceOAuth2Client } from "@/lib/google-oauth";
import { normalizeUrl } from "@/lib/plan/plan-bridge";

export interface PageMetricsJobData {
  clientId: string;
  days?: number;
  months?: number; // For backfill: how many months back (max 16)
  backfillCursor?: string; // ISO date string — resume from this date
}

export interface PageMetricsResult {
  siteId: string;
  rowsWritten: number;
  daysProcessed: number;
  source: string;
  error?: string;
  lastDataDate?: string; // ISO date of most recent data written
}

const PAGE_SIZE = 25000; // GSC max per request

/**
 * Formats a Date to YYYY-MM-DD in America/Los_Angeles timezone (GSC's timezone).
 */
function toGscDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

export async function runPageMetricsProcessor(
  data: PageMetricsJobData,
): Promise<PageMetricsResult> {
  const { clientId } = data;

  const site = await prisma.site.findFirst({
    where: {
      client: { id: clientId, status: "ACTIVE", services: { has: "seo" } },
      gscProperty: { not: null },
    },
    select: { id: true, gscProperty: true, ga4Property: true, url: true, clientId: true },
  });

  if (!site?.gscProperty) {
    console.log(`[page-metrics] ${clientId}: no GSC property, skipping`);
    await logSourceRun(clientId, "gsc_pages", "not_connected", 0);
    return { siteId: "", rowsWritten: 0, daysProcessed: 0, source: "gsc" };
  }

  const auth = await getServiceOAuth2Client();
  if (!auth) {
    console.warn(`[page-metrics] ${clientId}: no service OAuth client`);
    await logSourceRun(clientId, "gsc_pages", "failed", 0, undefined, "No service OAuth client");
    return { siteId: site.id, rowsWritten: 0, daysProcessed: 0, source: "gsc" };
  }

  // Date range: 10-day rolling window (GSC data lags 2-4 days)
  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() - 2);
  const days = data.days ?? 10; // Default to 10-day window
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days + 1);

  const startStr = toGscDate(startDate);
  const endStr = toGscDate(endDate);

  console.log(`[page-metrics] ${clientId}: fetching GSC page×date ${startStr} → ${endStr}`);

  const sc = google.webmasters({ version: "v3", auth });
  let startRow = 0;
  let rowsWritten = 0;
  let hasMore = true;
  let lastDataDate: string | undefined;

  try {
    while (hasMore) {
      const { data: gscData } = await sc.searchanalytics.query({
        siteUrl: site.gscProperty,
        requestBody: {
          startDate: startStr,
          endDate: endStr,
          dimensions: ["page", "date"],
          rowLimit: PAGE_SIZE,
          startRow,
        },
      });

      const rows = gscData.rows ?? [];
      if (rows.length === 0) break;

      for (const row of rows) {
        const rawPage = row.keys?.[0] ?? "";
        const rawDate = row.keys?.[1] ?? "";
        if (!rawPage || !rawDate) continue;

        const url = normalizeUrl(rawPage);
        const date = new Date(rawDate + "T00:00:00Z");

        await prisma.pageMetric.upsert({
          where: {
            siteId_url_date_source: { siteId: site.id, url, date, source: "gsc" },
          },
          update: {
            clicks: row.clicks ?? 0,
            impressions: row.impressions ?? 0,
            ctr: parseFloat(((row.ctr ?? 0) * 100).toFixed(2)),
            position: parseFloat((row.position ?? 0).toFixed(1)),
          },
          create: {
            siteId: site.id,
            url,
            date,
            source: "gsc",
            clicks: row.clicks ?? 0,
            impressions: row.impressions ?? 0,
            ctr: parseFloat(((row.ctr ?? 0) * 100).toFixed(2)),
            position: parseFloat((row.position ?? 0).toFixed(1)),
          },
        });
        rowsWritten++;

        if (!lastDataDate || rawDate > lastDataDate) lastDataDate = rawDate;
      }

      startRow += rows.length;
      hasMore = rows.length === PAGE_SIZE;
      if (hasMore) {
        console.log(`[page-metrics] ${clientId}: page ${Math.floor(startRow / PAGE_SIZE) + 1} (${startRow} rows so far)`);
      }
    }

    // Check for empty unexpected: if we got 0 rows but the site had data last week
    if (rowsWritten === 0) {
      const recentData = await prisma.pageMetric.findFirst({
        where: {
          siteId: site.id,
          source: "gsc",
          date: { gte: new Date(now.getTime() - 14 * 86400000) },
        },
        select: { id: true },
      });

      if (recentData) {
        console.warn(`[page-metrics] ${clientId}: 0 rows but had recent data — empty_unexpected`);
        await logSourceRun(clientId, "gsc_pages", "empty_unexpected", 0, lastDataDate);
      } else {
        await logSourceRun(clientId, "gsc_pages", "ok", 0, lastDataDate);
      }
    } else {
      await logSourceRun(clientId, "gsc_pages", "ok", rowsWritten, lastDataDate);
    }
  } catch (gscErr) {
    const msg = (gscErr as Error).message ?? String(gscErr);
    const isPermission = msg.includes("403") || msg.includes("forbidden") || msg.includes("permission") || msg.includes("User does not have");
    console.error(`[page-metrics] ${clientId}: GSC error: ${msg}`);

    await logSourceRun(clientId, "gsc_pages", "failed", 0, undefined, msg.slice(0, 300));

    const client = await prisma.client.findFirst({
      where: { sites: { some: { id: site.id } } },
      select: { id: true },
    });
    if (client) {
      await prisma.insight.upsert({
        where: { id: `gsc-access-${site.id}` },
        update: {
          description: `GSC error: ${msg.slice(0, 300)}`,
          generatedAt: new Date(),
        },
        create: {
          id: `gsc-access-${site.id}`,
          clientId: client.id,
          type: "WARNING",
          severity: "high",
          title: isPermission
            ? "La cuenta no tiene acceso a esta propiedad de GSC"
            : "Error al obtener datos de GSC",
          description: `GSC error: ${msg.slice(0, 300)}`,
          suggestedAction: isPermission
            ? "Verificar que la cuenta de servicio tenga permisos de lectura en Search Console para esta propiedad."
            : "Revisar la configuración de la propiedad GSC del sitio.",
          affectedUrls: [],
          affectedKeywords: [],
        },
      });
    }
    return { siteId: site.id, rowsWritten: 0, daysProcessed: days, source: "gsc", error: msg.slice(0, 200) };
  }

  // ── GSC Queries (QueryMetric) ──────────────────────────────────────────────
  let queryRowsWritten = 0;
  try {
    queryRowsWritten = await syncQueryMetrics(sc, site.id, site.gscProperty!, startStr, endStr);
    await logSourceRun(clientId, "gsc_queries", queryRowsWritten > 0 ? "ok" : "empty_unexpected", queryRowsWritten, lastDataDate);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.warn(`[page-metrics] ${clientId}: query sync failed: ${msg}`);
    await logSourceRun(clientId, "gsc_queries", "failed", 0, undefined, msg.slice(0, 300));
  }

  // ── GA4 (per-day per-page via date + pagePath dimensions) ──────────────────
  if (site.ga4Property) {
    try {
      const { GoogleAnalytics4Provider } = await import("@/server/providers/google-analytics-4");
      const ga4 = new GoogleAnalytics4Provider(auth);

      // Try per-day data with date + pagePath dimensions
      const ga4Pages = await ga4.getPagesMetricsDaily(site.ga4Property, startStr, endStr);

      if (ga4Pages.length > 0) {
        for (const gp of ga4Pages) {
          const pagePath = gp.page.startsWith("/") ? gp.page : `/${gp.page}`;
          const url = normalizeUrl(pagePath);
          if (!url) continue;

          const date = new Date(gp.date + "T00:00:00Z");

          await prisma.pageMetric.upsert({
            where: {
              siteId_url_date_source: { siteId: site.id, url, date, source: "ga4" },
            },
            update: {
              sessions: gp.sessions,
              conversions: gp.conversions,
              bounceRate: gp.bounceRate,
            },
            create: {
              siteId: site.id,
              url,
              date,
              source: "ga4",
              sessions: gp.sessions,
              conversions: gp.conversions,
              bounceRate: gp.bounceRate,
            },
          });
          rowsWritten++;
        }
        await logSourceRun(clientId, "ga4", "ok", ga4Pages.length, lastDataDate);
      } else {
        // Fallback: aggregated (old behavior)
        const ga4PagesAgg = await ga4.getPagesMetrics(site.ga4Property, startStr, endStr);
        const batchDate = endDate;

        for (const gp of ga4PagesAgg) {
          const pagePath = gp.page.startsWith("/") ? gp.page : `/${gp.page}`;
          const url = normalizeUrl(pagePath);
          if (!url) continue;

          await prisma.pageMetric.upsert({
            where: {
              siteId_url_date_source: { siteId: site.id, url, date: batchDate, source: "ga4" },
            },
            update: {
              sessions: gp.sessions,
              conversions: gp.conversions,
              bounceRate: gp.bounceRate,
            },
            create: {
              siteId: site.id,
              url,
              date: batchDate,
              source: "ga4",
              sessions: gp.sessions,
              conversions: gp.conversions,
              bounceRate: gp.bounceRate,
            },
          });
          rowsWritten++;
        }
        await logSourceRun(clientId, "ga4", ga4PagesAgg.length > 0 ? "ok" : "empty_unexpected", ga4PagesAgg.length, lastDataDate);
      }
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      console.warn(`[page-metrics] ${clientId}: GA4 failed: ${msg}`);
      await logSourceRun(clientId, "ga4", "failed", 0, undefined, msg.slice(0, 300));
    }
  } else {
    await logSourceRun(clientId, "ga4", "not_connected", 0);
  }

  console.log(`[page-metrics] ${clientId}: wrote ${rowsWritten} page rows + ${queryRowsWritten} query rows (${days}d, ${startStr}→${endStr})`);
  return { siteId: site.id, rowsWritten, daysProcessed: days, source: "gsc+ga4", lastDataDate };
}

// ─── QueryMetric sync ────────────────────────────────────────────────────────

async function syncQueryMetrics(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sc: any,
  siteId: string,
  gscProperty: string,
  startStr: string,
  endStr: string,
): Promise<number> {
  let startRow = 0;
  let rowsWritten = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: gscData } = await sc.searchanalytics.query({
      siteUrl: gscProperty,
      requestBody: {
        startDate: startStr,
        endDate: endStr,
        dimensions: ["query", "page", "date"],
        rowLimit: PAGE_SIZE,
        startRow,
      },
    });

    const rows = gscData.rows ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const query = row.keys?.[0] ?? "";
      const page = row.keys?.[1] ?? "";
      const rawDate = row.keys?.[2] ?? "";
      if (!query || !rawDate) continue;

      const date = new Date(rawDate + "T00:00:00Z");
      const normalizedPage = page ? normalizeUrl(page) : null;

      await prisma.queryMetric.upsert({
        where: {
          siteId_query_page_date: {
            siteId,
            query,
            page: normalizedPage ?? "",
            date,
          },
        },
        update: {
          clicks: row.clicks ?? 0,
          impressions: row.impressions ?? 0,
          ctr: parseFloat(((row.ctr ?? 0) * 100).toFixed(2)),
          position: parseFloat((row.position ?? 0).toFixed(1)),
        },
        create: {
          siteId,
          query,
          page: normalizedPage ?? "",
          date,
          clicks: row.clicks ?? 0,
          impressions: row.impressions ?? 0,
          ctr: parseFloat(((row.ctr ?? 0) * 100).toFixed(2)),
          position: parseFloat((row.position ?? 0).toFixed(1)),
        },
      });
      rowsWritten++;
    }

    startRow += rows.length;
    hasMore = rows.length === PAGE_SIZE;
  }

  return rowsWritten;
}

// ─── DataSourceRun logging ───────────────────────────────────────────────────

async function logSourceRun(
  clientId: string,
  source: string,
  status: string,
  rows: number,
  lastDataDate?: string,
  error?: string,
): Promise<void> {
  try {
    await prisma.dataSourceRun.create({
      data: {
        source,
        clientId,
        status,
        rows,
        lastDataDate: lastDataDate ? new Date(lastDataDate + "T00:00:00Z") : null,
        error: error ?? null,
        finishedAt: new Date(),
      },
    });
  } catch {
    // Non-critical — don't fail the job
  }
}
