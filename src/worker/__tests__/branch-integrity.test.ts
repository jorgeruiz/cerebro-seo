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

  it("detects commits from tasks not in the allowed set", () => {
    const branch = "plan/test-2026-10";
    git(`checkout -b ${branch}`, dir);

    // Commit for allowed task
    writeFileSync(join(dir, "ok.txt"), "ok");
    git("add -A", dir);
    git('commit -m "[task:allowed1] good step"', dir);

    // Commit for disallowed task
    writeFileSync(join(dir, "bad.txt"), "bad");
    git("add -A", dir);
    git('commit -m "[task:orphan01] bad step"', dir);

    git(`push origin ${branch}`, dir);

    // Audit
    const log = git('log --oneline --format="%H %s" origin/main..HEAD', dir);
    const orphans: { sha: string; tag: string }[] = [];
    const allowed = new Set(["allowed1"]);

    for (const line of log.split("\n").filter(Boolean)) {
      const msg = line.slice(41);
      const match = msg.match(/\[task:([a-z0-9]+)\]/);
      if (match && !allowed.has(match[1])) {
        orphans.push({ sha: line.slice(0, 8), tag: match[1] });
      }
    }

    expect(orphans.length).toBe(1);
    expect(orphans[0].tag).toBe("orphan01");
  });

  it("passes when all commits belong to allowed tasks", () => {
    const branch = "plan/test-2026-10";
    git(`checkout -b ${branch}`, dir);

    writeFileSync(join(dir, "ok.txt"), "ok");
    git("add -A", dir);
    git('commit -m "[task:allowed1] good step"', dir);

    git(`push origin ${branch}`, dir);

    const log = git('log --oneline --format="%H %s" origin/main..HEAD', dir);
    const allowed = new Set(["allowed1"]);
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
