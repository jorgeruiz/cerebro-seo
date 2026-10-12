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

// ─── Repo lock ───────────────────────────────────────────────────────────────

/**
 * Candado por repo (workspace compartido).
 * Tareas, terminal y preflight comparten el directorio del repo clonado.
 * Solo una operación de escritura a la vez por repo.
 *
 * Separado del plan lock: el plan lock es de reglas de negocio (una escritura
 * por plan), el repo lock es de concurrencia sobre el filesystem.
 */
function repoLockKey(githubRepo: string): string {
  return `repo-lock:${githubRepo}`;
}

export async function acquireRepoLock(
  githubRepo: string,
  ttlMs = DEFAULT_TTL_MS
): Promise<PlanLock> {
  const holder = randomUUID();
  const key = repoLockKey(githubRepo);
  const ttlSec = Math.ceil(ttlMs / 1000);

  const result = await redis.set(key, holder, "EX", ttlSec, "NX");

  if (result !== "OK") {
    const currentHolder = await redis.get(key);
    return { acquired: false, holder: currentHolder ?? undefined, release: async () => {} };
  }

  const renewalTimer = setInterval(async () => {
    try {
      const current = await redis.get(key);
      if (current === holder) await redis.expire(key, ttlSec);
    } catch { /* expires naturally */ }
  }, RENEWAL_INTERVAL_MS);

  return {
    acquired: true,
    holder,
    release: async () => {
      clearInterval(renewalTimer);
      try {
        await redis.eval(
          `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
          1, key, holder
        );
      } catch { /* best-effort */ }
    },
  };
}

export async function isRepoLocked(githubRepo: string): Promise<boolean> {
  return (await redis.exists(repoLockKey(githubRepo))) === 1;
}

// ─── Build semaphore ─────────────────────────────────────────────────────────

const BUILD_SEMAPHORE_KEY = "build-semaphore";
const BUILD_SEMAPHORE_TTL = 300; // 5 min max per build

/**
 * Global build semaphore: one build at a time on the VPS.
 * Acquires, runs the callback, and releases. Waits up to waitMs.
 * Throws BUILD_BUSY if timeout exceeded — caller should re-enqueue,
 * never mark as BUILD_FAILED for contention.
 */
export async function withBuildSemaphore<T>(
  fn: () => T | Promise<T>,
  waitMs = 900_000 // 15 min max wait
): Promise<T> {
  const holder = randomUUID();
  const deadline = Date.now() + waitMs;

  // Spin-wait with backoff
  while (Date.now() < deadline) {
    const acquired = await redis.set(BUILD_SEMAPHORE_KEY, holder, "EX", BUILD_SEMAPHORE_TTL, "NX");
    if (acquired === "OK") {
      try {
        return await fn();
      } finally {
        await redis.eval(
          `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
          1, BUILD_SEMAPHORE_KEY, holder
        );
      }
    }
    // Wait 3s before retrying
    await new Promise((r) => setTimeout(r, 3000));
  }

  throw new Error("BUILD_BUSY");
}
