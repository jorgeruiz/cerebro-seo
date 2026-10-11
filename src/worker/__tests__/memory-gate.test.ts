import { describe, it, expect } from "vitest";
import { isMemoryComplete, type MemoryStatus } from "../memory-classifier";

describe("memory gate for AI/HYBRID tasks", () => {
  it("blocks when any memory file is ABSENT", () => {
    const status: MemoryStatus = {
      "site-spec": "FULL",
      "site-map": "FULL",
      "site-state": "FULL",
      "catalog-schemas": "ABSENT",
    };
    expect(isMemoryComplete(status)).toBe(false);
  });

  it("blocks when any memory file is TEMPLATE", () => {
    const status: MemoryStatus = {
      "site-spec": "TEMPLATE",
      "site-map": "FULL",
      "site-state": "FULL",
      "catalog-schemas": "FULL",
    };
    expect(isMemoryComplete(status)).toBe(false);
  });

  it("passes when all memory files are FULL", () => {
    const status: MemoryStatus = {
      "site-spec": "FULL",
      "site-map": "FULL",
      "site-state": "FULL",
      "catalog-schemas": "FULL",
    };
    expect(isMemoryComplete(status)).toBe(true);
  });

  it("task-processor checks both AI and HYBRID modes", async () => {
    // Verify the source code has the correct gate
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const source = readFileSync(
      join(__dirname, "..", "task-processor.ts"),
      "utf-8"
    );

    // Must check HYBRID in addition to AI
    expect(source).toContain('task.mode === "AI" || task.mode === "HYBRID"');
    expect(source).toContain("isMemoryComplete");
    expect(source).toContain("MEMORY_INCOMPLETE");
  });
});
