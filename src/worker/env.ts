/**
 * Env validation para el worker de plan mensual.
 *
 * Comparte DATABASE_URL y REDIS_URL con el proceso web,
 * pero tiene vars propias (GITHUB_PAT_CLIENT_REPOS, WORKSPACES_DIR, etc.)
 * que son obligatorias solo aquí.
 */

import { z } from "zod";

const workerEnvSchema = z.object({
  // Shared with web process
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),

  // Worker-specific (required)
  GITHUB_PAT_CLIENT_REPOS: z.string().min(1),
  WORKSPACES_DIR: z.string().min(1), // ruta al volumen persistente

  // Worker-specific (optional with defaults)
  AGENT_MAX_TURNS: z.coerce.number().int().positive().default(30),
  AGENT_TIMEOUT_MIN: z.coerce.number().positive().default(10),
  AGENT_MAX_BUDGET_USD: z.coerce.number().positive().default(2.0),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export const workerEnv = workerEnvSchema.parse(process.env);
