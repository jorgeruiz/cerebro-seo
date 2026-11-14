/**
 * Site Packages — idempotent infrastructure installations.
 *
 * A package is NOT a monthly task — it's a one-time setup that enables
 * a category of tasks. Example: blog_bootstrap enables create_blog.
 *
 * Each package has 5 lifecycle methods:
 *   preflight → detect → install → verify → rollback
 */

import type { SitePlatform } from "@prisma/client";

// ─── Interface ──────────────────────────────────────────────────────────────

export interface PackageDefinition {
  /** Unique ID (e.g. "blog_bootstrap") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description: string;
  /** Which platforms this package applies to */
  platforms: SitePlatform[];
  /** Version string for idempotency */
  version: string;
  /** Which actionTypes this package enables */
  enables: string[];

  /** What must exist before installing. Returns { ready, missing[] }. */
  preflight: (ctx: PackageContext) => Promise<PreflightResult>;
  /** Check if already installed. Returns true if no action needed. */
  detect: (ctx: PackageContext) => Promise<DetectResult>;
  /** Install steps: returns the catalog steps for install_package task. */
  installSteps: PackageInstallStep[];
  /** Verify after install. Returns { passed, issues[] }. */
  verify: (ctx: PackageContext) => Promise<VerifyResult>;
}

export interface PackageContext {
  siteId: string;
  githubRepo: string;
  defaultBranch: string;
  pat?: string;
}

export interface PreflightResult {
  ready: boolean;
  missing: string[];
}

export interface DetectResult {
  installed: boolean;
  version?: string;
  details?: string;
}

export interface VerifyResult {
  passed: boolean;
  issues: string[];
}

export interface PackageInstallStep {
  kind: string;
  title: string;
  type: "AI" | "HM";
  humanReason?: string;
  prompt?: string;
}

// ─── Registry ───────────────────────────────────────────────────────────────

import { blogBootstrap } from "./blog-bootstrap";
import { landingBootstrap } from "./landing-bootstrap";
import { micrositeBootstrap } from "./microsite-bootstrap";

export const PACKAGE_REGISTRY: PackageDefinition[] = [
  blogBootstrap,
  landingBootstrap,
  micrositeBootstrap,
];

const _byId = new Map(PACKAGE_REGISTRY.map((p) => [p.id, p]));

export function getPackageDefinition(id: string): PackageDefinition | undefined {
  return _byId.get(id);
}

export function getPackagesForPlatform(platform: SitePlatform): PackageDefinition[] {
  return PACKAGE_REGISTRY.filter((p) => p.platforms.includes(platform));
}
