import Redis from "ioredis";
import { env } from "@/env";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
  redisBullMQ: Redis | undefined;
};

// Cliente para operaciones de CACHÉ en providers (GSC, GA4, DataForSEO).
// maxRetriesPerRequest: 0 + enableOfflineQueue: false → falla rápido si Redis
// está caído; el caller maneja el fallo con try/catch y sigue sin caché.
const createCacheClient = () => {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    enableReadyCheck: false,
    lazyConnect: true,
  });
  client.on("error", (err) => console.error("[Redis:cache]", err.message));
  return client;
};

// Cliente exclusivo para BullMQ.
// maxRetriesPerRequest: null es requerido por BullMQ — los jobs esperan en la
// offline queue hasta que Redis reconecte, lo cual es el comportamiento correcto
// para una cola de trabajos persistente.
const createBullMQClient = () => {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
  client.on("error", (err) => console.error("[Redis:bullmq]", err.message));
  return client;
};

export const redis = globalForRedis.redis ?? createCacheClient();
export const redisBullMQ = globalForRedis.redisBullMQ ?? createBullMQClient();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
  globalForRedis.redisBullMQ = redisBullMQ;
}
