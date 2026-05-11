/**
 * Siembra los clientes SEO reales desde Notion.
 *
 * PRE-REQUISITO: compartir la BD "Clientes Actuales" (e489c63e-...) con la
 * integración de Notion (ID: 32b0a146-5e52-81f9-8509-0027c0a09cd7).
 *
 * Ejecutar:
 *   DATABASE_URL="postgresql://cerebro:cerebro@localhost:5432/cerebro_seo" \
 *   npx tsx scripts/seed-clients.ts
 */
import { PrismaClient, SeoPlan, ClientStatus } from "@prisma/client";
import { getClientsWithSeoActive } from "../src/lib/notion-direct";

const prisma = new PrismaClient();

async function main() {
  console.log("Leyendo clientes desde Notion...");
  const clients = await getClientsWithSeoActive();

  if (clients.length === 0) {
    console.log("⚠️  No se encontraron clientes. Verificar:");
    console.log("   1. La BD está compartida con la integración de Notion");
    console.log("   2. El filtro 'Estado = Activo' coincide con los valores reales");
    return;
  }

  console.log(`Encontrados ${clients.length} clientes:\n`);

  for (const client of clients) {
    console.log(`→ ${client.name} (${client.domain})`);

    const upserted = await prisma.client.upsert({
      where: { cerebroClientId: client.notionPageId },
      create: {
        cerebroClientId: client.notionPageId,
        name: client.name,
        domain: client.domain,
        plan: SeoPlan.PRO,
        status: ClientStatus.ACTIVE,
      },
      update: {
        name: client.name,
        domain: client.domain,
      },
    });

    // Site: find-or-create con update (sin unique constraint compuesto)
    const siteUrl = client.domain.startsWith("http")
      ? client.domain
      : `https://${client.domain}`;

    const existingSite = await prisma.site.findFirst({
      where: { clientId: upserted.id },
    });

    if (existingSite) {
      await prisma.site.update({
        where: { id: existingSite.id },
        data: {
          url: siteUrl,
          gscProperty: client.gscProperty ?? undefined,
          ga4Property: client.ga4PropertyId ?? undefined,
        },
      });
    } else {
      await prisma.site.create({
        data: {
          clientId: upserted.id,
          url: siteUrl,
          gscProperty: client.gscProperty ?? undefined,
          ga4Property: client.ga4PropertyId ?? undefined,
        },
      });
    }

    console.log(`   ✓ Client ID: ${upserted.id}`);
    console.log(`   ✓ GSC: ${client.gscProperty ?? "no configurado"}`);
    console.log(`   ✓ GA4: ${client.ga4PropertyId ?? "no configurado"}`);
  }

  console.log("\n✅ Seed completado.");
}

main()
  .catch((err) => {
    console.error("Error en seed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
