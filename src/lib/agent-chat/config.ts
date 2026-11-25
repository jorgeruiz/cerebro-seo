/** Model for agent chat. */
export const AGENT_CHAT_MODEL = process.env.AGENT_CHAT_MODEL ?? "claude-sonnet-4-6";

/** Max tool-use loop iterations per message. */
export const MAX_TURNS = 15;

/** Max total tokens (in + out) per conversation. */
export const MAX_TOKENS_CONVERSATION = 100_000;

/** Max output tokens per single Anthropic call. */
export const MAX_OUTPUT_TOKENS = 4096;

/** Max items per change request. */
export const MAX_ITEMS_PER_CR = 8;
