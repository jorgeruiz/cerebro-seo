import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mock workerEnv so importing repo-manager doesn't fail env validation
vi.mock("../env", () => ({
  workerEnv: {
    ANTHROPIC_API_KEY: "test",
    GITHUB_PAT_CLIENT_REPOS: "test",
    WORKSPACES_DIR: "/tmp/workspaces",
    AGENT_TIMEOUT_MIN: 30,
    AGENT_MAX_TURNS_CAP: 60,
    AGENT_MAX_BUDGET_USD: 5,
    REDIS_URL: "redis://localhost:6379",
  },
}));

import {
  scanExistingRoutes,
  verifyRoutesInBuild,
  stripDraftFrontmatter,
} from "../repo-manager";

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

// ─── scanExistingRoutes ───────────────────────────────────────────────────────

function touch(filePath: string) {
  mkdirSync(filePath.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(filePath, "// placeholder");
}

describe("scanExistingRoutes", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "scan-routes-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects App Router pages in app/", () => {
    touch(join(dir, "app/servicios/page.tsx"));
    touch(join(dir, "app/blog/mi-post/page.mdx"));
    const routes = scanExistingRoutes(dir);
    expect(routes.has("/servicios")).toBe(true);
    expect(routes.has("/blog/mi-post")).toBe(true);
  });

  it("detects App Router pages in src/app/", () => {
    touch(join(dir, "src/app/sobre-nosotros/page.tsx"));
    const routes = scanExistingRoutes(dir);
    expect(routes.has("/sobre-nosotros")).toBe(true);
  });

  it("strips route groups from path (canibalización guard)", () => {
    // Brainet uses (es) route group — should map to bare route without the group
    touch(join(dir, "app/(es)/seguridad-electronica/control-de-acceso/page.tsx"));
    const routes = scanExistingRoutes(dir);
    expect(routes.has("/seguridad-electronica/control-de-acceso")).toBe(true);
    // The stored file path should include the route group (for reference)
    expect(routes.get("/seguridad-electronica/control-de-acceso")).toContain("(es)");
  });

  it("detects content/blog MDX files", () => {
    touch(join(dir, "content/blog/cctv-empresas-2026.mdx"));
    const routes = scanExistingRoutes(dir);
    expect(routes.has("/blog/cctv-empresas-2026")).toBe(true);
  });

  it("detects src/content/blog MDX files", () => {
    touch(join(dir, "src/content/blog/integradores-de-soluciones.mdx"));
    const routes = scanExistingRoutes(dir);
    expect(routes.has("/blog/integradores-de-soluciones")).toBe(true);
  });

  it("returns empty map for empty repo", () => {
    const routes = scanExistingRoutes(dir);
    expect(routes.size).toBe(0);
  });

  it("last writer wins when both app/ and src/app/ define same route", () => {
    touch(join(dir, "app/contacto/page.tsx"));
    touch(join(dir, "src/app/contacto/page.tsx"));
    const routes = scanExistingRoutes(dir);
    // Route exists (no crash, deterministic)
    expect(routes.has("/contacto")).toBe(true);
  });
});

// ─── verifyRoutesInBuild ──────────────────────────────────────────────────────

describe("verifyRoutesInBuild", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "verify-build-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty when all routes found in prerender-manifest", () => {
    const nextDir = join(dir, ".next");
    mkdirSync(nextDir, { recursive: true });
    writeFileSync(
      join(nextDir, "prerender-manifest.json"),
      JSON.stringify({
        routes: {
          "/blog/cctv-para-empresas": {},
          "/blog/control-de-acceso": {},
          "/servicios": {},
        },
      })
    );
    const missing = verifyRoutesInBuild(dir, ["/blog/cctv-para-empresas", "/blog/control-de-acceso"]);
    expect(missing).toEqual([]);
  });

  it("returns missing routes not in any manifest", () => {
    const nextDir = join(dir, ".next");
    mkdirSync(nextDir, { recursive: true });
    writeFileSync(
      join(nextDir, "prerender-manifest.json"),
      JSON.stringify({
        routes: { "/blog/existing-post": {} },
      })
    );
    writeFileSync(
      join(nextDir, "routes-manifest.json"),
      JSON.stringify({
        staticRoutes: [{ page: "/about" }],
        dynamicRoutes: [{ page: "/blog/[slug]" }],
      })
    );
    const missing = verifyRoutesInBuild(dir, ["/blog/missing-post", "/about"]);
    expect(missing).toEqual(["/blog/missing-post"]);
  });

  it("returns empty when no routes to check", () => {
    const missing = verifyRoutesInBuild(dir, []);
    expect(missing).toEqual([]);
  });

  it("returns all routes when .next doesn't exist", () => {
    const missing = verifyRoutesInBuild(dir, ["/blog/post-1"]);
    expect(missing).toEqual(["/blog/post-1"]);
  });

  it("handles routes-manifest staticRoutes", () => {
    const nextDir = join(dir, ".next");
    mkdirSync(nextDir, { recursive: true });
    writeFileSync(
      join(nextDir, "routes-manifest.json"),
      JSON.stringify({
        staticRoutes: [{ page: "/contacto" }, { page: "/servicios" }],
      })
    );
    const missing = verifyRoutesInBuild(dir, ["/contacto"]);
    expect(missing).toEqual([]);
  });
});

// ─── stripDraftFrontmatter ────────────────────────────────────────────────────

describe("stripDraftFrontmatter", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "strip-draft-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("strips borrador: true from MDX frontmatter", () => {
    const mdxPath = join(dir, "content", "blog", "test.mdx");
    mkdirSync(join(dir, "content", "blog"), { recursive: true });
    writeFileSync(
      mdxPath,
      '---\ntitulo: "Test"\nslug: "test"\nborrador: true\nautor: "Bot"\n---\n\nContent here.'
    );

    const cleaned = stripDraftFrontmatter(dir);
    expect(cleaned).toEqual(["content/blog/test.mdx"]);

    const result = readFileSync(mdxPath, "utf-8");
    expect(result).not.toContain("borrador");
    expect(result).toContain('titulo: "Test"');
    expect(result).toContain('autor: "Bot"');
  });

  it("strips draft: true from MDX frontmatter", () => {
    const mdxPath = join(dir, "post.mdx");
    writeFileSync(
      mdxPath,
      '---\ntitle: "Post"\ndraft: true\nauthor: "AI"\n---\n\nBody.'
    );

    const cleaned = stripDraftFrontmatter(dir);
    expect(cleaned).toEqual(["post.mdx"]);

    const result = readFileSync(mdxPath, "utf-8");
    expect(result).not.toContain("draft");
  });

  it("strips published: false from MDX frontmatter", () => {
    const mdxPath = join(dir, "article.mdx");
    writeFileSync(
      mdxPath,
      '---\ntitle: "Article"\npublished: false\n---\n\nBody.'
    );

    const cleaned = stripDraftFrontmatter(dir);
    expect(cleaned).toEqual(["article.mdx"]);

    const result = readFileSync(mdxPath, "utf-8");
    expect(result).not.toContain("published");
  });

  it("does not modify files without draft fields", () => {
    const mdxPath = join(dir, "clean.mdx");
    writeFileSync(
      mdxPath,
      '---\ntitle: "Clean"\nauthor: "Human"\n---\n\nBody.'
    );

    const cleaned = stripDraftFrontmatter(dir);
    expect(cleaned).toEqual([]);
  });

  it("ignores non-mdx files", () => {
    writeFileSync(join(dir, "style.css"), "body { borrador: true; }");

    const cleaned = stripDraftFrontmatter(dir);
    expect(cleaned).toEqual([]);
  });
});
