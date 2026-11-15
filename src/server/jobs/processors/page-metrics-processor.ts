/**
 * Page Metrics Processor — fetches GSC page×date data and writes to PageMetric.
 *
 * Uses dimensions ["page", "date"] so each row has its own date.
 * Paginates with startRow to fetch all data (not capped at 1000).
 * Normalizes URLs to path-only with normalizeUrl().
 */

import { prisma } from "@/lib/db";
import { google } from "googleapis";
import { getServiceOAuth2Client } from "@/lib/google-oauth";
import { normalizeUrl } from "@/lib/plan/plan-bridge";

export interface PageMetricsJobData {
  clientId: string;
  days?: number;
}

export interface PageMetricsResult {
  siteId: string;
  rowsWritten: number;
  daysProcessed: number;
  source: string;
  error?: string;
}

const PAGE_SIZE = 5000; // GSC max per request is 25000, but 5000 is safer

export async function runPageMetricsProcessor(
  data: PageMetricsJobData,
): Promise<PageMetricsResult> {
  const { clientId, days = 1 } = data;

  const site = await prisma.site.findFirst({
    where: {
      client: { id: clientId, status: "ACTIVE", services: { has: "seo" } },
      gscProperty: { not: null },
    },
    select: { id: true, gscProperty: true, ga4Property: true, url: true },
  });

  if (!site?.gscProperty) {
    console.log(`[page-metrics] ${clientId}: no GSC property, skipping`);
    return { siteId: "", rowsWritten: 0, daysProcessed: 0, source: "gsc" };
  }

  const auth = await getServiceOAuth2Client();
  if (!auth) {
    console.warn(`[page-metrics] ${clientId}: no service OAuth client`);
    return { siteId: site.id, rowsWritten: 0, daysProcessed: 0, source: "gsc" };
  }

  // Date range (GSC data is ~2 days behind)
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 2);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  console.log(`[page-metrics] ${clientId}: fetching GSC page×date ${startStr} → ${endStr}`);

  // Fetch ALL rows with pagination using dimensions ["page", "date"]
  const sc = google.webmasters({ version: "v3", auth });
  let startRow = 0;
  let rowsWritten = 0;
  let hasMore = true;

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
      const rawDate = row.keys?.[1] ?? ""; // YYYY-MM-DD
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
    }

    startRow += rows.length;
    hasMore = rows.length === PAGE_SIZE;
    if (hasMore) {
      console.log(`[page-metrics] ${clientId}: page ${Math.floor(startRow / PAGE_SIZE) + 1} (${startRow} rows so far)`);
    }
  }
  } catch (gscErr) {
    const msg = (gscErr as Error).message ?? String(gscErr);
    const isPermission = msg.includes("403") || msg.includes("forbidden") || msg.includes("permission") || msg.includes("User does not have");
    console.error(`[page-metrics] ${clientId}: GSC error: ${msg}`);

    // Save as Insight so it's visible in the client dashboard
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

  // GA4: fetch per-page sessions + conversions (aggregated for the period)
  if (site.ga4Property) {
    try {
      const { GoogleAnalytics4Provider } = await import("@/server/providers/google-analytics-4");
      const ga4 = new GoogleAnalytics4Provider(auth);
      const ga4Pages = await ga4.getPagesMetrics(site.ga4Property, startStr, endStr);
      const batchDate = endDate; // GA4 doesn't give per-day per-page easily

      for (const gp of ga4Pages) {
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
    } catch (err) {
      console.warn(`[page-metrics] ${clientId}: GA4 failed: ${(err as Error).message}`);
    }
  }

  console.log(`[page-metrics] ${clientId}: wrote ${rowsWritten} rows (${days}d, ${startStr}→${endStr})`);
  return { siteId: site.id, rowsWritten, daysProcessed: days, source: "gsc+ga4" };
}
