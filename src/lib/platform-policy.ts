/**
 * Platform Policy — single source of truth for platform-dependent decisions.
 *
 * Replaces scattered if/else checks across actions.ts, decomposer,
 * task-processor, add-to-plan-action, plan-eligibility, and PlanMensualPanel.
 */

export type SitePlatformValue = "NEXTJS" | "WORDPRESS" | "MIGRACION" | "OTRO" | null;

export interface PlatformPolicy {
  /** Can tasks be executed (AI steps) on this platform? */
  executable: boolean;
  /** Does execution need a GitHub repo? */
  needsRepo: boolean;
  /** How the plan closes: "merge" (PR), "wp_publish" (plugin), or null (manual) */
  closeFlow: "merge" | "wp_publish" | null;
  /** Kind labels for UI display */
  kindLabels: Record<string, string>;
  /** Allowed humanReason values for HUMAN steps */
  humanReasons: readonly string[];
  /** Can use terminal (Agent SDK in repo)? */
  usesTerminal: boolean;
  /** Human-readable platform label */
  label: string;
  /** Error message if not executable, or null */
  ineligibilityReason: string | null;
}

const NEXTJS_POLICY: PlatformPolicy = {
  executable: true,
  needsRepo: true,
  closeFlow: "merge",
  kindLabels: {
    CONTENT: "Contenido",
    CODE: "Código",
    SETUP: "Setup",
  },
  humanReasons: ["terminal", "config", "external_tool"],
  usesTerminal: true,
  label: "Next.js",
  ineligibilityReason: null,
};

const WORDPRESS_POLICY: PlatformPolicy = {
  executable: true,
  needsRepo: false,
  closeFlow: "wp_publish",
  kindLabels: {
    CONTENT: "Contenido",
    CODE: "Plugin",
    SETUP: "Manual",
  },
  humanReasons: ["wp_manual", "config", "external_tool"],
  usesTerminal: false,
  label: "WordPress",
  ineligibilityReason: null,
};

const MIGRACION_POLICY: PlatformPolicy = {
  executable: true,
  needsRepo: false,
  closeFlow: "wp_publish",
  kindLabels: {
    CONTENT: "Contenido",
    CODE: "Plugin",
    SETUP: "Manual",
  },
  humanReasons: ["wp_manual", "config", "external_tool"],
  usesTerminal: false,
  label: "Migración",
  ineligibilityReason: "Sitio en migración — producción aún en WordPress. Tareas AI usan el plugin WP.",
};

const OTRO_POLICY: PlatformPolicy = {
  executable: false,
  needsRepo: false,
  closeFlow: null,
  kindLabels: {
    CONTENT: "Contenido",
    CODE: "Técnico",
    SETUP: "Setup",
  },
  humanReasons: ["config", "external_tool"],
  usesTerminal: false,
  label: "Otro",
  ineligibilityReason: "Plataforma no reconocida — el Plan mensual requiere Next.js o WordPress.",
};

const NULL_POLICY: PlatformPolicy = {
  executable: false,
  needsRepo: false,
  closeFlow: null,
  kindLabels: {
    CONTENT: "Contenido",
    CODE: "Técnico",
    SETUP: "Setup",
  },
  humanReasons: [],
  usesTerminal: false,
  label: "No detectada",
  ineligibilityReason: "Plataforma no detectada — ejecuta la detección de plataforma primero.",
};

/**
 * Returns the policy for a given platform.
 * Single source of truth — use this instead of scattered if/else.
 */
export function getPlatformPolicy(platform: SitePlatformValue): PlatformPolicy {
  switch (platform) {
    case "NEXTJS": return NEXTJS_POLICY;
    case "WORDPRESS": return WORDPRESS_POLICY;
    case "MIGRACION": return MIGRACION_POLICY;
    case "OTRO": return OTRO_POLICY;
    default: return NULL_POLICY;
  }
}

/** Shorthand: is this a WordPress-like platform? */
export function isWordPressPlatform(platform: SitePlatformValue): boolean {
  return platform === "WORDPRESS" || platform === "MIGRACION";
}
