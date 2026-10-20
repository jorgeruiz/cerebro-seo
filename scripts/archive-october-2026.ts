/**
 * Script de limpieza — archiva todos los planes de octubre 2026.
 *
 * Ejecutar UNA VEZ en producción, después del deploy que incluye
 * la migración add-archived-plan-status:
 *
 *   DATABASE_URL="postgres://cerebro:...@76.13.121.6:5434/cerebro_seo?sslmode=disable" \
 *   npx tsx scripts/archive-october-2026.ts
 */

import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";

const MONTH = "2026-10";
const REDIS_URL = process.env.REDIS_URL ?? "";

const prisma = new PrismaClient();

async function main() {
  // 1. Find all October plans
  const plans = await prisma.monthlyPlan.findMany({
    where: { month: MONTH },
    include: { client: { select: { name: true, cerebroClientId: true } } },
  });

  console.log(`Found ${plans.length} plans for ${MONTH}:`);
  for (const p of plans) {
    console.log(`  ${p.client.name} — ${p.status} — ${p.id}`);
  }

  const toArchive = plans.filter((p) => p.status !== "PUBLISHED");
  const alreadyPublished = plans.filter((p) => p.status === "PUBLISHED");

  if (alreadyPublished.length > 0) {
    console.log(`\n⚠️  Skipping ${alreadyPublished.length} PUBLISHED plan(s) — already in production.`);
  }

  if (toArchive.length === 0) {
    console.log("Nothing to archive.");
    return;
  }

  // 2. Archive plans
  const result = await prisma.monthlyPlan.updateMany({
    where: {
      id: { in: toArchive.map((p) => p.id) },
      status: { not: "PUBLISHED" },
    },
    data: { status: "ARCHIVED" },
  });
  console.log(`\n✅ Archived ${result.count} plans.`);

  // 3. Invalidate Redis caches (capabilities + site profiles)
  if (REDIS_URL) {
    const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.connect();

    const clientIds = plans.map((p) => p.client.cerebroClientId).filter(Boolean) as string[];
    const siteIds   = plans.map((p) => p.clientId);

    const keys = [
      ...clientIds.map((id) => `wp:caps:${id}`),
      ...clientIds.map((id) => `wp:profile:${id}`),
      ...siteIds.map((id)   => `wp:caps:${id}`),
      ...siteIds.map((id)   => `wp:profile:${id}`),
    ];

    const unique = Array.from(new Set(keys));
    if (unique.length > 0) {
      const deleted = await redis.del(...unique);
      console.log(`🗑️  Invalidated ${deleted} Redis cache key(s).`);
    }

    await redis.quit();
  } else {
    console.log("⚠️  REDIS_URL not set — skipping cache invalidation.");
  }

  console.log("\nDone.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
