/**
 * Modelo Claude centralizado. Cambiar vía CLAUDE_MODEL en Easypanel + rebuild.
 * NO hardcodear strings de modelo en ningún otro archivo.
 */
export const CLAUDE_MODEL =
  process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";

export const CLAUDE_MODEL_FALLBACK =
  process.env.CLAUDE_MODEL_FALLBACK ?? "claude-opus-4-8";

/** Haiku para jobs de bajo costo (ai-search). Override con CLAUDE_MODEL_HAIKU. */
export const CLAUDE_MODEL_HAIKU =
  process.env.CLAUDE_MODEL_HAIKU ?? "claude-haiku-4-5-20251001";

console.log(`[anthropic-config] CLAUDE_MODEL=${CLAUDE_MODEL}`);
