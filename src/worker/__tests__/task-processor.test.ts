import { describe, it, expect } from "vitest";

// ─── parseAgentResult (exported for testing) ─────────────────────────────────

interface AgentStructuredResult {
  summary: string;
  changedRoutes: string[];
  noChangeReason: string | null;
}

function parseAgentResult(text: string): AgentStructuredResult {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/\{[\s\S]*"summary"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
      return {
        summary: String(parsed.summary ?? ""),
        changedRoutes: Array.isArray(parsed.changedRoutes) ? parsed.changedRoutes : [],
        noChangeReason: parsed.noChangeReason ?? null,
      };
    } catch { /* fall through */ }
  }
  return { summary: text.slice(0, 2000), changedRoutes: [], noChangeReason: null };
}

describe("parseAgentResult", () => {
  it("parses JSON code block with changes", () => {
    const text = `I updated the meta tags.\n\n\`\`\`json\n{"summary":"Updated title and description on /servicios","changedRoutes":["/servicios","/contacto"],"noChangeReason":null}\n\`\`\``;
    const result = parseAgentResult(text);
    expect(result.summary).toBe("Updated title and description on /servicios");
    expect(result.changedRoutes).toEqual(["/servicios", "/contacto"]);
    expect(result.noChangeReason).toBeNull();
  });

  it("parses JSON code block with no changes", () => {
    const text = `\`\`\`json\n{"summary":"All meta tags are within limits","changedRoutes":[],"noChangeReason":"Title is 52 chars and description is 148 chars, both within limits."}\n\`\`\``;
    const result = parseAgentResult(text);
    expect(result.summary).toBe("All meta tags are within limits");
    expect(result.changedRoutes).toEqual([]);
    expect(result.noChangeReason).toBe("Title is 52 chars and description is 148 chars, both within limits.");
  });

  it("parses inline JSON without code fence", () => {
    const text = `{"summary":"Fixed title","changedRoutes":["/"],"noChangeReason":null}`;
    const result = parseAgentResult(text);
    expect(result.summary).toBe("Fixed title");
    expect(result.changedRoutes).toEqual(["/"]);
  });

  it("falls back to raw text when no JSON", () => {
    const text = "I reviewed the meta tags and everything looks good. No changes needed.";
    const result = parseAgentResult(text);
    expect(result.summary).toBe(text);
    expect(result.changedRoutes).toEqual([]);
    expect(result.noChangeReason).toBeNull();
  });

  it("handles malformed JSON gracefully", () => {
    const text = `\`\`\`json\n{broken json\n\`\`\``;
    const result = parseAgentResult(text);
    expect(result.summary).toBe(text.slice(0, 2000));
  });

  it("truncates very long text", () => {
    const text = "x".repeat(5000);
    const result = parseAgentResult(text);
    expect(result.summary.length).toBe(2000);
  });
});

// ─── composePrompt ───────────────────────────────────────────────────────────

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
