/**
 * Validador y normalizador del identificador canonical de cliente
 * en el ecosistema Click Society: `notion_client_id`.
 *
 * Es el ID de la pagina de Notion en la base "Clientes Actuales".
 * Formato aceptado: UUID hex con o sin dashes (32 o 36 chars).
 * Formato almacenado en BD (columna `cerebroClientId`): 32 hex sin dashes.
 */

const UUID_WITH_DASHES = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_NO_DASHES = /^[0-9a-f]{32}$/i;

export interface NotionClientIdValidation {
  valid: true;
  normalized: string; // 32 hex lowercase, sin dashes
}

export interface NotionClientIdError {
  valid: false;
  message: string;
}

/**
 * Valida y normaliza un notion_client_id.
 * Acepta UUID con dashes (36 chars) o sin dashes (32 chars).
 * Devuelve siempre 32 hex lowercase (formato almacenado en `Client.cerebroClientId`).
 */
export function validateNotionClientId(
  raw: unknown
): NotionClientIdValidation | NotionClientIdError {
  if (typeof raw !== "string" || raw.length === 0) {
    return {
      valid: false,
      message:
        "notion_client_id is required and must be a non-empty string",
    };
  }

  const trimmed = raw.trim();

  if (UUID_NO_DASHES.test(trimmed)) {
    return { valid: true, normalized: trimmed.toLowerCase() };
  }

  if (UUID_WITH_DASHES.test(trimmed)) {
    return { valid: true, normalized: trimmed.replace(/-/g, "").toLowerCase() };
  }

  return {
    valid: false,
    message:
      `Invalid notion_client_id format: "${trimmed}". ` +
      "Expected a Notion page UUID (32 hex chars or standard UUID with dashes).",
  };
}
