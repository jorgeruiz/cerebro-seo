import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

describe("add-to-plan infrastructure", () => {
  it("PlanTask schema has sourceRef field", () => {
    const schema = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf-8");
    expect(schema).toContain("sourceRef");
    expect(schema).toContain("Json?");
  });

  it("analysis feeds current plan tasks to avoid duplicates", () => {
    const source = readFileSync(join(ROOT, "src", "lib", "claude-analysis.ts"), "utf-8");
    expect(source).toContain("currentPlan");
    expect(source).toContain("NO proponer duplicados");
  });

  it("decomposer includes sourceRef snapshot in context", () => {
    const source = readFileSync(join(ROOT, "src", "server", "jobs", "processors", "task-decomposer.ts"), "utf-8");
    expect(source).toContain("sourceRef");
    expect(source).toContain("IMPACTO ESPERADO");
  });

  it("add-to-plan action has deduplication by sourceRef", () => {
    const source = readFileSync(join(ROOT, "src", "app", "(admin)", "clientes", "[id]", "add-to-plan-action.ts"), "utf-8");
    expect(source).toContain("isDuplicate");
    expect(source).toContain("sourceRef.module");
    expect(source).toContain("decomposeQueue");
  });
});
