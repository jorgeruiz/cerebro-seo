/**
 * WP Capabilities mapping — maps catalog capability names to
 * what GET /capabilities actually returns from the plugin.
 *
 * A capability without a confirmed mapping is treated as ABSENT
 * and the catalog fallback is used.
 */

/**
 * Maps catalog capability names to the strings that the WP plugin
 * reports in its /capabilities response.
 *
 * If a catalog entry requires capability "X", we check if "X" or
 * any of its aliases appear in the /capabilities response.
 */
export const CAPABILITY_MAP: Record<string, {
  /** Strings to look for in /capabilities response */
  pluginNames: string[];
  /** Whether this has been confirmed in production */
  confirmed: boolean;
}> = {
  // Confirmed in F1a diagnostic
  publish: {
    pluginNames: ["publish", "POST /publish"],
    confirmed: true,
  },
  media: {
    pluginNames: ["media", "POST /media"],
    confirmed: true,
  },
  seo_write: {
    pluginNames: ["seo_write", "seo", "POST /seo/{id}"],  // "seo" for < v1.6.0 compat
    confirmed: true,
  },
  update: {
    pluginNames: ["update", "PUT /update/{id}"],
    confirmed: true,
  },

  // Elementor — confirmed endpoints exist, but the capability
  // string reported by /capabilities needs verification
  elementor_write: {
    pluginNames: [
      "elementor_write",
      "elementor",
      "POST /elementor/duplicate/{pageId}",
      "PATCH /elementor/{draftId}/widgets",
    ],
    confirmed: false, // TODO confirmar: ¿/capabilities reporta "elementor_write"?
  },

  // Not confirmed — these capabilities are assumed ABSENT
  media_alt: {
    pluginNames: ["media_alt"],
    confirmed: false, // POST /media accepts alt_text on upload, but can't edit existing media alt
  },
  canonical: {
    pluginNames: ["canonical"],
    confirmed: false, // /seo/{id} does NOT accept canonical field
  },
};

/**
 * Check if a catalog capability is present in a /capabilities response.
 */
export function hasCapability(
  catalogCapability: string,
  pluginCapabilities: string[]
): boolean {
  const mapping = CAPABILITY_MAP[catalogCapability];
  if (!mapping) return false;

  // If not confirmed, treat as absent (use fallback)
  if (!mapping.confirmed) return false;

  return mapping.pluginNames.some((name) =>
    pluginCapabilities.some((cap) => cap === name || cap.startsWith(`${name}/`))
  );
}

/**
 * Given a catalog entry's steps and the plugin's capabilities,
 * resolve which steps should use their primary (AI) or fallback (HM) version.
 */
export function resolveStepsWithCapabilities(
  steps: Array<{
    type: "AI" | "HM";
    requiredCapability?: string;
    fallback?: { type: "AI" | "HM"; [key: string]: unknown };
    [key: string]: unknown;
  }>,
  pluginCapabilities: string[] | null
): Array<{ type: "AI" | "HM"; [key: string]: unknown }> {
  if (!pluginCapabilities) {
    // No capabilities data — use fallbacks for all capability-dependent steps
    return steps.map((step) => {
      if (step.type === "AI" && step.requiredCapability && step.fallback) {
        return step.fallback;
      }
      return step;
    });
  }

  return steps.map((step) => {
    if (step.type === "AI" && step.requiredCapability) {
      if (hasCapability(step.requiredCapability, pluginCapabilities)) {
        return step; // capability present, use primary
      }
      if (step.fallback) {
        return step.fallback; // capability absent, use fallback
      }
    }
    return step;
  });
}
