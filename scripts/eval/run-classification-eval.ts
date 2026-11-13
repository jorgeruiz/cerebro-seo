/**
 * Classification evaluation script.
 *
 * Modes:
 *   --mode=quick    Uses classifyTaskQuick (signal-only, no LLM, free)
 *   --mode=full     Uses classifyTask (LLM, costs ~$0.01/fixture)
 *
 * Usage:
 *   npx tsx scripts/eval/run-classification-eval.ts --mode=quick
 *   npx tsx scripts/eval/run-classification-eval.ts --mode=full
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Fixture {
  id: number;
  title: string;
  objective: string;
  platform: string;
  expected: string;
  status: string;
  note?: string;
}

interface EvalResult {
  id: number;
  title: string;
  expected: string;
  predicted: string;
  confidence: number;
  correct: boolean;
  note?: string;
}

// ─── Load fixtures ──────────────────────────────────────────────────────────

const fixturesPath = join(__dirname, "classification-fixtures.json");
const fixtures: Fixture[] = JSON.parse(readFileSync(fixturesPath, "utf-8"));

const mode = process.argv.includes("--mode=full") ? "full" : "quick";

console.log(`\n=== Classification Evaluation (mode=${mode}) ===`);
console.log(`Fixtures: ${fixtures.length}\n`);

// ─── Run evaluation ─────────────────────────────────────────────────────────

async function runEval(): Promise<void> {
  const results: EvalResult[] = [];

  if (mode === "quick") {
    // Import the quick classifier (signal-only, no LLM cost)
    const { classifyTaskQuick } = await import("../../src/lib/plan/classify-task");

    for (const f of fixtures) {
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
        correct: actionType === f.expected,
        note: f.note,
      });
    }
  } else {
    // Full LLM classifier — requires ANTHROPIC_API_KEY
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("ERROR: ANTHROPIC_API_KEY required for --mode=full");
      process.exit(1);
    }

    const { classifyTask } = await import("../../src/lib/plan/classify-task");

    for (const f of fixtures) {
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
          correct: result.actionType === f.expected,
          note: f.note,
        });
        // Rate limit: 100ms between LLM calls
        await new Promise((r) => setTimeout(r, 100));
      } catch (err) {
        results.push({
          id: f.id,
          title: f.title,
          expected: f.expected,
          predicted: "ERROR",
          confidence: 0,
          correct: false,
          note: `Error: ${(err as Error).message}`,
        });
      }
    }
  }

  // ─── Compute metrics ────────────────────────────────────────────────────

  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  const accuracy = (correct / total * 100).toFixed(1);
  const otherCount = results.filter((r) => r.predicted === "other").length;
  const otherRate = (otherCount / total * 100).toFixed(1);

  // Per-actionType accuracy
  const byType = new Map<string, { total: number; correct: number }>();
  for (const r of results) {
    const key = r.expected;
    const entry = byType.get(key) ?? { total: 0, correct: 0 };
    entry.total++;
    if (r.correct) entry.correct++;
    byType.set(key, entry);
  }

  // Confusion: predicted vs expected
  const confusion = new Map<string, Map<string, number>>();
  for (const r of results) {
    if (r.correct) continue;
    const key = `${r.expected} → ${r.predicted}`;
    const outer = confusion.get(r.expected) ?? new Map();
    outer.set(r.predicted, (outer.get(r.predicted) ?? 0) + 1);
    confusion.set(r.expected, outer);
  }

  // ─── Print report ───────────────────────────────────────────────────────

  console.log("─── RESUMEN GLOBAL ──────────────────────────────────");
  console.log(`Precisión global: ${correct}/${total} (${accuracy}%)`);
  console.log(`Tasa de "other": ${otherCount}/${total} (${otherRate}%)`);
  console.log(`Modo: ${mode}`);
  console.log();

  console.log("─── PRECISIÓN POR actionType ─────────────────────────");
  const sorted = Array.from(byType.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [type, { total: t, correct: c }] of sorted) {
    const pct = (c / t * 100).toFixed(0);
    const bar = c === t ? "✓" : `✗ (${c}/${t})`;
    console.log(`  ${type.padEnd(25)} ${pct.padStart(4)}%  ${bar}`);
  }
  console.log();

  // ─── Failed cases ───────────────────────────────────────────────────────

  const failed = results.filter((r) => !r.correct);
  if (failed.length > 0) {
    console.log("─── CASOS FALLIDOS ──────────────────────────────────");
    for (const f of failed) {
      console.log(`  #${f.id} "${f.title.slice(0, 60)}..."`);
      console.log(`     Expected: ${f.expected}  →  Got: ${f.predicted} (conf=${f.confidence.toFixed(2)})`);
      if (f.note) console.log(`     Nota: ${f.note}`);
      console.log();
    }
  }

  // ─── Confusion matrix ──────────────────────────────────────────────────

  if (confusion.size > 0) {
    console.log("─── CONFUSIONES FRECUENTES ──────────────────────────");
    Array.from(confusion.entries()).forEach(([expected, predictions]) => {
      Array.from(predictions.entries()).forEach(([predicted, count]) => {
        console.log(`  ${expected} → ${predicted}: ${count}x`);
      });
    });
    console.log();
  }

  // ─── Save results ───────────────────────────────────────────────────────

  const outPath = join(__dirname, `eval-results-${mode}.json`);
  writeFileSync(outPath, JSON.stringify({
    mode,
    date: new Date().toISOString(),
    total,
    correct,
    accuracy: parseFloat(accuracy),
    otherRate: parseFloat(otherRate),
    byType: Object.fromEntries(sorted),
    failed: failed.map(({ id, title, expected, predicted, confidence, note }) => ({
      id, title: title.slice(0, 80), expected, predicted, confidence, note,
    })),
  }, null, 2));
  console.log(`Resultados guardados en: ${outPath}`);
}

runEval().catch((err) => {
  console.error("Eval failed:", err);
  process.exit(1);
});
