/**
 * Eligibility checks for sending candidates to the monthly plan.
 * This is a shared utility — NOT a server action.
 */

export interface EligibilityResult {
  eligible: boolean;
  reason: string | null;
  platform: string | null;
  hasRepo: boolean;
}

/**
 * Determina si una candidata se puede enviar al plan dado el estado de elegibilidad.
 * SETUP y HUMAN siempre se pueden enviar. AI y HYBRID requieren NEXTJS + repo.
 */
export function canSendCandidate(
  candidate: { mode: string; kind: string },
  eligibility: EligibilityResult
): { allowed: boolean; reason?: string } {
  if (candidate.kind === "SETUP" || candidate.mode === "HUMAN") {
    return { allowed: true };
  }
  if (eligibility.platform !== "NEXTJS") {
    return { allowed: false, reason: eligibility.reason ?? "Plataforma no es Next.js" };
  }
  if (!eligibility.hasRepo) {
    return { allowed: false, reason: "No hay repositorio GitHub configurado." };
  }
  return { allowed: true };
}
