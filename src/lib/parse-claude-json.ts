/**
 * Robust JSON parser for Claude responses.
 *
 * Claude sometimes wraps JSON in markdown fences, adds explanatory text,
 * or refuses to generate JSON entirely. This parser handles all cases:
 * 1. Clean JSON → parse directly
 * 2. ```json ... ``` fence → strip and parse
 * 3. Text + JSON mixed → extract first {…} or […] block
 * 4. No JSON at all → return null with the raw text
 */

export interface ParseResult<T = unknown> {
  ok: true;
  data: T;
}

export interface ParseError {
  ok: false;
  /** The raw Claude response (for displaying in WAITING_HUMAN) */
  rawText: string;
  error: string;
}

export function parseClaudeJson<T = unknown>(raw: string): ParseResult<T> | ParseError {
  if (!raw || !raw.trim()) {
    return { ok: false, rawText: raw, error: "Respuesta vacía" };
  }

  // 1. Strip markdown fences
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  // 2. Try direct parse
  try {
    return { ok: true, data: JSON.parse(stripped) as T };
  } catch {
    // continue
  }

  // 3. Determine order: if [ appears before {, try array first
  const firstObj = raw.indexOf("{");
  const firstArr = raw.indexOf("[");
  const tryArrayFirst = firstArr !== -1 && (firstObj === -1 || firstArr < firstObj);

  const attempts: Array<[string, string]> = tryArrayFirst
    ? [["[", "]"], ["{", "}"]]
    : [["{", "}"], ["[", "]"]];

  for (const [open, close] of attempts) {
    const match = findJsonBlock(raw, open, close);
    if (match) {
      try {
        return { ok: true, data: JSON.parse(match) as T };
      } catch {
        // malformed — try next
      }
    }
  }

  // 5. Nothing parseable
  return {
    ok: false,
    rawText: raw.slice(0, 1000),
    error: "Claude respondió texto en vez de JSON",
  };
}

/**
 * Find a balanced JSON block starting with `open` char.
 * Handles nested braces/brackets.
 */
function findJsonBlock(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === open) depth++;
    if (ch === close) depth--;

    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }

  return null;
}
