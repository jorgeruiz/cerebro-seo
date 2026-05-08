/**
 * DataForSEO Validation Script
 *
 * Llama a la API SERP Live de DataForSEO para las 15 keywords de 3 clientes reales.
 * Genera validation-report.md en la raíz del proyecto.
 * Loggea en ApiUsage si la BD está disponible; si no, solo imprime advertencia.
 *
 * Uso: npx tsx scripts/validate-dataforseo.ts
 * Costo estimado: ~$0.030 USD (15 queries × $0.002)
 */

import { writeFileSync } from "fs";
import { join } from "path";

// ─── Config ───────────────────────────────────────────────────────────────────

const DFS_BASE_URL = "https://api.dataforseo.com/v3";

interface ValidationEntry {
  cliente: string;
  domain: string;
  keywords: string[];
}

const VALIDATION_SET: ValidationEntry[] = [
  {
    cliente: "Molino Azteca",
    domain: "molinoazteca.com",
    keywords: [
      "venta de cafe para oficinas",
      "proveedor de cafeterias",
      "venta de insumos para cafe",
      "venta de cafe en monterrey",
      "proveedor de cafeterias en monterrey",
    ],
  },
  {
    cliente: "Respaldo Fiscal de Negocios",
    domain: "rfn.mx",
    keywords: [
      "despacho contable en monterrey",
      "expertos contables en monterrey",
      "despacho contable para negocios",
      "contabilidad e impuestos en monterrey",
      "declaracion de impuestos",
    ],
  },
  {
    cliente: "Quicsa",
    domain: "quicsa.com",
    keywords: [
      "quimicos para tratamiento de aguas",
      "mantenimiento a calderas",
      "mantenimiento a torres de enfriamiento",
      "tratamiento de aguas en monterrey",
      "venta de floculante monterrey",
    ],
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueryResult {
  keyword: string;
  position: number | "not_in_top_100";
  rankingUrl: string | "—";
  cost: number;
  durationMs: number;
  error?: string;
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

function getAuthHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error("DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set");
  }
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

async function serpLive(
  keyword: string,
  domain: string
): Promise<QueryResult> {
  const start = Date.now();

  let attempt = 0;
  const maxAttempts = 3;
  let lastError = "";

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const res = await fetch(`${DFS_BASE_URL}/serp/google/organic/live/regular`, {
        method: "POST",
        headers: {
          Authorization: getAuthHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          {
            keyword,
            location_code: 2484, // México
            language_code: "es",
            depth: 100,
          },
        ]),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 150)}`);
      }

      const durationMs = Date.now() - start;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = (await res.json()) as any;
      const cost: number =
        json.tasks?.reduce((s: number, t: { cost?: number }) => s + (t.cost ?? 0), 0) ?? 0;

      // Search for domain in organic results
      const items: Array<{ type: string; rank_absolute: number; url: string }> =
        json.tasks?.[0]?.result?.[0]?.items ?? [];

      for (const item of items) {
        if (item.type !== "organic") continue;
        try {
          const hostname = new URL(item.url).hostname.replace(/^www\./, "");
          const cleanDomain = domain.replace(/^www\./, "").toLowerCase();
          if (hostname.toLowerCase() === cleanDomain) {
            return {
              keyword,
              position: item.rank_absolute,
              rankingUrl: item.url,
              cost,
              durationMs,
            };
          }
        } catch {
          // invalid URL, skip
        }
      }

      // Domain not found in top 100
      return { keyword, position: "not_in_top_100", rankingUrl: "—", cost, durationMs };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts) {
        const delay = Math.pow(2, attempt) * 1000;
        console.error(`  Attempt ${attempt} failed for "${keyword}", retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  return {
    keyword,
    position: "not_in_top_100",
    rankingUrl: "—",
    cost: 0,
    durationMs: Date.now() - start,
    error: lastError,
  };
}

// ─── ApiUsage logging (optional) ─────────────────────────────────────────────

async function tryLogApiUsage(endpoint: string, cost: number): Promise<void> {
  try {
    const { prisma } = await import("../src/lib/db.js");
    const { Decimal } = await import("@prisma/client/runtime/library");
    await prisma.apiUsage.create({
      data: {
        provider: "dataforseo",
        endpoint,
        cost: new Decimal(cost.toFixed(6)),
        clientId: null,
      },
    });
  } catch {
    // BD no disponible — no bloquea el script
  }
}

// ─── Report generation ────────────────────────────────────────────────────────

function formatTable(results: QueryResult[]): string {
  const rows = results.map((r) => {
    const pos = r.error ? `ERROR: ${r.error.slice(0, 40)}` : String(r.position);
    const url =
      typeof r.rankingUrl === "string" && r.rankingUrl.length > 60
        ? r.rankingUrl.slice(0, 57) + "..."
        : r.rankingUrl;
    return `| ${r.keyword} | ${pos} | ${url} | $${r.cost.toFixed(4)} | ${r.durationMs}ms |`;
  });
  return [
    "| Keyword | Posición DataForSEO | URL detectada | Costo | Tiempo |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const sessionStart = Date.now();
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   DataForSEO Validation — Cerebro SEO                ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`\nFecha: ${new Date().toISOString()}`);
  console.log("Queries: 15 (3 clientes × 5 keywords)\n");

  let totalCost = 0;
  let totalQueries = 0;
  const clientSections: string[] = [];

  for (const entry of VALIDATION_SET) {
    console.log(`\n▸ ${entry.cliente} / ${entry.domain}`);
    const results: QueryResult[] = [];

    for (const keyword of entry.keywords) {
      process.stdout.write(`  → "${keyword}" ... `);
      const result = await serpLive(keyword, entry.domain);
      results.push(result);

      const posLabel =
        result.error
          ? `ERROR`
          : result.position === "not_in_top_100"
          ? "not_in_top_100"
          : `#${result.position}`;

      console.log(`${posLabel} (${result.durationMs}ms, $${result.cost.toFixed(4)})`);
      totalCost += result.cost;
      totalQueries++;

      void tryLogApiUsage("serp/organic/live/validation", result.cost);

      // Small delay between queries to be polite
      await new Promise((r) => setTimeout(r, 300));
    }

    clientSections.push(`## ${entry.cliente} / ${entry.domain}\n\n${formatTable(results)}`);
  }

  const totalDurationSec = ((Date.now() - sessionStart) / 1000).toFixed(1);

  console.log("\n══════════════════════════════════════════════════════");
  console.log(`✓ Completado en ${totalDurationSec}s`);
  console.log(`✓ Queries ejecutadas: ${totalQueries}`);
  console.log(`✓ Costo total: $${totalCost.toFixed(4)} USD`);
  console.log("══════════════════════════════════════════════════════\n");

  // ── Generate report ──────────────────────────────────────────────────────

  const report = `# DataForSEO Validation Report

**Fecha:** ${new Date().toISOString()}
**Costo total:** $${totalCost.toFixed(4)} USD
**Tiempo total:** ${totalDurationSec} segundos
**Queries ejecutadas:** ${totalQueries}

${clientSections.join("\n\n")}

## Próximo paso

Compara estos resultados manualmente contra Google Search Console de cada cliente.
Si la mayoría de posiciones coincide con margen de ~5 posiciones, DataForSEO está
validado para Cerebro SEO. Si hay discrepancias grandes, revisar configuración de
country/language (actualmente MX / es) o evaluar provider alternativo.

### Columna "URL detectada"
Es la URL exacta que DataForSEO encontró rankeando para ese dominio. Útil para:
- Confirmar que es la URL correcta (no una página de baja calidad)
- Identificar canibalización si varias URLs compiten

### Columna "not_in_top_100"
El dominio no aparece en los primeros 100 resultados orgánicos para esa keyword
en México (es). No significa que no rankee globalmente.
`;

  const reportPath = join(process.cwd(), "validation-report.md");
  writeFileSync(reportPath, report, "utf-8");
  console.log(`📄 Reporte generado: ${reportPath}`);
  console.log("   (Este archivo está en .gitignore — no se commitea)\n");
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
