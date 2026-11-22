import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { redis } from "@/lib/redis";
import { prisma } from "@/lib/db";

const RATE_LIMIT_WINDOW = 60; // seconds
const RATE_LIMIT_MAX = 60; // requests per window
const RATE_LIMIT_PREFIX = "agent-api:rate:";

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

async function checkRateLimit(ip: string): Promise<{ ok: boolean; remaining: number }> {
  const key = `${RATE_LIMIT_PREFIX}${ip}`;
  try {
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, RATE_LIMIT_WINDOW);
    }
    return { ok: current <= RATE_LIMIT_MAX, remaining: Math.max(0, RATE_LIMIT_MAX - current) };
  } catch {
    // Redis down → allow request (fail open for availability)
    return { ok: true, remaining: RATE_LIMIT_MAX };
  }
}

async function logAgentRequest(req: NextRequest, status: number) {
  const entry = {
    method: req.method,
    path: req.nextUrl.pathname,
    status,
    ip: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown",
    userAgent: req.headers.get("user-agent") ?? "unknown",
    timestamp: new Date().toISOString(),
  };
  try {
    await prisma.jobLog.create({
      data: {
        jobName: "agent-api",
        status: String(status),
        error: status >= 400 ? JSON.stringify(entry) : null,
        attempts: 1,
      },
    });
  } catch {
    console.error("[agent-api] Failed to log request:", entry);
  }
}

export type AgentHandler = (
  req: NextRequest,
  ctx: { params: Record<string, string> }
) => Promise<NextResponse>;

/**
 * Wraps a route handler with agent API auth, rate limiting, and logging.
 */
export function withAgentAuth(handler: AgentHandler): AgentHandler {
  return async (req, ctx) => {
    const token = process.env.AGENT_API_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "Agent API not configured" },
        { status: 503 }
      );
    }

    // Auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      await logAgentRequest(req, 401);
      return NextResponse.json({ error: "Missing Bearer token" }, { status: 401 });
    }

    const provided = authHeader.slice(7);
    if (!constantTimeCompare(provided, token)) {
      await logAgentRequest(req, 401);
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    // Rate limit
    const ip = req.headers.get("x-forwarded-for") ?? "unknown";
    const { ok, remaining } = await checkRateLimit(ip);
    if (!ok) {
      await logAgentRequest(req, 429);
      return NextResponse.json(
        { error: "Rate limit exceeded. Max 60 requests per minute." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    // Execute handler
    const res = await handler(req, ctx);

    // Add rate limit headers
    res.headers.set("X-RateLimit-Limit", String(RATE_LIMIT_MAX));
    res.headers.set("X-RateLimit-Remaining", String(remaining));

    await logAgentRequest(req, res.status);
    return res;
  };
}
