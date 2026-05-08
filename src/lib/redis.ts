import Redis from "ioredis";
import { env } from "@/env";

// Singleton — reutiliza la conexión en hot-reload de Next.js dev
const globalForRedis = globalThis as unknown as { redis: Redis | undefined };

export const redis =
  globalForRedis.redis ??
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // requerido por BullMQ
    enableReadyCheck: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
