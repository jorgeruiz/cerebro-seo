/**
 * Package Detection Processor — detects installed packages for Next.js sites.
 *
 * For each active Next.js site with SEO, runs detect() for each active package.
 * If installed, upserts SitePackage with INSTALLED status.
 */

import { prisma } from "@/lib/db";
import { PACKAGE_REGISTRY } from "@/lib/plan/packages";

export async function runPackageDetectProcessor(): Promise<{
  sitesChecked: number;
  packagesDetected: number;
}> {
  const sites = await prisma.site.findMany({
    where: {
      platform: "NEXTJS",
      githubRepo: { not: null },
      client: { status: "ACTIVE", services: { has: "seo" } },
    },
    select: { id: true, githubRepo: true, defaultBranch: true },
  });

  let packagesDetected = 0;

  for (const site of sites) {
    if (!site.githubRepo) continue;

    for (const pkg of PACKAGE_REGISTRY) {
      if (pkg.version === "0") continue;
      if (!pkg.platforms.includes("NEXTJS")) continue;

      try {
        const detection = await pkg.detect({
          siteId: site.id,
          githubRepo: site.githubRepo,
          defaultBranch: site.defaultBranch,
        });

        if (detection.installed) {
          await prisma.sitePackage.upsert({
            where: { siteId_packageId: { siteId: site.id, packageId: pkg.id } },
            update: { status: "INSTALLED", version: detection.version ?? pkg.version },
            create: { siteId: site.id, packageId: pkg.id, status: "INSTALLED", version: detection.version ?? pkg.version },
          });
          packagesDetected++;
          console.log(`[package-detect] ${site.githubRepo}: ${pkg.id} = INSTALLED`);
        }
      } catch (err) {
        console.warn(`[package-detect] ${site.githubRepo}: ${pkg.id} error: ${(err as Error).message}`);
      }
    }
  }

  console.log(`[package-detect] checked ${sites.length} sites, detected ${packagesDetected} packages`);
  return { sitesChecked: sites.length, packagesDetected };
}
