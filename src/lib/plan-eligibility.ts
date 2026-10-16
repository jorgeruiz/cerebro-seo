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
 * SETUP y HUMAN siempre se pueden enviar.
 * Para plataformas no-NEXTJS (WordPress, OTRO): se permite enviar pero el modo
 * se forzará a HUMAN en el servidor — el decomposer generará instrucciones manuales.
 * AI y HYBRID en Next.js requieren repo configurado.
 * Memory is checked at execution time by the worker — not blocked here,
 * but the UI shows what's missing.
 */
export function canSendCandidate(
  candidate: { mode: string; kind: string },
  eligibility: EligibilityResult
): { allowed: boolean; reason?: string } {
  // WordPress y otras plataformas: siempre permitido, el mode se fuerza a HUMAN al enviar
  if (eligibility.platform !== "NEXTJS") {
    return { allowed: true };
  }
  if (!eligibility.hasRepo) {
    return { allowed: false, reason: "No hay repositorio GitHub configurado." };
  }
  return { allowed: true };
}
