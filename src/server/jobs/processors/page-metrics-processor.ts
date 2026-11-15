/**
 * Page Metrics Processor — fetches GSC page data and writes to PageMetric.
 *
 * For each active site with GSC:
 *   1. Call GSC Search Analytics API with dimensions ["page", "date"]
 *   2. Upsert rows into PageMetric (source = "gsc")
 *   3. Optionally fetch GA4 per-page data (sessions, conversions)
 *
 * Normalizes URLs with normalizeUrl() before storing.
 */

import { prisma } from "@/lib/db";
import { getServiceOAuth2Client } from "@/lib/google-oauth";
import { GoogleSearchConsoleProvider } from "@/server/providers/google-search-console";
import { normalizeUrl } from "@/lib/plan/plan-bridge";

export interface PageMetricsJobData {
  clientId: string;
  /** Backfill: number of days to fetch (default 1 for daily, 90 for backfill) */
  days?: number;
}

export interface PageMetricsResult {
  siteId: string;
  rowsWritten: number;
  daysProcessed: number;
  source: string;
}

export async function runPageMetricsProcessor(
  data: PageMetricsJobData,
): Promise<PageMetricsResult> {
  const { clientId, days = 1 } = data;

  // Find the site with GSC property
  const site = await prisma.site.findFirst({
    where: {
      client: { id: clientId, status: "ACTIVE", services: { has: "seo" } },
      gscProperty: { not: null },
    },
    select: { id: true, gscProperty: true, ga4Property: true, url: true },
  });

  if (!site?.gscProperty) {
    console.log(`[page-metrics] ${clientId}: no GSC property configured, skipping`);
    return { siteId: "", rowsWritten: 0, daysProcessed: 0, source: "gsc" };
  }

  // Get OAuth client
  const auth = await getServiceOAuth2Client();
  if (!auth) {
    console.warn(`[page-metrics] ${clientId}: no service OAuth client available`);
    return { siteId: site.id, rowsWritten: 0, daysProcessed: 0, source: "gsc" };
  }

  const gsc = new GoogleSearchConsoleProvider(auth);

  // Date range: last N days (GSC data is ~2 days behind)
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 2); // GSC delay
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  console.log(`[page-metrics] ${clientId}: fetching GSC pages ${startStr} → ${endStr}`);

  // Fetch pages data from GSC
  const pages = await gsc.getPages({
    siteUrl: site.gscProperty,
    startDate: startStr,
    endDate: endStr,
    rowLimit: 1000,
  });

  // Write to PageMetric
  let rowsWritten = 0;
  const batchDate = endDate; // Use end date as the metric date for daily

  for (const page of pages) {
    const url = normalizeUrl(page.page);
    if (!url) continue;

    await prisma.pageMetric.upsert({
      where: {
        siteId_url_date_source: {
          siteId: site.id,
          url,
          date: batchDate,
          source: "gsc",
        },
      },
      update: {
        clicks: page.clicks,
        impressions: page.impressions,
        ctr: page.ctr,
        position: page.position,
      },
      create: {
        siteId: site.id,
        url,
        date: batchDate,
        source: "gsc",
        clicks: page.clicks,
        impressions: page.impressions,
        ctr: page.ctr,
        position: page.position,
      },
    });
    rowsWritten++;
  }

  // GA4: fetch per-page sessions + conversions if available
  if (site.ga4Property) {
    try {
      const { GoogleAnalytics4Provider } = await import("@/server/providers/google-analytics-4");
      const ga4 = new GoogleAnalytics4Provider(auth);
      const ga4Pages = await ga4.getPagesMetrics(site.ga4Property, startStr, endStr);

      for (const gp of ga4Pages) {
        const url = normalizeUrl(gp.page.startsWith("/") ? `${site.url}${gp.page}` : gp.page);
        if (!url) continue;

        await prisma.pageMetric.upsert({
          where: {
            siteId_url_date_source: {
              siteId: site.id,
              url,
              date: batchDate,
              source: "ga4",
            },
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
      console.warn(`[page-metrics] ${clientId}: GA4 fetch failed: ${(err as Error).message}`);
    }
  }

  console.log(`[page-metrics] ${clientId}: wrote ${rowsWritten} rows (${days}d)`);
  return { siteId: site.id, rowsWritten, daysProcessed: days, source: "gsc+ga4" };
}
