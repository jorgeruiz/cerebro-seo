import { describe, it, expect } from "vitest";
import { createCanUseTool } from "../agent-permissions";

const REPO = "/workspaces/owner__repo";

describe("agent-permissions canUseTool", () => {
  const canUseTool = createCanUseTool(REPO);

  // ── ALLOW cases ──────────────────────────────────────────────────────

  describe("allows valid operations", () => {
    it("allows Read inside repo", async () => {
      const result = await canUseTool({
        tool_name: "Read",
        input: { file_path: `${REPO}/src/app/page.tsx` },
      });
      expect(result.behavior).toBe("allow");
    });

    it("allows Edit inside repo", async () => {
      const result = await canUseTool({
        tool_name: "Edit",
        input: { file_path: `${REPO}/src/components/Header.tsx` },
      });
      expect(result.behavior).toBe("allow");
    });

    it("allows Write inside repo", async () => {
      const result = await canUseTool({
        tool_name: "Write",
        input: { file_path: `${REPO}/src/lib/utils.ts` },
      });
      expect(result.behavior).toBe("allow");
    });

    it("allows Glob", async () => {
      const result = await canUseTool({
        tool_name: "Glob",
        input: { pattern: "**/*.tsx" },
      });
      expect(result.behavior).toBe("allow");
    });

    it("allows Grep inside repo", async () => {
      const result = await canUseTool({
        tool_name: "Grep",
        input: { pattern: "className", path: `${REPO}/src` },
      });
      expect(result.behavior).toBe("allow");
    });

    it("allows npm run build", async () => {
      const result = await canUseTool({
        tool_name: "Bash",
        input: { command: "npm run build" },
      });
      expect(result.behavior).toBe("allow");
    });

    it("allows npm run lint", async () => {
      const result = await canUseTool({
        tool_name: "Bash",
        input: { command: "npm run lint" },
      });
      expect(result.behavior).toBe("allow");
    });

    it("allows git status", async () => {
      const result = await canUseTool({
        tool_name: "Bash",
        input: { command: "git status" },
      });
      expect(result.behavior).toBe("allow");
    });

    it("allows git diff", async () => {
      const result = await canUseTool({
        tool_name: "Bash",
        input: { command: "git diff" },
      });
      expect(result.behavior).toBe("allow");
    });

    it("allows git diff with path args", async () => {
      const result = await canUseTool({
        tool_name: "Bash",
        input: { command: "git diff src/app/page.tsx" },
      });
      expect(result.behavior).toBe("allow");
    });
  });

  // ── DENY cases ───────────────────────────────────────────────────────

  describe("denies dangerous operations", () => {
    it("denies git push", async () => {
      const result = await canUseTool({
        tool_name: "Bash",
        input: { command: "git push origin main" },
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies git commit", async () => {
      const result = await canUseTool({
        tool_name: "Bash",
        input: { command: 'git commit -m "test"' },
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies rm -rf", async () => {
      const result = await canUseTool({
        tool_name: "Bash",
        input: { command: "rm -rf /" },
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies cat .env", async () => {
      const result = await canUseTool({
        tool_name: "Bash",
        input: { command: "cat .env" },
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies curl", async () => {
      const result = await canUseTool({
        tool_name: "Bash",
        input: { command: "curl https://example.com" },
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies npm install <pkg>", async () => {
      const result = await canUseTool({
        tool_name: "Bash",
        input: { command: "npm install lodash" },
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies Read outside repo", async () => {
      const result = await canUseTool({
        tool_name: "Read",
        input: { file_path: "/etc/passwd" },
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies Write outside repo", async () => {
      const result = await canUseTool({
        tool_name: "Write",
        input: { file_path: "/tmp/malicious.sh" },
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies Read .env file", async () => {
      const result = await canUseTool({
        tool_name: "Read",
        input: { file_path: `${REPO}/.env` },
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies Read .env.local file", async () => {
      const result = await canUseTool({
        tool_name: "Read",
        input: { file_path: `${REPO}/.env.local` },
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies Edit .env.production", async () => {
      const result = await canUseTool({
        tool_name: "Edit",
        input: { file_path: `${REPO}/.env.production` },
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies Write .env file", async () => {
      const result = await canUseTool({
        tool_name: "Write",
        input: { file_path: `${REPO}/.env` },
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies Read with path traversal", async () => {
      const result = await canUseTool({
        tool_name: "Read",
        input: { file_path: `${REPO}/../../etc/passwd` },
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies WebFetch (disallowed tool)", async () => {
      const result = await canUseTool({
        tool_name: "WebFetch",
        input: { url: "https://example.com" },
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies Agent tool", async () => {
      const result = await canUseTool({
        tool_name: "Agent",
        input: { prompt: "do something" },
      });
      expect(result.behavior).toBe("deny");
    });

    it("denies unknown tools", async () => {
      const result = await canUseTool({
        tool_name: "SomeRandomTool",
        input: {},
      });
      expect(result.behavior).toBe("deny");
    });
  });
});
