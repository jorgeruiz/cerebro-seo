/**
 * Backfill PageMetric for all active SEO sites with GSC.
 *
 * Usage:
 *   npx tsx scripts/backfill-page-metrics.ts [--days=90] [--client=clientId]
 *
 * Fetches GSC page data for the last N days and writes to PageMetric.
 * Safe to re-run (upsert by siteId+url+date+source).
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const daysArg = process.argv.find((a) => a.startsWith("--days="));
  const clientArg = process.argv.find((a) => a.startsWith("--client="));
  const days = daysArg ? parseInt(daysArg.replace("--days=", ""), 10) : 90;
  const filterClient = clientArg ? clientArg.replace("--client=", "") : null;

  console.log(`\n=== PageMetric Backfill (${days} days) ===\n`);

  // Find all active SEO clients with GSC
  const clients = await prisma.client.findMany({
    where: {
      status: "ACTIVE",
      services: { has: "seo" },
      ...(filterClient ? { id: filterClient } : {}),
    },
    select: {
      id: true,
      name: true,
      sites: {
        where: { gscProperty: { not: null } },
        select: { id: true, gscProperty: true, url: true },
      },
    },
  });

  console.log(`Found ${clients.length} clients with GSC\n`);

  for (const client of clients) {
    const site = client.sites[0];
    if (!site) {
      console.log(`  ${client.name}: no site with GSC, skipping`);
      continue;
    }

    console.log(`  ${client.name} (${site.gscProperty}): backfilling ${days}d...`);

    try {
      // Import dynamically to avoid loading all deps at module level
      const { runPageMetricsProcessor } = await import("../src/server/jobs/processors/page-metrics-processor");
      const result = await runPageMetricsProcessor({
        clientId: client.id,
        days,
      });
      console.log(`    → ${result.rowsWritten} rows written`);
    } catch (err) {
      console.error(`    → ERROR: ${(err as Error).message}`);
    }
  }

  console.log("\nDone.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
