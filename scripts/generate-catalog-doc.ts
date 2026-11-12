#!/usr/bin/env npx tsx
/**
 * Genera docs/catalogo-tareas.md desde src/lib/plan/task-catalog.ts
 *
 * Este documento es GENERADO — no editar manualmente.
 * Para cambios, editar task-catalog.ts y correr este script.
 *
 * USO:
 *   npx tsx scripts/generate-catalog-doc.ts
 */

import { CATALOG, DEPRECATED_ALIASES, WORD_RANGES, OTHER_CONFIDENCE_THRESHOLD } from "../src/lib/plan/task-catalog";

const lines: string[] = [
  "# Catálogo de Tareas — Cerebro SEO",
  "",
  "> ⚠️ GENERADO AUTOMÁTICAMENTE desde `src/lib/plan/task-catalog.ts`.",
  "> No editar manualmente. Correr `npx tsx scripts/generate-catalog-doc.ts` para regenerar.",
  "",
  `Fecha de generación: ${new Date().toISOString().slice(0, 10)}`,
  `Total: ${CATALOG.length} actionTypes`,
  `Umbral de confianza para other: ${OTHER_CONFIDENCE_THRESHOLD}`,
  `Rangos de palabras: informacional ${WORD_RANGES.informational.join("–")}, AEO ${WORD_RANGES.short_answer_aeo.join("–")}, landing ${WORD_RANGES.landing.join("–")}`,
  "",
  "---",
  "",
];

for (const entry of CATALOG) {
  const wpMode = entry.modes.WORDPRESS;
  const nxMode = entry.modes.NEXTJS;

  lines.push(`## ${entry.actionType}`);
  lines.push("");
  lines.push(`| Campo | Valor |`);
  lines.push(`|---|---|`);
  lines.push(`| **Clase** | ${entry.class} |`);
  lines.push(`| **Categoría** | ${entry.category} |`);
  lines.push(`| **WP modo** | ${wpMode.mode}${wpMode.condition ? ` (requiere ${wpMode.condition})` : ""}${wpMode.fallbackMode ? ` → fallback ${wpMode.fallbackMode}` : ""} |`);
  lines.push(`| **Next.js modo** | ${nxMode.mode} |`);
  lines.push(`| **Complejidad** | ${entry.complexity} |`);
  lines.push(`| **Riesgo** | ${entry.risk} |`);
  if (entry.wordRange) lines.push(`| **Palabras** | ${entry.wordRange[0]}–${entry.wordRange[1]} |`);
  lines.push(`| **Gates** | ${entry.gates.join(", ") || "—"} |`);
  lines.push("");

  // Steps
  lines.push("**Pasos WordPress:**");
  for (const step of entry.steps.WORDPRESS) {
    const cap = step.requiredCapability ? ` (cap: ${step.requiredCapability})` : "";
    const fb = step.fallback ? ` → fallback: ${step.fallback.kind}` : "";
    lines.push(`- ${step.type === "AI" ? "IA" : "HM"}: ${step.title} (\`${step.kind}\`${cap}${fb})`);
  }
  lines.push("");

  lines.push("**Pasos Next.js:**");
  for (const step of entry.steps.NEXTJS) {
    lines.push(`- ${step.type === "AI" ? "IA" : "HM"}: ${step.title} (\`${step.kind}\`)`);
  }
  lines.push("");

  // Signals
  if (entry.signals.length > 0) {
    lines.push(`**Señales:** ${entry.signals.join(" · ")}`);
  }
  if (entry.negativeSignals.length > 0) {
    lines.push(`**Señales negativas:** ${entry.negativeSignals.join(" · ")}`);
  }
  lines.push("");

  // Acceptance
  lines.push("**Aceptación:**");
  for (const a of entry.acceptance) {
    lines.push(`- ${a}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
}

// Aliases
lines.push("## Aliases deprecados");
lines.push("");
lines.push("| Alias | → Canónico | Nota |");
lines.push("|---|---|---|");
for (const [alias, target] of Object.entries(DEPRECATED_ALIASES)) {
  lines.push(`| \`${alias}\` | ${target ? `\`${target}\`` : "*(requiere contexto)*"} | ${target === null ? "update_post → refresh_content si es blog, else other" : ""} |`);
}
lines.push("");

const output = lines.join("\n");

const fs = require("fs");
const path = require("path");
const outPath = path.join(__dirname, "..", "docs", "catalogo-tareas.md");
fs.writeFileSync(outPath, output, "utf-8");
console.log(`✅ Generado: ${outPath} (${CATALOG.length} entradas)`);
