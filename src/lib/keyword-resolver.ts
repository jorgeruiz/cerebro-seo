/**
 * Keyword resolution and sanitization for plan tasks.
 *
 * Resolution chain (first non-empty wins):
 * 1. payload.keyword (from step JSON)
 * 2. task.targetKeyword (from PlanTask field)
 * 3. Quoted text from task.title ("Piso Vinílico para Oficinas")
 * 4. null → step should go WAITING_HUMAN "Falta keyword objetivo"
 *
 * NEVER use raw task.title as keyword.
 */

const INSTRUCTION_VERBS = /^(redactar|publicar|crear|escribir|optimizar|mejorar|generar|implementar|agregar|añadir|actualizar|corregir|revisar|artículo|articulo|blog|post|landing|página|pagina|y|de|para|en|el|la|los|las|un|una)\s+/gi;

/**
 * Extract keyword from quoted text in a title.
 * "Redactar artículo 'Piso Vinílico para Oficinas'" → "Piso Vinílico para Oficinas"
 */
export function extractQuotedKeyword(title: string): string | null {
  const match = title.match(/['''"""\u201C\u201D«»]([^'''"""\u201C\u201D«»]+)['''"""\u201C\u201D«»]/);
  return match ? match[1].trim() : null;
}

/**
 * Strip instruction verbs from beginning of text.
 * "Redactar y publicar artículo sobre CCTV" → "CCTV"
 * Only strips prefixes, preserves the core topic.
 */
export function sanitizeKeyword(raw: string): string {
  let result = raw.trim();
  // Iteratively strip instruction verbs from the beginning
  let prev = "";
  while (prev !== result) {
    prev = result;
    result = result.replace(INSTRUCTION_VERBS, "").trim();
  }
  // If we stripped everything, return original (minus common prefix patterns)
  if (!result || result.length < 3) {
    return raw.replace(/^.*?[''""]([^''""]+)[''""].*$/, "$1").trim() || raw.trim();
  }
  return result;
}

/**
 * Resolve the target keyword for a task step.
 *
 * Returns the keyword string, or null if none can be determined.
 * When null, the step should go to WAITING_HUMAN.
 */
export function resolveKeyword(
  payloadKeyword: string | undefined | null,
  taskTargetKeyword: string | undefined | null,
  taskTitle: string,
): string | null {
  // 1. Explicit keyword from step payload
  if (payloadKeyword && payloadKeyword.trim().length >= 3) {
    return payloadKeyword.trim();
  }

  // 2. Target keyword from PlanTask field
  if (taskTargetKeyword && taskTargetKeyword.trim().length >= 3) {
    return taskTargetKeyword.trim();
  }

  // 3. Quoted text from task title
  const quoted = extractQuotedKeyword(taskTitle);
  if (quoted && quoted.length >= 3) {
    return quoted;
  }

  // 4. Sanitized title (strip verbs) — only if result is reasonable (< 50 chars)
  const sanitized = sanitizeKeyword(taskTitle);
  if (sanitized.length >= 3 && sanitized.length <= 50) {
    return sanitized;
  }

  // 5. Nothing found
  return null;
}
