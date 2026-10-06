/**
 * Detecta la plataforma de producción de cada sitio con servicio SEO.
 * Compara con Site.framework (Notion) para detectar migraciones.
 *
 * Uso:
 *   npx tsx scripts/detect-site-platforms.ts
 *   npx tsx scripts/detect-site-platforms.ts --dry-run
 */

import { PrismaClient } from "@prisma/client";
import { detectPlatform } from "../src/lib/site-platform";

const prisma = new PrismaClient();

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const sites = await prisma.site.findMany({
    where: {
      client: { status: "ACTIVE", services: { has: "seo" } },
    },
    include: { client: { select: { name: true } } },
  });

  console.log(`🔍 Detectando plataforma de ${sites.length} sitio(s)...`);
  if (dryRun) console.log("   Modo --dry-run: no se escribirá en BD.\n");
  else console.log("");

  console.log("| Cliente | URL | Framework (Notion) | Platform (producción) | Señales | Confianza |");
  console.log("|---|---|---|---|---|---|");

  for (const site of sites) {
    const result = await detectPlatform(site.url, site.framework);

    const icon =
      result.platform === "NEXTJS" ? "✅" :
      result.platform === "MIGRACION" ? "🔄" :
      result.platform === "WORDPRESS" ? "🔵" : "⚪";

    console.log(
      `| ${site.client.name} | ${site.url} | ${site.framework ?? "null"} | ${icon} ${result.platform} | ${result.signals.join(", ") || "-"} | ${result.confidence} |`
    );

    if (!dryRun) {
      await prisma.site.update({
        where: { id: site.id },
        data: {
          platform: result.platform,
          platformDetectedAt: new Date(),
        },
      });
    }
  }

  console.log(`\n${dryRun ? "🔍 Dry run completado." : "✅ Plataformas guardadas en BD."}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
