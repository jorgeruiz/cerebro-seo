/**
 * Candado distribuido por plan en Redis.
 *
 * Garantiza una sola escritura a la vez por plan (tarea AI o terminal).
 * Usa SET NX EX (single Redis, no Redlock).
 *
 * TTL: 15 min con renovación cada 5 min.
 */

import { redis } from "@/lib/redis";
import { randomUUID } from "crypto";

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 min
const RENEWAL_INTERVAL_MS = 5 * 60 * 1000; // 5 min

function lockKey(planId: string): string {
  return `plan-lock:${planId}`;
}

export interface PlanLock {
  acquired: boolean;
  holder?: string;
  release: () => Promise<void>;
}

/**
 * Intenta adquirir el candado del plan.
 * Si no puede, retorna { acquired: false } sin bloquear.
 */
export async function acquirePlanLock(
  planId: string,
  ttlMs = DEFAULT_TTL_MS
): Promise<PlanLock> {
  const holder = randomUUID();
  const key = lockKey(planId);
  const ttlSec = Math.ceil(ttlMs / 1000);

  // SET key holder NX EX ttl
  const result = await redis.set(key, holder, "EX", ttlSec, "NX");

  if (result !== "OK") {
    // Lock held by someone else
    const currentHolder = await redis.get(key);
    return {
      acquired: false,
      holder: currentHolder ?? undefined,
      release: async () => {},
    };
  }

  // Auto-renewal
  const renewalTimer = setInterval(async () => {
    try {
      // Only renew if we still hold the lock
      const current = await redis.get(key);
      if (current === holder) {
        await redis.expire(key, ttlSec);
      }
    } catch {
      // Redis error during renewal — lock will expire naturally
    }
  }, RENEWAL_INTERVAL_MS);

  const release = async () => {
    clearInterval(renewalTimer);
    try {
      // Only delete if we still hold it (compare-and-delete via Lua)
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await redis.eval(script, 1, key, holder);
    } catch {
      // Best-effort release
    }
  };

  return { acquired: true, holder, release };
}

/**
 * Verifica si un plan tiene candado activo (para UI).
 */
export async function isPlanLocked(planId: string): Promise<boolean> {
  const result = await redis.exists(lockKey(planId));
  return result === 1;
}
