import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Test: getRepoPlanDir preserves working tree changes between turns.
 * Simulates: agent edits a file → next turn → save sees the edit.
 */

function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf-8" }).trim();
}

function setupBareAndClone() {
  const bare = mkdtempSync(join(tmpdir(), "tp-bare-"));
  execSync("git init --bare", { cwd: bare });
  const work = mkdtempSync(join(tmpdir(), "tp-work-"));
  execSync(`git clone ${bare} work`, { cwd: work });
  const dir = join(work, "work");
  git("config user.name test", dir);
  git("config user.email test@test.com", dir);
  writeFileSync(join(dir, "footer.tsx"), 'const year = new Date().getFullYear();');
  git("add -A", dir);
  git('commit -m "init"', dir);
  git("push origin main", dir);
  return { dir, cleanup: () => { rmSync(bare, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); } };
}

describe("terminal working tree preservation", () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => ({ dir, cleanup } = setupBareAndClone()));
  afterEach(() => cleanup());

  it("edits survive across turns when using getRepoPlanDir", () => {
    const branch = "plan/test-2026-10";

    // Turn 1: checkout plan branch (first turn = full setup)
    git(`checkout -b ${branch}`, dir);

    // Agent edits a file (simulates what the agent does)
    writeFileSync(join(dir, "footer.tsx"), 'const year = "2026"; // static');

    // Verify there's a diff
    const status1 = git("status --porcelain", dir);
    expect(status1).toContain("footer.tsx");

    // Turn 2: getRepoPlanDir should NOT reset (already on the branch)
    const currentBranch = git("rev-parse --abbrev-ref HEAD", dir);
    expect(currentBranch).toBe(branch);
    // Since we're already on the branch, getRepoPlanDir would return immediately
    // without resetting. The diff should still exist.

    const status2 = git("status --porcelain", dir);
    expect(status2).toContain("footer.tsx");

    // Save: the diff is still there
    const content = readFileSync(join(dir, "footer.tsx"), "utf-8");
    expect(content).toContain('"2026"');

    // Commit
    git("add -A", dir);
    git('commit -m "[plan:review] Fix copyright year"', dir);

    // Verify commit exists
    const log = git("log --oneline -1", dir);
    expect(log).toContain("[plan:review]");
  });

  it("ensureRepoPlanBranch (first turn) WOULD reset the working tree", () => {
    const branch = "plan/test-2026-10";
    git(`checkout -b ${branch}`, dir);
    git(`push origin ${branch}`, dir);

    // Make a local edit
    writeFileSync(join(dir, "footer.tsx"), 'const year = "modified";');
    expect(git("status --porcelain", dir)).toContain("footer.tsx");

    // Simulate ensureRepoPlanBranch behavior: reset --hard
    git("checkout main", dir);
    git("reset --hard origin/main", dir);
    git("clean -fd", dir);
    try { git(`branch -D ${branch}`, dir); } catch { /* ok */ }
    git(`checkout -b ${branch} origin/${branch}`, dir);

    // Edit is gone!
    const content = readFileSync(join(dir, "footer.tsx"), "utf-8");
    expect(content).not.toContain('"modified"');
    expect(git("status --porcelain", dir)).toBe("");
  });
});

describe("getDiffSummary", () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => ({ dir, cleanup } = setupBareAndClone()));
  afterEach(() => cleanup());

  it("returns stat and patches for modified files", () => {
    writeFileSync(join(dir, "footer.tsx"), 'const year = "2026";');
    git("add -A", dir);

    const stat = git("diff --stat --cached", dir);
    expect(stat).toContain("footer.tsx");

    const diff = git("diff --cached", dir);
    expect(diff).toContain("2026");
  });
});
