/**
 * Embed token — firma y verificación de tokens de vida corta
 * para embeber reportes en Constructor (iframe).
 *
 * Formato: base64url(JSON payload) + "." + base64url(HMAC-SHA256 signature)
 * Payload: { reportId, exp } donde exp es Unix timestamp en segundos.
 */

import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_TTL_SECONDS = 60 * 60; // 1 hora

interface TokenPayload {
  reportId: string;
  exp: number;
}

function getSecret(): string {
  const secret = process.env.SEO_EMBED_TOKEN_SECRET;
  if (!secret) throw new Error("SEO_EMBED_TOKEN_SECRET is not set");
  return secret;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(payload: string, secret: string): string {
  return base64url(
    createHmac("sha256", secret).update(payload).digest()
  );
}

export function createEmbedToken(reportId: string): string {
  const payload: TokenPayload = {
    reportId,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  const signature = sign(payloadB64, getSecret());
  return `${payloadB64}.${signature}`;
}

export function verifyEmbedToken(
  token: string,
  expectedReportId: string
): { valid: true } | { valid: false; reason: string } {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "malformed token" };
  }

  const [payloadB64, sig] = parts;
  const expectedSig = sign(payloadB64, getSecret());

  // Timing-safe comparison
  const sigBuf = Buffer.from(sig, "base64url");
  const expectedBuf = Buffer.from(expectedSig, "base64url");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, reason: "invalid signature" };
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "invalid payload" };
  }

  if (payload.reportId !== expectedReportId) {
    return { valid: false, reason: "report id mismatch" };
  }

  if (Math.floor(Date.now() / 1000) > payload.exp) {
    return { valid: false, reason: "token expired" };
  }

  return { valid: true };
}
