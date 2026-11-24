/**
 * PageSpeed Collector — weekly job that measures CWV for top pages.
 *
 * For each client: home + top 5 pages by GSC impressions, mobile + desktop.
 * Stores results in PageSpeedMetric. Handles 429 with backoff.
 */

import { prisma } from "@/lib/db";
import { runPageSpeed, type PageSpeedResult } from "@/server/providers/pagespeed";

export async function runPageSpeedCollector(clientId: string): Promise<{
  clientId: string;
  pagesChecked: number;
  errors: number;
}> {
  const site = await prisma.site.findFirst({
    where: {
      client: { id: clientId, status: "ACTIVE", services: { has: "seo" } },
    },
    select: { id: true, url: true },
  });

  if (!site?.url) {
    console.log(`[pagespeed] ${clientId}: no site URL, skipping`);
    await logSourceRun(clientId, "pagespeed", "not_connected", 0);
    return { clientId, pagesChecked: 0, errors: 0 };
  }

  // Get top 5 URLs by impressions from GSC data (last 28 days)
  const twentyEightDaysAgo = new Date(Date.now() - 28 * 86400000);
  const topPages = await prisma.pageMetric.groupBy({
    by: ["url"],
    where: {
      siteId: site.id,
      source: "gsc",
      date: { gte: twentyEightDaysAgo },
    },
    _sum: { impressions: true },
    orderBy: { _sum: { impressions: "desc" } },
    take: 5,
  });

  // Build URL list: home + top pages
  const baseUrl = site.url.replace(/\/$/, "");
  const homeUrl = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;
  const urlsToCheck = new Set<string>([homeUrl]);

  for (const page of topPages) {
    if (page.url && page.url !== "/") {
      const fullUrl = page.url.startsWith("http")
        ? page.url
        : `${homeUrl}${page.url.startsWith("/") ? "" : "/"}${page.url}`;
      urlsToCheck.add(fullUrl);
    }
  }

  // Limit to 6 URLs total
  const urls = Array.from(urlsToCheck).slice(0, 6);
  const strategies: Array<"mobile" | "desktop"> = ["mobile", "desktop"];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let pagesChecked = 0;
  let errors = 0;

  for (const url of urls) {
    for (const strategy of strategies) {
      try {
        const result = await runPageSpeedWithRetry(url, strategy);

        // Don't store if runtime error (score 0 from failed measurement)
        if (result.scores.performance === 0 && result.opportunities.length === 0) {
          console.warn(`[pagespeed] ${url} (${strategy}): likely failed measurement, skipping`);
          errors++;
          continue;
        }

        await prisma.pageSpeedMetric.upsert({
          where: {
            siteId_url_device_date: {
              siteId: site.id,
              url: normalizePageSpeedUrl(url, homeUrl),
              device: strategy,
              date: today,
            },
          },
          update: {
            score: result.scores.performance,
            lcp: result.cwv.lcp ?? null,
            inp: result.cwv.inp ?? result.cwv.tbt ?? null,
            cls: result.cwv.cls ?? null,
            fcp: result.cwv.fcp ?? null,
            ttfb: result.cwv.ttfb ?? null,
            fieldData: result.cwv.inp !== undefined
              ? { source: "field", inp: result.cwv.inp }
              : { source: "lab", tbt: result.cwv.tbt },
          },
          create: {
            siteId: site.id,
            url: normalizePageSpeedUrl(url, homeUrl),
            device: strategy,
            date: today,
            score: result.scores.performance,
            lcp: result.cwv.lcp ?? null,
            inp: result.cwv.inp ?? result.cwv.tbt ?? null,
            cls: result.cwv.cls ?? null,
            fcp: result.cwv.fcp ?? null,
            ttfb: result.cwv.ttfb ?? null,
            fieldData: result.cwv.inp !== undefined
              ? { source: "field", inp: result.cwv.inp }
              : { source: "lab", tbt: result.cwv.tbt },
          },
        });
        pagesChecked++;
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        console.error(`[pagespeed] ${url} (${strategy}): ${msg}`);
        errors++;
      }

      // Rate limit: 1 request per 2 seconds
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  await logSourceRun(
    clientId,
    "pagespeed",
    errors === urls.length * 2 ? "failed" : pagesChecked > 0 ? "ok" : "empty_unexpected",
    pagesChecked,
  );

  console.log(`[pagespeed] ${clientId}: ${pagesChecked} measurements, ${errors} errors`);
  return { clientId, pagesChecked, errors };
}

async function runPageSpeedWithRetry(
  url: string,
  strategy: "mobile" | "desktop",
  attempt = 1,
): Promise<PageSpeedResult> {
  try {
    return await runPageSpeed(url, strategy);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (msg.includes("429") && attempt < 3) {
      const delay = Math.pow(2, attempt) * 5000; // 10s, 20s
      console.warn(`[pagespeed] 429 on ${url}, retrying in ${delay / 1000}s`);
      await new Promise((r) => setTimeout(r, delay));
      return runPageSpeedWithRetry(url, strategy, attempt + 1);
    }
    throw err;
  }
}

function normalizePageSpeedUrl(url: string, homeUrl: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname || "/";
  } catch {
    return url.replace(homeUrl, "") || "/";
  }
}

async function logSourceRun(
  clientId: string,
  source: string,
  status: string,
  rows: number,
): Promise<void> {
  try {
    await prisma.dataSourceRun.create({
      data: {
        source,
        clientId,
        status,
        rows,
        finishedAt: new Date(),
      },
    });
  } catch { /* non-critical */ }
}
