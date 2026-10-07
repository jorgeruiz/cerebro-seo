/**
 * Runs the unified analysis for a client and prints the result.
 * Usage: npx tsx scripts/test-analysis.ts <clientId>
 */
import { generateClientAnalysis } from "../src/lib/claude-analysis";

const clientId = process.argv[2] ?? "cmqq7l1h400362m55huny8l40"; // Quicsa default

async function main() {
  console.log(`Running unified analysis for client ${clientId}...`);
  const start = Date.now();

  const { analysis, analysisId } = await generateClientAnalysis(clientId, "test-s2b");
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n=== RESULTADO (${elapsed}s) ===\n`);
  console.log(`ID: ${analysisId}`);
  console.log(`\nRESUMEN: ${analysis.resumenEjecutivo}`);
  console.log(`\nOPORTUNIDADES (${analysis.oportunidades?.length ?? 0}):`);
  for (const o of analysis.oportunidades ?? []) {
    console.log(`  [${o.impacto}] ${o.titulo}: ${o.accion}`);
  }
  console.log(`\nRIESGOS (${analysis.riesgos?.length ?? 0}):`);
  for (const r of analysis.riesgos ?? []) {
    console.log(`  [${r.urgencia}] ${r.titulo}`);
  }
  console.log(`\nRECOMENDACIONES (${analysis.recomendaciones?.length ?? 0}):`);
  for (const r of analysis.recomendaciones ?? []) {
    console.log(`  - ${r}`);
  }
  console.log(`\nCANDIDATAS (${analysis.candidatas?.length ?? 0}):`);
  for (const c of analysis.candidatas ?? []) {
    console.log(`  [${c.priority}] ${c.kind}/${c.mode} "${c.titulo}" (${c.effort}, ${c.fuente})`);
    if (c.keywordObjetivo) console.log(`      kw: ${c.keywordObjetivo}`);
    if (c.urlObjetivo) console.log(`      url: ${c.urlObjetivo}`);
    console.log(`      → ${c.justificacion}`);
  }

  console.log(`\nCONCLUSIÓN: ${analysis.conclusionEstrategica}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
