/**
 * Ejecuta el AEO probe aislado para un cliente (sin escribir a BD).
 *
 * Uso:
 *   tsx scripts/trigger-aeo-probe.ts <clientId>
 *
 * Imprime el reporte en consola para debug rápido.
 */

import { prisma } from "../src/lib/db";
import { probeAeo } from "../src/server/crawler/aeo-prober";
import { buildAeoReport } from "../src/lib/aeo-readiness";

const clientId = process.argv[2];

if (!clientId) {
  console.error("Uso: tsx scripts/trigger-aeo-probe.ts <clientId>");
  process.exit(1);
}

async function main() {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      domain: true,
      sites: { take: 1, select: { url: true } },
    },
  });

  if (!client) {
    console.error(`Cliente no encontrado: ${clientId}`);
    process.exit(1);
  }

  const siteUrl = client.sites[0]?.url ?? client.domain;
  const domain = siteUrl.startsWith("http")
    ? new URL(siteUrl).hostname
    : siteUrl;

  console.log(`\nAEO Probe para: ${client.name}`);
  console.log(`Dominio: ${domain}\n`);

  const start = Date.now();
  const probeResult = await probeAeo(domain, []);
  const report = buildAeoReport(probeResult);
  const elapsed = Date.now() - start;

  console.log(`Score AEO: ${report.score}/100\n`);
  console.log("─".repeat(60));

  for (const check of report.checks) {
    const icon =
      check.status === "pass" ? "✓"
      : check.status === "fail" ? "✗"
      : check.status === "warn" ? "⚠"
      : "○";

    const color =
      check.status === "pass" ? "\x1b[32m"
      : check.status === "fail" ? "\x1b[31m"
      : check.status === "warn" ? "\x1b[33m"
      : "\x1b[90m";

    console.log(`${color}${icon}\x1b[0m  ${check.title}`);
    console.log(`   ${check.detail}`);
    if (check.status === "fail" || check.status === "warn") {
      console.log(`   \x1b[90mFix: ${check.fix}\x1b[0m`);
    }
    console.log();
  }

  console.log("─".repeat(60));
  console.log(`Completado en ${elapsed}ms`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
