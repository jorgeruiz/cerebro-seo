/**
 * Landing Bootstrap Package — enables create_landing for Next.js sites.
 *
 * STATUS: Defined but NOT active. Missing:
 * - Landing page template structure (varies per site design)
 * - Elementor template detection for WP
 * - Route group conventions per site
 */

import type { PackageDefinition, PackageContext } from "./index";

export const landingBootstrap: PackageDefinition = {
  id: "landing_bootstrap",
  name: "Bootstrap de Landings",
  description: "Estructura de landing pages para Next.js: plantilla, rutas dinámicas, catalog-schemas ## Landing Pages",
  platforms: ["NEXTJS"],
  version: "0", // v0 = not yet active
  enables: ["create_landing"],

  async preflight(ctx: PackageContext) {
    // Same as blog: needs repo + memory files
    if (!ctx.githubRepo) return { ready: false, missing: ["Repositorio GitHub no conectado"] };
    return { ready: true, missing: [] };
  },

  async detect() {
    // TODO: check for ## Landing Pages in catalog-schemas.md
    // AND landing route template exists
    return { installed: false, details: "Paquete no activo (v0)" };
  },

  installSteps: [
    {
      kind: "agent",
      title: "Instalar estructura de landings (plantilla, rutas, catalog-schemas)",
      type: "AI",
    },
    {
      kind: "review",
      title: "Revisar estructura y aprobar",
      type: "HM",
      humanReason: "Verificar que la estructura de landings es compatible con el diseño del sitio.",
    },
  ],

  async verify() {
    return { passed: false, issues: ["Paquete no activo (v0)"] };
  },
};
