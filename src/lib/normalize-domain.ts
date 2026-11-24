/**
 * Normaliza un input (URL, dominio, o string con esquema faltante) a un hostname limpio.
 * Retorna null si no es un dominio válido.
 *
 * Ejemplos:
 *   "https://www.example.com/page" → "example.com"
 *   "www.example.com" → "example.com"
 *   "example.com" → "example.com"
 *   "" → null
 *   null → null
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input || typeof input !== "string") return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  // Add scheme if missing so URL parser works
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);
    let hostname = url.hostname.toLowerCase();

    // Strip www.
    hostname = hostname.replace(/^www\./, "");

    // Basic validation: must have at least one dot and no spaces
    if (!hostname.includes(".") || hostname.includes(" ")) return null;

    // Reject IPs (optional — keep domains only)
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null;

    return hostname;
  } catch {
    return null;
  }
}
