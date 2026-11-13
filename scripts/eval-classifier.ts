/**
 * Run classification evaluation against validated fixtures.
 *
 * Usage (in Easypanel console):
 *   ANTHROPIC_API_KEY="..." npx tsx scripts/eval-classifier.ts [--mode=quick|full] [--file=path]
 *
 * --mode=quick  Signal-only (free, ~65% accuracy)
 * --mode=full   LLM classifier (~$0.01/fixture, ~92% accuracy)
 * --file=path   Path to fixtures JSON (default: scripts/eval/classification-fixtures.json)
 *
 * For --mode=full, shows estimated cost and asks for confirmation if >$1 USD.
 */

import { readFileSync } from "fs";
import { join } from "path";
import * as readline from "readline";

interface Fixture {
  id: number;
  title: string;
  objective: string;
  platform: string;
  expected: string;
  status: string;
}

const mode = process.argv.includes("--mode=full") ? "full" : "quick";
const fileArg = process.argv.find((a) => a.startsWith("--file="));
const fixturesPath = fileArg
  ? fileArg.replace("--file=", "")
  : join(__dirname, "eval", "classification-fixtures.json");

async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} (y/n): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}

async function main() {
  const fixtures: Fixture[] = JSON.parse(readFileSync(fixturesPath, "utf-8"));
  console.log(`\n=== Classification Evaluation (mode=${mode}) ===`);
  console.log(`Fixtures: ${fixtures.length} from ${fixturesPath}\n`);

  if (mode === "full") {
    const estimatedCost = fixtures.length * 0.01;
    console.log(`Costo estimado: ~$${estimatedCost.toFixed(2)} USD (${fixtures.length} x $0.01/llamada)`);

    if (estimatedCost > 1.0) {
      const ok = await confirm(`El costo supera $1 USD. ¿Continuar?`);
      if (!ok) {
        console.log("Cancelado.");
        process.exit(0);
      }
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("ERROR: ANTHROPIC_API_KEY requerida para --mode=full");
      process.exit(1);
    }
  }

  // Delegate to the eval script
  const evalPath = join(__dirname, "eval", "run-classification-eval.ts");
  console.log(`Ejecutando: ${evalPath} --mode=${mode}\n`);

  // Re-run with the correct args
  const { execSync } = await import("child_process");
  execSync(`npx tsx "${evalPath}" --mode=${mode}`, {
    stdio: "inherit",
    env: { ...process.env },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
