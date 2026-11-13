/**
 * Classification evaluation script.
 *
 * Modes:
 *   --mode=quick    Uses classifyTaskQuick (signal-only, no LLM, free)
 *   --mode=full     Uses classifyTask (LLM, costs ~$0.01/fixture)
 *
 * Fixtures:
 *   --file=path     Custom fixtures file (default: production-fixtures.json)
 *
 * Handles production fixture format:
 *   - Skips dudoso:true fixtures (excluded from metrics)
 *   - expected:"split" → accepts "other" or any valid type as correct
 *   - expectedStatus reported separately (pendiente de producción si no hay gates locales)
 *
 * Usage:
 *   npx tsx scripts/eval/run-classification-eval.ts --mode=quick
 *   npx tsx scripts/eval/run-classification-eval.ts --mode=full
 *   npx tsx scripts/eval/run-classification-eval.ts --mode=full --file=scripts/eval/classification-fixtures.json
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Fixture {
  id: number;
  title: string;
  objective: string;
  platform: string;
  expected: string;
  expectedStatus?: string;
  status: string;
  dudoso?: boolean;
  nota?: string;
  note?: string; // compat with old format
}

interface EvalResult {
  id: number;
  title: string;
  expected: string;
  predicted: string;
  confidence: number;
  correct: boolean;
  nota?: string;
  dudoso: boolean;
}

// ─── Load fixtures ──────────────────────────────────────────────────────────

const fileArg = process.argv.find((a) => a.startsWith("--file="));
const defaultFile = existsSync(join(__dirname, "production-fixtures.json"))
  ? "production-fixtures.json"
  : "classification-fixtures.json";
const fixturesPath = fileArg
  ? fileArg.replace("--file=", "")
  : join(__dirname, defaultFile);

const allFixtures: Fixture[] = JSON.parse(readFileSync(fixturesPath, "utf-8"));

const mode = process.argv.includes("--mode=full") ? "full" : "quick";

console.log(`\n=== Classification Evaluation (mode=${mode}) ===`);
console.log(`Fixtures file: ${fixturesPath}`);
console.log(`Total fixtures: ${allFixtures.length}`);

const dudosos = allFixtures.filter((f) => f.dudoso);
const evaluable = allFixtures.filter((f) => !f.dudoso);
console.log(`Evaluables: ${evaluable.length} (${dudosos.length} dudosos excluidos)\n`);

// ─── Correctness logic ──────────────────────────────────────────────────────

function isCorrect(expected: string, predicted: string): boolean {
  if (expected === predicted) return true;
  // "split" means the task should be divided — accept "other" (NEEDS_DEFINITION)
  // or any valid actionType (the classifier picks the dominant action)
  if (expected === "split" && (predicted === "other" || predicted !== "ERROR")) return true;
  return false;
}

// ─── Run evaluation ─────────────────────────────────────────────────────────

async function runEval(): Promise<void> {
  const results: EvalResult[] = [];

  if (mode === "quick") {
    const { classifyTaskQuick } = await import("../../src/lib/plan/classify-task");

    for (const f of allFixtures) {
      const { actionType, confidence } = classifyTaskQuick({
        title: f.title,
        objective: f.objective,
      });
      results.push({
        id: f.id,
        title: f.title,
        expected: f.expected,
        predicted: actionType,
        confidence,
        correct: isCorrect(f.expected, actionType),
        nota: f.nota ?? f.note,
        dudoso: !!f.dudoso,
      });
    }
  } else {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("ERROR: ANTHROPIC_API_KEY required for --mode=full");
      process.exit(1);
    }

    const { classifyTask } = await import("../../src/lib/plan/classify-task");

    for (const f of allFixtures) {
      try {
        const result = await classifyTask({
          title: f.title,
          objective: f.objective,
          platform: f.platform,
          existingActionType: null,
        });
        results.push({
          id: f.id,
          title: f.title,
          expected: f.expected,
          predicted: result.actionType,
          confidence: result.confidence,
          correct: isCorrect(f.expected, result.actionType),
          nota: f.nota ?? f.note,
          dudoso: !!f.dudoso,
        });
        await new Promise((r) => setTimeout(r, 100));
      } catch (err) {
        results.push({
          id: f.id,
          title: f.title,
          expected: f.expected,
          predicted: "ERROR",
          confidence: 0,
          correct: false,
          nota: `Error: ${(err as Error).message}`,
          dudoso: !!f.dudoso,
        });
      }
    }
  }

  // ─── Metrics (excluding dudosos) ──────────────────────────────────────

  const scored = results.filter((r) => !r.dudoso);
  const total = scored.length;
  const correct = scored.filter((r) => r.correct).length;
  const accuracy = total > 0 ? (correct / total * 100).toFixed(1) : "N/A";
  const otherCount = scored.filter((r) => r.predicted === "other").length;
  const otherRate = total > 0 ? (otherCount / total * 100).toFixed(1) : "N/A";

  // Per-actionType accuracy (excluding dudosos)
  const byType = new Map<string, { total: number; correct: number }>();
  for (const r of scored) {
    const entry = byType.get(r.expected) ?? { total: 0, correct: 0 };
    entry.total++;
    if (r.correct) entry.correct++;
    byType.set(r.expected, entry);
  }

  // ─── Print report ─────────────────────────────────────────────────────

  console.log("─── RESUMEN GLOBAL (sin dudosos) ────────────────────");
  console.log(`Precisión: ${correct}/${total} (${accuracy}%)`);
  console.log(`Tasa de "other": ${otherCount}/${total} (${otherRate}%)`);
  console.log(`Modo: ${mode}`);
  console.log();

  console.log("─── PRECISIÓN POR actionType ─────────────────────────");
  const sorted = Array.from(byType.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [type, { total: t, correct: c }] of sorted) {
    const pct = (c / t * 100).toFixed(0);
    const bar = c === t ? "\u2713" : `\u2717 (${c}/${t})`;
    console.log(`  ${type.padEnd(25)} ${pct.padStart(4)}%  ${bar}`);
  }
  console.log();

  // ─── Failed (excluding dudosos) ───────────────────────────────────────

  const failed = scored.filter((r) => !r.correct);
  if (failed.length > 0) {
    console.log("─── CASOS FALLIDOS ──────────────────────────────────");
    for (const f of failed) {
      console.log(`  #${f.id} "${f.title.slice(0, 60)}..."`);
      console.log(`     Expected: ${f.expected}  ->  Got: ${f.predicted} (conf=${f.confidence.toFixed(2)})`);
      if (f.nota) console.log(`     Nota: ${f.nota}`);
      console.log();
    }
  }

  // ─── Dudosos (informational only) ─────────────────────────────────────

  const dudosoResults = results.filter((r) => r.dudoso);
  if (dudosoResults.length > 0) {
    console.log("─── DUDOSOS (excluidos de métricas) ─────────────────");
    for (const d of dudosoResults) {
      const match = d.correct ? "OK" : "DIFF";
      console.log(`  #${d.id} [${match}] expected:${d.expected} got:${d.predicted} "${d.title.slice(0, 50)}..."`);
    }
    console.log();
  }

  // ─── expectedStatus (pendiente de producción) ─────────────────────────

  const withStatus = allFixtures.filter((f) => f.expectedStatus);
  if (withStatus.length > 0) {
    console.log("─── expectedStatus (requiere gates con datos reales) ─");
    console.log(`  ${withStatus.length} fixtures tienen expectedStatus.`);
    console.log("  Verificación pendiente de producción — gates requieren BD real.");
    console.log();
  }

  // ─── Confusion ────────────────────────────────────────────────────────

  const confusion = new Map<string, Map<string, number>>();
  for (const r of failed) {
    const outer = confusion.get(r.expected) ?? new Map<string, number>();
    outer.set(r.predicted, (outer.get(r.predicted) ?? 0) + 1);
    confusion.set(r.expected, outer);
  }
  if (confusion.size > 0) {
    console.log("─── CONFUSIONES FRECUENTES ──────────────────────────");
    Array.from(confusion.entries()).forEach(([expected, predictions]) => {
      Array.from(predictions.entries()).forEach(([predicted, count]) => {
        console.log(`  ${expected} -> ${predicted}: ${count}x`);
      });
    });
    console.log();
  }

  // ─── Save ─────────────────────────────────────────────────────────────

  const outPath = join(__dirname, `eval-results-${mode}.json`);
  writeFileSync(outPath, JSON.stringify({
    mode,
    date: new Date().toISOString(),
    fixturesFile: fixturesPath,
    totalFixtures: allFixtures.length,
    dudososExcluded: dudosos.length,
    evaluated: total,
    correct,
    accuracy: total > 0 ? parseFloat(accuracy as string) : 0,
    otherRate: total > 0 ? parseFloat(otherRate as string) : 0,
    byType: Object.fromEntries(sorted),
    failed: failed.map(({ id, title, expected, predicted, confidence, nota }) => ({
      id, title: title.slice(0, 80), expected, predicted, confidence, nota,
    })),
    expectedStatusPending: withStatus.length,
  }, null, 2));
  console.log(`Resultados guardados en: ${outPath}`);
}

runEval().catch((err) => {
  console.error("Eval failed:", err);
  process.exit(1);
});
