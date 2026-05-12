import Redis from "ioredis";
import { env } from "@/env";

// Singleton con lazyConnect — NO conecta al importarse durante `next build`.
// Solo conecta al primer uso en runtime.
const globalForRedis = globalThis as unknown as { redis: Redis | undefined };

export const redis =
  globalForRedis.redis ??
  new Redis(env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null, // requerido por BullMQ
    enableReadyCheck: false,
    lazyConnect: true, // evita ECONNREFUSED durante next build
  });

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
