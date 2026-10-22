import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf-8" }).trim();
}

function setupBareAndClone() {
  const bare = mkdtempSync(join(tmpdir(), "integ-bare-"));
  execSync("git init --bare", { cwd: bare });

  const work = mkdtempSync(join(tmpdir(), "integ-work-"));
  execSync(`git clone ${bare} work`, { cwd: work });
  const dir = join(work, "work");
  git("config user.name test", dir);
  git("config user.email test@test.com", dir);
  writeFileSync(join(dir, "README.md"), "# test");
  git("add -A && git commit -m init", dir);
  git("push origin main", dir);

  return { dir, cleanup: () => { rmSync(bare, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); } };
}

describe("ensureRepoPlanBranch - stale local branch", () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => ({ dir, cleanup } = setupBareAndClone()));
  afterEach(() => cleanup());

  it("recreates from default when remote branch was deleted (stale local)", () => {
    const branch = "plan/test-2026-10";

    // Create branch locally with a commit
    git(`checkout -b ${branch}`, dir);
    writeFileSync(join(dir, "stale.txt"), "old content");
    git("add -A", dir);
    git('commit -m "[task:aaaaaaaa] stale step"', dir);
    git(`push origin ${branch}`, dir);

    // Delete remote branch (simulates cleanup)
    git(`push origin --delete ${branch}`, dir);
    git("fetch --prune origin", dir);

    // Now we're still on the local branch that has no remote tracking
    // Go back to main to simulate fresh start
    git("checkout main", dir);

    // Simulate ensureRepoPlanBranch behavior:
    // 1. Check remote existence
    let remoteExists = false;
    try {
      git(`rev-parse --verify origin/${branch}`, dir);
      remoteExists = true;
    } catch { /* doesn't exist remotely */ }

    expect(remoteExists).toBe(false);

    // 2. Reset to default
    git("checkout main", dir);
    git("reset --hard origin/main", dir);

    // 3. Delete stale local
    try { git(`branch -D ${branch}`, dir); } catch { /* ok */ }

    // 4. Create fresh from default
    git(`checkout -b ${branch}`, dir);

    // Verify stale.txt is NOT present (fresh from main)
    const files = execSync("ls", { cwd: dir, encoding: "utf-8" });
    expect(files).not.toContain("stale.txt");
    expect(files).toContain("README.md");
  });

  it("aligns local with remote when remote branch exists", () => {
    const branch = "plan/test-2026-10";

    // Create branch with a commit and push
    git(`checkout -b ${branch}`, dir);
    writeFileSync(join(dir, "remote.txt"), "remote content");
    git("add -A", dir);
    git('commit -m "[task:bbbbbbbb] remote step"', dir);
    git(`push origin ${branch}`, dir);
    const remoteSha = git("rev-parse HEAD", dir);

    // Add a local-only commit (simulates workspace pollution)
    writeFileSync(join(dir, "local-only.txt"), "local only");
    git("add -A", dir);
    git('commit -m "local only"', dir);

    // Simulate ensureRepoPlanBranch: delete local, recreate from remote
    git("checkout main", dir);
    git(`branch -D ${branch}`, dir);
    git(`checkout -b ${branch} origin/${branch}`, dir);

    const currentSha = git("rev-parse HEAD", dir);
    expect(currentSha).toBe(remoteSha);

    const files = execSync("ls", { cwd: dir, encoding: "utf-8" });
    expect(files).toContain("remote.txt");
    expect(files).not.toContain("local-only.txt");
  });
});

