import { describe, it, expect } from "vitest";
import { createCanUseTool } from "../agent-permissions";

const REPO = "/workspaces/owner__repo";

describe("agent-permissions canUseTool", () => {
  const canUseTool = createCanUseTool(REPO);

  // ── ALLOW cases ──────────────────────────────────────────────────────

  describe("allows valid operations", () => {
    it("allows Read inside repo", async () => {
      const result = await canUseTool("Read", { file_path: `${REPO}/src/app/page.tsx` }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("allow");
    });

    it("allows Edit inside repo", async () => {
      const result = await canUseTool("Edit", { file_path: `${REPO}/src/components/Header.tsx` }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("allow");
    });

    it("allows Write inside repo", async () => {
      const result = await canUseTool("Write", { file_path: `${REPO}/src/lib/utils.ts` }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("allow");
    });

    it("allows Glob", async () => {
      const result = await canUseTool("Glob", { pattern: "**/*.tsx" }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("allow");
    });

    it("allows Glob with path inside repo", async () => {
      const result = await canUseTool("Glob", { pattern: "**/*.tsx", path: `${REPO}/src` }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("allow");
    });

    it("allows Grep inside repo", async () => {
      const result = await canUseTool("Grep", { pattern: "className", path: `${REPO}/src` }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("allow");
    });

    it("allows npm run build", async () => {
      const result = await canUseTool("Bash", { command: "npm run build" }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("allow");
    });

    it("allows npm run lint", async () => {
      const result = await canUseTool("Bash", { command: "npm run lint" }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("allow");
    });

    it("allows git status", async () => {
      const result = await canUseTool("Bash", { command: "git status" }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("allow");
    });

    it("allows git diff", async () => {
      const result = await canUseTool("Bash", { command: "git diff" }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("allow");
    });

    it("allows git diff with path args", async () => {
      const result = await canUseTool("Bash", { command: "git diff src/app/page.tsx" }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("allow");
    });
  });

  // ── DENY cases ───────────────────────────────────────────────────────

  describe("denies dangerous operations", () => {
    it("denies git push", async () => {
      const result = await canUseTool("Bash", { command: "git push origin main" }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("deny");
    });

    it("denies git commit", async () => {
      const result = await canUseTool("Bash", { command: 'git commit -m "test"' }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("deny");
    });

    it("denies rm -rf", async () => {
      const result = await canUseTool("Bash", { command: "rm -rf /" }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("deny");
    });

    it("denies cat .env", async () => {
      const result = await canUseTool("Bash", { command: "cat .env" }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("deny");
    });

    it("denies curl", async () => {
      const result = await canUseTool("Bash", { command: "curl https://example.com" }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("deny");
    });

    it("denies npm install <pkg>", async () => {
      const result = await canUseTool("Bash", { command: "npm install lodash" }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("deny");
    });

    it("denies Read outside repo", async () => {
      const result = await canUseTool("Read", { file_path: "/etc/passwd" }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("deny");
    });

    it("denies Write outside repo", async () => {
      const result = await canUseTool("Write", { file_path: "/tmp/malicious.sh" }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("deny");
    });

    it("denies Read .env file", async () => {
      const result = await canUseTool("Read", { file_path: `${REPO}/.env` }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("deny");
    });

    it("denies Read .env.local file", async () => {
      const result = await canUseTool("Read", { file_path: `${REPO}/.env.local` }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("deny");
    });

    it("denies Edit .env.production", async () => {
      const result = await canUseTool("Edit", { file_path: `${REPO}/.env.production` }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("deny");
    });

    it("denies Write .env file", async () => {
      const result = await canUseTool("Write", { file_path: `${REPO}/.env` }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("deny");
    });

    it("denies Read with path traversal", async () => {
      const result = await canUseTool("Read", { file_path: `${REPO}/../../etc/passwd` }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("deny");
    });

    it("denies WebFetch (disallowed tool)", async () => {
      const result = await canUseTool("WebFetch", { url: "https://example.com" }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("deny");
    });

    it("denies Agent tool", async () => {
      const result = await canUseTool("Agent", { prompt: "do something" }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("deny");
    });

    it("denies Glob with absolute path outside repo", async () => {
      const result = await canUseTool("Glob", { pattern: "**/*.ts", path: "/workspaces" }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("deny");
    });

    it("denies Glob with path traversal", async () => {
      const result = await canUseTool("Glob", { pattern: "**/*.ts", path: `${REPO}/../otro-repo` }, { signal: new AbortController().signal });
      expect(result.behavior).toBe("deny");
    });

    it("denies unknown tools", async () => {
      const result = await canUseTool("SomeRandomTool", {}, { signal: new AbortController().signal });
      expect(result.behavior).toBe("deny");
    });
  });
});
