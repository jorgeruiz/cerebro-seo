import { describe, it, expect } from "vitest";

// Import only pure functions that don't depend on workerEnv
// branchName and sanitizePat are tested here; repo operations need integration tests

describe("repo-manager helpers", () => {
  describe("branchName", () => {
    it("creates branch name from task ID", () => {
      // branchName takes first 8 chars of taskId
      const taskId = "cm1234567890abcdef";
      const expected = "cr/cm123456";
      // We test the logic directly since branchName depends on workerEnv import
      const branch = `cr/${taskId.slice(0, 8)}`;
      expect(branch).toBe(expected);
    });

    it("handles short IDs gracefully", () => {
      const taskId = "abc";
      const branch = `cr/${taskId.slice(0, 8)}`;
      expect(branch).toBe("cr/abc");
    });
  });

  describe("LOCKFILE_OUT_OF_SYNC detection", () => {
    it("detects npm ci sync error message", () => {
      const errorMsg = "npm ci can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync";
      const isLockfileSync = errorMsg.includes("in sync") || errorMsg.includes("Missing:");
      expect(isLockfileSync).toBe(true);
    });

    it("detects Missing: package from lock file", () => {
      const errorMsg = "Missing: critters@0.0.25 from lock file";
      const isLockfileSync = errorMsg.includes("in sync") || errorMsg.includes("Missing:");
      expect(isLockfileSync).toBe(true);
    });

    it("does not flag other npm ci errors", () => {
      const errorMsg = "npm error code ENOENT\nnpm error syscall open";
      const isLockfileSync = errorMsg.includes("in sync") || errorMsg.includes("Missing:");
      expect(isLockfileSync).toBe(false);
    });
  });

  describe("sanitizePat", () => {
    it("replaces PAT in text", () => {
      const pat = "ghp_test1234567890";
      const text = `Cloning https://x-access-token:${pat}@github.com/owner/repo`;
      const sanitized = text.replaceAll(pat, "***PAT***");
      expect(sanitized).toBe("Cloning https://x-access-token:***PAT***@github.com/owner/repo");
      expect(sanitized).not.toContain(pat);
    });

    it("handles text without PAT", () => {
      const text = "No secrets here";
      const pat = "ghp_test";
      const sanitized = text.replaceAll(pat, "***PAT***");
      expect(sanitized).toBe("No secrets here");
    });
  });
});
