/**
 * Microsite Bootstrap Package — enables micrositio tasks for Next.js.
 *
 * STATUS: Defined but NOT active. Missing:
 * - Microsite route convention (subdomain vs path)
 * - Shared layout integration
 * - catalog-schemas ## Micrositios schema definition
 */

import type { PackageDefinition, PackageContext } from "./index";

export const micrositeBootstrap: PackageDefinition = {
  id: "microsite_bootstrap",
  name: "Bootstrap de Micrositios",
  description: "Estructura de micrositios para Next.js: rutas, layout compartido, catalog-schemas ## Micrositios",
  platforms: ["NEXTJS"],
  version: "0", // v0 = not yet active
  enables: [],

  async preflight(ctx: PackageContext) {
    if (!ctx.githubRepo) return { ready: false, missing: ["Repositorio GitHub no conectado"] };
    return { ready: true, missing: [] };
  },

  async detect() {
    return { installed: false, details: "Paquete no activo (v0)" };
  },

  installSteps: [
    {
      kind: "agent",
      title: "Instalar estructura de micrositios",
      type: "AI",
    },
    {
      kind: "review",
      title: "Revisar estructura y aprobar",
      type: "HM",
      humanReason: "Verificar compatibilidad con el diseño del sitio.",
    },
  ],

  async verify() {
    return { passed: false, issues: ["Paquete no activo (v0)"] };
  },
};