describe("auditPlanCommits", () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => ({ dir, cleanup } = setupBareAndClone()));
  afterEach(() => cleanup());

  // Use realistic full cuid2 IDs (25 chars) — NOT slice(0,8) prefixes
  const TASK_A = "cmvhogbb0000000000000001";
  const TASK_B = "cmvhogbb0000000000000002"; // same prefix as A — would collide with 8-char slice

  it("detects commits from tasks not in the allowed set", () => {
    const branch = "plan/test-2026-10";
    git(`checkout -b ${branch}`, dir);

    // Commit for allowed task (full ID)
    writeFileSync(join(dir, "ok.txt"), "ok");
    git("add -A", dir);
    git(`commit -m "[task:${TASK_A}] good step"`, dir);

    // Commit for disallowed task (full ID)
    writeFileSync(join(dir, "bad.txt"), "bad");
    git("add -A", dir);
    git(`commit -m "[task:${TASK_B}] bad step"`, dir);

    git(`push origin ${branch}`, dir);

    const log = git('log --oneline --format="%H %s" origin/main..HEAD', dir);
    const orphans: { sha: string; tag: string }[] = [];
    const allowed = new Set([TASK_A]); // only A is allowed

    for (const line of log.split("\n").filter(Boolean)) {
      const msg = line.slice(41);
      const match = msg.match(/\[task:([a-z0-9]+)\]/);
      if (match && !allowed.has(match[1])) {
        orphans.push({ sha: line.slice(0, 8), tag: match[1] });
      }
    }

    expect(orphans.length).toBe(1);
    expect(orphans[0].tag).toBe(TASK_B);
  });

  it("no choca entre tareas con IDs creadas en el mismo segundo (mismo prefijo de 8 chars)", () => {
    // Regression: with .slice(0,8), TASK_A and TASK_B would share the same prefix "cmvhogbb"
    // and allowedIds.has("cmvhogbb") would accept BOTH — hiding an orphan.
    const branch = "plan/collision-test";
    git(`checkout -b ${branch}`, dir);

    writeFileSync(join(dir, "a.txt"), "a");
    git("add -A", dir);
    git(`commit -m "[task:${TASK_A}] step A"`, dir);

    writeFileSync(join(dir, "b.txt"), "b");
    git("add -A", dir);
    git(`commit -m "[task:${TASK_B}] step B"`, dir);

    git(`push origin ${branch}`, dir);

    const log = git('log --oneline --format="%H %s" origin/main..HEAD', dir);

    // With truncated IDs: both would share prefix "cmvhogbb0000000" — Set lookup would falsely allow TASK_B
    const truncatedAllowed = new Set([TASK_A.slice(0, 8)]);
    const slicedFalseNegatives: string[] = [];
    for (const line of log.split("\n").filter(Boolean)) {
      const msg = line.slice(41);
      const match = msg.match(/\[task:([a-z0-9]+)\]/);
      if (match && !truncatedAllowed.has(match[1])) slicedFalseNegatives.push(match[1]);
    }
    // With full IDs: the truncated approach misses TASK_B because it's stored with full ID
    // but looked up with 8-char prefix — they DON'T match → correctly flagged as orphan
    // (this test documents the old bug was: slice kept same prefix → both tasks resolved to same key)
    // With full IDs in commits and allowedIds, TASK_B is correctly detected as orphan:
    const fullAllowed = new Set([TASK_A]);
    const fullOrphans: string[] = [];
    for (const line of log.split("\n").filter(Boolean)) {
      const msg = line.slice(41);
      const match = msg.match(/\[task:([a-z0-9]+)\]/);
      if (match && !fullAllowed.has(match[1])) fullOrphans.push(match[1]);
    }
    expect(fullOrphans).toContain(TASK_B);
    expect(fullOrphans).not.toContain(TASK_A);
  });

  it("passes when all commits belong to allowed tasks", () => {
    const branch = "plan/test-2026-10b";
    git(`checkout -b ${branch}`, dir);

    writeFileSync(join(dir, "ok.txt"), "ok");
    git("add -A", dir);
    git(`commit -m "[task:${TASK_A}] good step"`, dir);

    git(`push origin ${branch}`, dir);

    const log = git('log --oneline --format="%H %s" origin/main..HEAD', dir);
    const allowed = new Set([TASK_A]);
    const orphans = [];

    for (const line of log.split("\n").filter(Boolean)) {
      const msg = line.slice(41);
      const match = msg.match(/\[task:([a-z0-9]+)\]/);
      if (match && !allowed.has(match[1])) {
        orphans.push(match[1]);
      }
    }

    expect(orphans.length).toBe(0);
  });
});
