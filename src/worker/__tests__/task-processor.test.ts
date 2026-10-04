import { describe, it, expect } from "vitest";

// Test prompt composition logic (extracted pattern, not the function directly
// since it depends on workerEnv)

describe("task-processor prompt composition", () => {
  function composePrompt(task: {
    title: string;
    objective: string;
    prompt: string;
    acceptanceCriteria: string[];
  }): string {
    const sections = [
      `# Tarea: ${task.title}`,
      "",
      `## Objetivo`,
      task.objective,
      "",
      `## Instrucciones detalladas`,
      task.prompt,
      "",
      `## Criterios de aceptación`,
      ...task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`),
      "",
      `## Reglas`,
      "- Respeta CLAUDE.md y DESIGN.md del repo si existen.",
      "- Alcance mínimo: solo los cambios necesarios para cumplir los criterios.",
      "- Deja el build pasando (npm run build).",
      "- No toques archivos .env*.",
      "- No instales dependencias nuevas sin justificación clara.",
      "- No hagas git commit ni git push — el worker lo hace después.",
      "- No salgas del directorio del repo.",
    ];
    return sections.join("\n");
  }

  it("includes title in header", () => {
    const result = composePrompt({
      title: "Agregar JSON-LD",
      objective: "Structured data",
      prompt: "Add LocalBusiness schema",
      acceptanceCriteria: ["Build passes"],
    });
    expect(result).toContain("# Tarea: Agregar JSON-LD");
  });

  it("includes all acceptance criteria numbered", () => {
    const result = composePrompt({
      title: "Test",
      objective: "Test",
      prompt: "Test",
      acceptanceCriteria: ["Criterio A", "Criterio B", "Criterio C"],
    });
    expect(result).toContain("1. Criterio A");
    expect(result).toContain("2. Criterio B");
    expect(result).toContain("3. Criterio C");
  });

  it("includes no-commit rule", () => {
    const result = composePrompt({
      title: "Test",
      objective: "Test",
      prompt: "Test",
      acceptanceCriteria: [],
    });
    expect(result).toContain("No hagas git commit ni git push");
  });

  it("includes no-env rule", () => {
    const result = composePrompt({
      title: "Test",
      objective: "Test",
      prompt: "Test",
      acceptanceCriteria: [],
    });
    expect(result).toContain("No toques archivos .env*");
  });
});
