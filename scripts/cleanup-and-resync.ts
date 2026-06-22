/**
 * Limpieza de clientes duplicados + resync limpio desde Notion.
 *
 * ANTES DE EJECUTAR:
 *   1. pg_dump de seguridad:
 *      docker exec apps_cerebro-db.1.<ID> pg_dump -U cerebro cerebro_seo > backup_cerebro_seo_$(date +%Y%m%d).sql
 *
 *   2. Detener el worker de sync (o poner la app en mantenimiento)
 *
 * Ejecutar:
 *   DATABASE_URL="postgresql://cerebro:cerebro@localhost:5432/cerebro_seo" \
 *   npx tsx scripts/cleanup-and-resync.ts
 *
 * Qué hace:
 *   1. Borra TODAS las filas de tablas hijas (FK a Client) — en orden correcto.
 *   2. Borra TODOS los Clients.
 *   3. Resync limpio desde Notion (lista blanca: Activo + En Pausa, upsert por cerebroClientId).
 *   4. Verifica: cero duplicados, count correcto.
 */
import { PrismaClient, SeoPlan, ClientStatus } from "@prisma/client";
import { getClientsFromNotion } from "../src/lib/notion-direct";

const prisma = new PrismaClient();

const ESTADO_MAP: Record<string, ClientStatus> = {
  "Activo": ClientStatus.ACTIVE,
  "En Pausa": ClientStatus.PAUSED,
};

async function main() {
  // ──────────────────────────────────────────────────────────────────────────
  // FASE 1: Limpieza
  // ──────────────────────────────────────────────────────────────────────────

  console.log("═══ FASE 1: Limpieza de tablas ═══\n");

  // Tablas hijas que referencian Client (orden: hijas más profundas primero)
  // KeywordRanking → Keyword → Client (necesita borrar rankings antes que keywords)
  // Task, Hypothesis → MonthlyCycle → Client
  // AuditIssue → Audit → Site → Client (Audit.clientId es nullable, pero Site.clientId no)
  // PageMetric → Site → Client

  const deletions = [
    // Nivel 3 (más profundo)
    { name: "KeywordRanking", fn: () => prisma.keywordRanking.deleteMany({}) },
    { name: "Task", fn: () => prisma.task.deleteMany({}) },
    { name: "Hypothesis (from cycles)", fn: () => prisma.hypothesis.deleteMany({}) },
    { name: "AuditIssue", fn: () => prisma.auditIssue.deleteMany({}) },
    { name: "PageMetric", fn: () => prisma.pageMetric.deleteMany({}) },

    // Nivel 2
    { name: "MonthlyCycle", fn: () => prisma.monthlyCycle.deleteMany({}) },
    { name: "Keyword", fn: () => prisma.keyword.deleteMany({}) },
    { name: "Audit", fn: () => prisma.audit.deleteMany({}) },
    { name: "Site", fn: () => prisma.site.deleteMany({}) },

    // Nivel 1 (FK directa a Client)
    { name: "Insight", fn: () => prisma.insight.deleteMany({}) },
    { name: "TimelineEvent", fn: () => prisma.timelineEvent.deleteMany({}) },
    { name: "Backlink", fn: () => prisma.backlink.deleteMany({}) },
    { name: "BacklinkSnapshot", fn: () => prisma.backlinkSnapshot.deleteMany({}) },
    { name: "Competitor", fn: () => prisma.competitor.deleteMany({}) },
    { name: "CompetitorSnapshot", fn: () => prisma.competitorSnapshot.deleteMany({}) },
    { name: "CompetitorKeywordGap", fn: () => prisma.competitorKeywordGap.deleteMany({}) },
    { name: "AiSearchVisibility", fn: () => prisma.aiSearchVisibility.deleteMany({}) },
    { name: "ClientAnalysis", fn: () => prisma.clientAnalysis.deleteMany({}) },
    { name: "MonthlyReport", fn: () => prisma.monthlyReport.deleteMany({}) },
    { name: "ContentPlan", fn: () => prisma.contentPlan.deleteMany({}) },
    { name: "AeoResearch", fn: () => prisma.aeoResearch.deleteMany({}) },
    { name: "NextStepPlan", fn: () => prisma.nextStepPlan.deleteMany({}) },
    { name: "ClientUser", fn: () => prisma.clientUser.deleteMany({}) },

    // Cliente
    { name: "Client", fn: () => prisma.client.deleteMany({}) },
  ];

  for (const { name, fn } of deletions) {
    const result = await fn();
    console.log(`  ✓ ${name}: ${result.count} borrados`);
  }

  console.log("");

  // ──────────────────────────────────────────────────────────────────────────
  // FASE 2: Resync desde Notion
  // ──────────────────────────────────────────────────────────────────────────

  console.log("═══ FASE 2: Resync desde Notion (lista blanca: Activo + En Pausa) ═══\n");

  const clients = await getClientsFromNotion();

  if (clients.length === 0) {
    console.error("⚠️  Notion devolvió 0 clientes. Verificar la integración y los filtros.");
    return;
  }

  console.log(`  Notion devolvió ${clients.length} clientes\n`);

  for (const client of clients) {
    const status = ESTADO_MAP[client.estado] ?? ClientStatus.PAUSED;

    const created = await prisma.client.create({
      data: {
        cerebroClientId: client.notionPageId,
        name: client.name,
        domain: client.domain,
        plan: SeoPlan.PRO,
        status,
        services: client.services,
      },
    });

    // Site asociado
    const siteUrl = client.domain.startsWith("http")
      ? client.domain
      : `https://${client.domain}`;

    await prisma.site.create({
      data: {
        clientId: created.id,
        url: siteUrl,
        gscProperty: client.gscProperty ?? undefined,
        ga4Property: client.ga4PropertyId ?? undefined,
      },
    });

    console.log(`  ✓ ${client.name} (${client.domain}) [${client.estado}] → ${created.id}`);
  }

  console.log("");

  // ──────────────────────────────────────────────────────────────────────────
  // FASE 3: Verificación
  // ──────────────────────────────────────────────────────────────────────────

  console.log("═══ FASE 3: Verificación ═══\n");

  const totalClients = await prisma.client.count();
  const distinctCerebro = await prisma.client.groupBy({
    by: ["cerebroClientId"],
    _count: true,
  });
  const duplicates = distinctCerebro.filter((g) => g._count > 1);
  const activeCount = await prisma.client.count({ where: { status: ClientStatus.ACTIVE } });
  const pausedCount = await prisma.client.count({ where: { status: ClientStatus.PAUSED } });

  console.log(`  Total clientes: ${totalClients}`);
  console.log(`  cerebroClientId distintos: ${distinctCerebro.length}`);
  console.log(`  Duplicados: ${duplicates.length}`);
  console.log(`  Activos: ${activeCount}`);
  console.log(`  En Pausa: ${pausedCount}`);

  if (duplicates.length > 0) {
    console.error("\n  ❌ HAY DUPLICADOS:");
    for (const d of duplicates) {
      console.error(`    cerebroClientId=${d.cerebroClientId} → ${d._count} registros`);
    }
  } else {
    console.log("\n  ✅ Cero duplicados. Limpieza exitosa.");
  }

  if (totalClients === clients.length) {
    console.log(`  ✅ Count coincide con Notion (${totalClients}).`);
  } else {
    console.error(`  ❌ Count no coincide: BD=${totalClients}, Notion=${clients.length}`);
  }
}

main()
  .catch((err) => {
    console.error("Error en cleanup:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
