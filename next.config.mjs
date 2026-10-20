import { execSync } from "child_process";

/** Commit SHA baked at build time — shown in /api/health and the UI footer. */
const COMMIT_SHA = (() => {
  try { return execSync("git rev-parse --short HEAD").toString().trim(); }
  catch { return process.env.COMMIT_SHA ?? "unknown"; }
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
