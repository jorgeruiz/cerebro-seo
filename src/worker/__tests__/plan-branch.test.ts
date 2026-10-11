import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Integration tests for plan-branch git operations.
 * Uses real git repos (no mocks) to test branch reuse, merge conflicts, and revert.
 */

function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf-8" }).trim();
}

function setupBareAndClone() {
  // Create a "remote" bare repo
  const bare = mkdtempSync(join(tmpdir(), "plan-bare-"));
  execSync("git init --bare", { cwd: bare });

  // Clone it as the "working" repo (simulates ensureRepoPlanBranch)
  const work = mkdtempSync(join(tmpdir(), "plan-work-"));
  execSync(`git clone ${bare} work`, { cwd: work });
  const dir = join(work, "work");

  git("config user.name test", dir);
  git("config user.email test@test.com", dir);

  // Initial commit on main
  writeFileSync(join(dir, "README.md"), "# test");
  git("add -A", dir);
  git('commit -m "init"', dir);
  git("push origin main", dir);

  return { bare, work: dir, cleanup: () => { rmSync(bare, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); } };
}

describe("plan-branch git operations", () => {
  let _bare: string;
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ bare: _bare, work: dir, cleanup } = setupBareAndClone());
  });

  afterEach(() => {
    cleanup();
  });

  describe("branch reuse", () => {
    it("creates new branch if it doesn't exist", () => {
      const branch = "plan/test-2026-10";
      git(`checkout -b ${branch}`, dir);
      writeFileSync(join(dir, "task1.txt"), "hello");
      git("add -A", dir);
      git('commit -m "[task:abc12345] step 1"', dir);
      git(`push origin ${branch}`, dir);

      // Verify branch exists on remote
      const branches = git("branch -r", dir);
      expect(branches).toContain(`origin/${branch}`);
    });

    it("reuses existing remote branch without deleting it", () => {
      const branch = "plan/test-2026-10";

      // First: create branch with a commit
      git(`checkout -b ${branch}`, dir);
      writeFileSync(join(dir, "task1.txt"), "hello");
      git("add -A", dir);
      git('commit -m "[task:abc12345] step 1"', dir);
      git(`push origin ${branch}`, dir);
      const firstCommit = git("rev-parse HEAD", dir);

      // Switch back to main
      git("checkout main", dir);

      // Now simulate re-checkout (like ensureRepoPlanBranch would do)
      git(`checkout ${branch}`, dir);
      const afterReCheckout = git("rev-parse HEAD", dir);

      // The commit is still there
      expect(afterReCheckout).toBe(firstCommit);

      // Can add more commits
      writeFileSync(join(dir, "task2.txt"), "world");
      git("add -A", dir);
      git('commit -m "[task:def67890] step 2"', dir);
      git(`push origin ${branch}`, dir);

      // Both commits exist
      const log = git("log --oneline", dir);
      expect(log).toContain("[task:abc12345]");
      expect(log).toContain("[task:def67890]");
    });
  });

  describe("merge conflict detection", () => {
    it("detects conflict when merging main into plan", () => {
      const branch = "plan/test-2026-10";

      // Create plan branch with change
      git(`checkout -b ${branch}`, dir);
      writeFileSync(join(dir, "shared.txt"), "plan version");
      git("add -A", dir);
      git('commit -m "plan change"', dir);
      git(`push origin ${branch}`, dir);

      // Create conflicting change on main
      git("checkout main", dir);
      writeFileSync(join(dir, "shared.txt"), "main version");
      git("add -A", dir);
      git('commit -m "main change"', dir);
      git("push origin main", dir);

      // Switch back to plan branch and try merge
      git(`checkout ${branch}`, dir);
      git("fetch origin", dir);

      let hasConflict = false;
      try {
        execSync("git merge origin/main --no-edit", { cwd: dir, encoding: "utf-8" });
      } catch {
        hasConflict = true;
        // Abort the merge
        execSync("git merge --abort", { cwd: dir });
      }

      expect(hasConflict).toBe(true);
    });

    it("merges cleanly when no conflict", () => {
      const branch = "plan/test-2026-10";

      // Create plan branch with one file
      git(`checkout -b ${branch}`, dir);
      writeFileSync(join(dir, "plan-only.txt"), "plan file");
      git("add -A", dir);
      git('commit -m "plan file"', dir);
      git(`push origin ${branch}`, dir);

      // Add different file on main
      git("checkout main", dir);
      writeFileSync(join(dir, "main-only.txt"), "main file");
      git("add -A", dir);
      git('commit -m "main file"', dir);
      git("push origin main", dir);

      // Merge should be clean
      git(`checkout ${branch}`, dir);
      git("fetch origin", dir);
      const result = execSync("git merge origin/main --no-edit", { cwd: dir, encoding: "utf-8" });

      expect(result).toBeDefined();
      // Both files should exist
      const files = execSync("ls", { cwd: dir, encoding: "utf-8" });
      expect(files).toContain("plan-only.txt");
      expect(files).toContain("main-only.txt");
    });
  });

  describe("revert task commits", () => {
    it("reverts all commits for a specific task", () => {
      const branch = "plan/test-2026-10";
      git(`checkout -b ${branch}`, dir);

      // Task A commits
      writeFileSync(join(dir, "taskA.txt"), "task A content");
      git("add -A", dir);
      git('commit -m "[task:aaaaaaaa] step 1"', dir);

      // Task B commits
      writeFileSync(join(dir, "taskB.txt"), "task B content");
      git("add -A", dir);
      git('commit -m "[task:bbbbbbbb] step 1"', dir);

      // Task A second commit
      writeFileSync(join(dir, "taskA2.txt"), "task A more");
      git("add -A", dir);
      git('commit -m "[task:aaaaaaaa] step 2"', dir);

      git(`push origin ${branch}`, dir);

      // Revert task A
      const shas = git('log --oneline --fixed-strings --grep="[task:aaaaaaaa]" --format="%H"', dir)
        .split("\n")
        .filter(Boolean);

      expect(shas.length).toBe(2);

      // Revert in reverse order (newest first)
      for (const sha of shas) {
        execSync(`git revert ${sha} --no-edit`, { cwd: dir });
      }

      // Task A files should not exist, Task B should still be there
      const files = execSync("ls", { cwd: dir, encoding: "utf-8" });
      expect(files).not.toContain("taskA.txt");
      expect(files).not.toContain("taskA2.txt");
      expect(files).toContain("taskB.txt");
    });
  });

  describe("plan-level placeholder guard", () => {
    it("detects [COMPLETAR in plan branch diff vs main", () => {
      const branch = "plan/test-2026-10";
      git(`checkout -b ${branch}`, dir);

      writeFileSync(join(dir, "landing.mdx"), "Tipos: [COMPLETAR: marcas específicas]");
      git("add -A", dir);
      git('commit -m "[task:aaaaaaaa] landing"', dir);

      // Diff plan branch vs main
      const diff = git("diff origin/main...HEAD", dir);
      const hasPlaceholder = diff.includes("[COMPLETAR");

      expect(hasPlaceholder).toBe(true);
    });

    it("no false positive when main has placeholder but plan fixes it", () => {
      // Add placeholder on main
      writeFileSync(join(dir, "page.mdx"), "[COMPLETAR: algo]");
      git("add -A", dir);
      git('commit -m "add placeholder"', dir);
      git("push origin main", dir);

      const branch = "plan/test-2026-10";
      git(`checkout -b ${branch}`, dir);

      // Fix the placeholder in plan branch
      writeFileSync(join(dir, "page.mdx"), "Dato real aquí");
      git("add -A", dir);
      git('commit -m "[task:aaaaaaaa] fix placeholder"', dir);

      const diff = git("diff origin/main...HEAD", dir);
      // The diff should show removal of [COMPLETAR, not addition
      const addedLines = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
      const hasNewPlaceholder = addedLines.some((l) => l.includes("[COMPLETAR"));

      expect(hasNewPlaceholder).toBe(false);
    });
  });
});
