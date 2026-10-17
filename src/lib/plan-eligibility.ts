/**
 * Eligibility checks for sending candidates to the monthly plan.
 * This is a shared utility — NOT a server action.
 */

export interface EligibilityResult {
  eligible: boolean;
  reason: string | null;
  platform: string | null;
  hasRepo: boolean;
  /** Missing memory files for CODE tasks (site-spec, site-map, site-state) */
  missingForCode: string[];
  /** Missing memory files for CONTENT tasks (adds catalog-schemas sections) */
  missingForContent: string[];
}

/**
 * Determina si una candidata se puede enviar al plan dado el estado de elegibilidad.
 *
 * - NEXTJS: AI/HYBRID requieren repo configurado. HUMAN y SETUP siempre permitidos.
 * - WORDPRESS/MIGRACION: siempre permitido. AI usa plugin v1.5.0; HUMAN = instrucciones guiadas.
 * - OTRO: siempre permitido, el worker ejecutará como HUMAN.
 *
 * Memory y capabilities se validan en tiempo de ejecución (worker/decomposer) — no se bloquea aquí.
 */
export function canSendCandidate(
  candidate: { mode: string; kind: string },
  eligibility: EligibilityResult
): { allowed: boolean; reason?: string } {
  if (eligibility.platform === "NEXTJS") {
    if (!eligibility.hasRepo && (candidate.mode === "AI" || candidate.mode === "HYBRID")) {
      return { allowed: false, reason: "No hay repositorio GitHub configurado." };
    }
    return { allowed: true };
  }
  // WordPress, Migración, OTRO: siempre permitido
  return { allowed: true };
}
