import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("anti-cannibalization rules", () => {
  it("analysis SYSTEM_PROMPT includes anti-cannibalization rule", () => {
    const content = readFileSync(
      join(__dirname, "..", "claude-analysis.ts"),
      "utf-8"
    );
    expect(content).toContain("ANTI-CANIBALIZACIÓN");
    expect(content).toContain("OPTIMIZAR la existente");
    expect(content).toContain("misma keyword");
  });

  it("decomposer SYSTEM_PROMPT includes anti-cannibalization rule", () => {
    const content = readFileSync(
      join(__dirname, "..", "..", "server", "jobs", "processors", "task-decomposer.ts"),
      "utf-8"
    );
    expect(content).toContain("ANTI-CANIBALIZACIÓN");
    expect(content).toContain("OPTIMIZAR la página existente");
    expect(content).toContain("rutas existentes");
  });

  it("decomposer gathers site-map from repo context", () => {
    const content = readFileSync(
      join(__dirname, "..", "..", "server", "jobs", "processors", "task-decomposer.ts"),
      "utf-8"
    );
    // gatherRepoContext should include site-map.md
    expect(content).toContain("site-map.md");
  });
});
