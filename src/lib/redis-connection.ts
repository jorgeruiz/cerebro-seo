/**
 * Conexión Redis mínima — lee REDIS_URL directo de process.env.
 *
 * Este módulo NO importa @/env (que valida todas las vars del web process).
 * Es seguro para importar tanto desde el proceso web como desde el worker.
 *
 * El proceso web puede seguir usando src/lib/redis.ts para sus clientes
 * de caché. queues.ts y el worker usan este módulo.
 */

import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  throw new Error("REDIS_URL environment variable is required");
}

const globalForRedis = globalThis as unknown as {
  redisBullMQ: Redis | undefined;
};

const createBullMQClient = () => {
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
  client.on("error", (err) => console.error("[Redis:bullmq]", err.message));
  return client;
};

export const redisBullMQ =
  globalForRedis.redisBullMQ ?? createBullMQClient();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redisBullMQ = redisBullMQ;
}
