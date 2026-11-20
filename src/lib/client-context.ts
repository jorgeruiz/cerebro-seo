/**
 * Client Context — single source of truth for what the agent can affirm.
 *
 * Combines:
 * 1. Cerebro bridge context (identidadFija, aprendizajes, focoTrimestral)
 * 2. Local verifiedServices / excludedServices
 * 3. Confirmed claims (from ClaimCheck with status=CONFIRMED)
 * 4. Live page text for the target URL (from plugin or fetch)
 *
 * Cached in Redis (1h TTL). Invalidated on claim confirm/deny.
 */

import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

const CONTEXT_CACHE_TTL = 3600; // 1 hour

export interface ClientContext {
  /** Client name */
  name: string;
  /** From Cerebro bridge: brand identity, learnings, quarterly focus */
  identity: string | null;
  learnings: string | null;
  quarterlyFocus: string | null;
  /** Local: services the client offers */
  verifiedServices: string[];
  /** Local: services the client does NOT offer */
  excludedServices: string[];
  /** Confirmed claims from previous tasks */
  confirmedClaims: Array<{ claim: string; confirmedAt: string }>;
  /** Warning if bridge context unavailable */
  warning: string | null;
}

/**
 * Get the full client context for content generation.
 * Uses Redis cache (1h TTL).
 */
export async function getClientContext(clientId: string): Promise<ClientContext> {
  const cacheKey = `client-context:${clientId}`;

  // Try cache first
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as ClientContext;
  } catch { /* Redis down */ }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      name: true,
      cerebroClientId: true,
      verifiedServices: true,
      excludedServices: true,
    },
  });

  if (!client) {
    return {
      name: "",
      identity: null,
      learnings: null,
      quarterlyFocus: null,
      verifiedServices: [],
      excludedServices: [],
      confirmedClaims: [],
      warning: "Cliente no encontrado",
    };
  }

  // Fetch bridge context (identidadFija, aprendizajes, etc.)
  let identity: string | null = null;
  let learnings: string | null = null;
  let quarterlyFocus: string | null = null;
  let warning: string | null = null;

  if (client.cerebroClientId) {
    try {
      const slug = client.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      const bridgeCtx = await fetchBridgeContext(slug);
      if (bridgeCtx) {
        identity = bridgeCtx.identidadFija ?? null;
        learnings = bridgeCtx.aprendizajes ?? null;
        quarterlyFocus = bridgeCtx.focoTrimestral ?? null;
      } else {
        warning = `Contexto del bridge no disponible para slug "${slug}"`;
      }
    } catch (err) {
      warning = `Error al obtener contexto del bridge: ${(err as Error).message}`;
    }
  } else {
    warning = "Cliente sin cerebroClientId — contexto del bridge no disponible";
  }

  // Confirmed claims
  const confirmed = await prisma.claimCheck.findMany({
    where: { clientId, status: "CONFIRMED" },
    select: { claim: true, resolvedAt: true },
    orderBy: { resolvedAt: "desc" },
    take: 50,
  });

  const ctx: ClientContext = {
    name: client.name,
    identity,
    learnings,
    quarterlyFocus,
    verifiedServices: client.verifiedServices,
    excludedServices: client.excludedServices,
    confirmedClaims: confirmed.map((c) => ({
      claim: c.claim,
      confirmedAt: c.resolvedAt?.toISOString().slice(0, 10) ?? "",
    })),
    warning,
  };

  // Cache
  try {
    await redis.setex(cacheKey, CONTEXT_CACHE_TTL, JSON.stringify(ctx));
  } catch { /* Redis down */ }

  return ctx;
}

/** Invalidate cached context (call when claims are confirmed/denied). */
export async function invalidateClientContext(clientId: string): Promise<void> {
  try {
    await redis.del(`client-context:${clientId}`);
  } catch { /* Redis down */ }
}

/**
 * Format client context for injection into LLM prompts.
 */
export function formatContextForPrompt(ctx: ClientContext): string {
  const lines: string[] = [];

  lines.push(`CLIENTE: ${ctx.name}`);

  if (ctx.identity) {
    lines.push(`\nIDENTIDAD DEL CLIENTE:\n${ctx.identity}`);
  }

  if (ctx.verifiedServices.length > 0) {
    lines.push(`\nSERVICIOS QUE OFRECE: ${ctx.verifiedServices.join(", ")}`);
  }
  if (ctx.excludedServices.length > 0) {
    lines.push(`SERVICIOS QUE NO OFRECE (PROHIBIDO mencionar): ${ctx.excludedServices.join(", ")}`);
  }

  if (ctx.confirmedClaims.length > 0) {
    lines.push(`\nHECHOS CONFIRMADOS POR EL CLIENTE:`);
    for (const c of ctx.confirmedClaims.slice(0, 20)) {
      lines.push(`- ${c.claim} (confirmado ${c.confirmedAt})`);
    }
  }

  if (ctx.learnings) {
    lines.push(`\nAPRENDIZAJES (historial de lo que sabemos del cliente):\n${ctx.learnings}`);
  }

  if (ctx.quarterlyFocus) {
    lines.push(`\nFOCO DEL TRIMESTRE: ${ctx.quarterlyFocus}`);
  }

  if (ctx.warning) {
    lines.push(`\n⚠ AVISO: ${ctx.warning}`);
  }

  return lines.join("\n");
}

// ─── Bridge fetch ───────────────────────────────────────────────────────────

interface BridgeContext {
  identidadFija?: string;
  aprendizajes?: string;
  focoTrimestral?: string;
  notasOnboarding?: string;
}

async function fetchBridgeContext(slug: string): Promise<BridgeContext | null> {
  const baseUrl = process.env.CEREBRO_API_URL;
  const secret = process.env.SEO_INTERNAL_SECRET ?? process.env.CEREBRO_INTERNAL_SECRET;
  if (!baseUrl || !secret) return null;

  const res = await fetch(`${baseUrl}/api/internal/client-context/${encodeURIComponent(slug)}`, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) return null;

  const data = await res.json() as { ok: boolean; ctx?: BridgeContext };
  return data.ok ? (data.ctx ?? null) : null;
}
