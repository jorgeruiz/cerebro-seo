import { execSync } from "child_process";

/**
 * Commit SHA baked at build time — shown in /api/health and the UI footer.
 *
 * Resolution order:
 *   1. GIT_SHA env var  — Easypanel injects this automatically as a build arg
 *   2. git rev-parse    — works in local dev (git repo present)
 *   3. "unknown"        — fallback
 */
const COMMIT_SHA = (() => {
  const fromEnv = process.env.GIT_SHA;
  if (fromEnv && fromEnv !== "unknown") return fromEnv.slice(0, 7);
  try { return execSync("git rev-parse --short HEAD").toString().trim(); }
  catch { return "unknown"; }
})();

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { COMMIT_SHA },
  // Habilita instrumentation.ts para inicializar workers BullMQ al startup
  experimental: {
    instrumentationHook: true,
    // Reducir paralelismo de compilación para evitar OOM en build (servidor 3.8GB)
    cpus: 1,
  },
};

export default nextConfig;
