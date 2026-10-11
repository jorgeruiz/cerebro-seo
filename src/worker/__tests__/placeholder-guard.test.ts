import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { scanPlaceholders, formatPlaceholderHits } from "../placeholder-guard";

describe("placeholder-guard", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pg-test-"));
    execSync("git init", { cwd: dir });
    execSync("git config user.name test", { cwd: dir });
    execSync("git config user.email test@test.com", { cwd: dir });
    // Initial commit so HEAD exists
    writeFileSync(join(dir, "README.md"), "# test");
    execSync("git add -A && git commit -m init", { cwd: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects [COMPLETAR markers in new files", () => {
    writeFileSync(
      join(dir, "page.mdx"),
      `---
titulo: Test
---
## Tipos de chillers
[COMPLETAR: modelos y marcas específicas que Quicsa atiende]

## Proceso
[COMPLETAR: proceso específico de Quicsa]
`
    );

    const hits = scanPlaceholders(dir);

    expect(hits.length).toBe(2);
    expect(hits[0].file).toBe("page.mdx");
    expect(hits[0].text).toContain("[COMPLETAR: modelos");
    expect(hits[0].line).toBeGreaterThan(0);
    expect(hits[1].text).toContain("[COMPLETAR: proceso");
  });

  it("returns empty array when no markers exist", () => {
    writeFileSync(join(dir, "clean.tsx"), "export default function Page() { return <h1>OK</h1>; }");

    const hits = scanPlaceholders(dir);

    expect(hits).toHaveLength(0);
  });

  it("ignores removed lines (only checks additions)", () => {
    // First commit a file WITH placeholder
    writeFileSync(join(dir, "old.md"), "Texto con [COMPLETAR: algo] aquí");
    execSync("git add -A && git commit -m 'add old'", { cwd: dir });

    // Now remove the placeholder
    writeFileSync(join(dir, "old.md"), "Texto sin marcadores aquí");

    const hits = scanPlaceholders(dir);

    expect(hits).toHaveLength(0);
  });

  it("detects markers in subdirectories", () => {
    mkdirSync(join(dir, "content", "landings"), { recursive: true });
    writeFileSync(
      join(dir, "content", "landings", "chillers.mdx"),
      "Tipos: [COMPLETAR: capacidades en TR/BTU]"
    );

    const hits = scanPlaceholders(dir);

    expect(hits.length).toBe(1);
    expect(hits[0].file).toBe("content/landings/chillers.mdx");
  });

  it("formats hits with file:line", () => {
    const hits = [
      { file: "content/page.mdx", line: 12, text: "[COMPLETAR: modelos de chillers]" },
      { file: "content/page.mdx", line: 25, text: "[COMPLETAR: proceso de Quicsa]" },
    ];

    const output = formatPlaceholderHits(hits);

    expect(output).toContain("2 lugar(es)");
    expect(output).toContain("content/page.mdx:12");
    expect(output).toContain("content/page.mdx:25");
  });

  it("returns empty string for no hits", () => {
    expect(formatPlaceholderHits([])).toBe("");
  });
});
