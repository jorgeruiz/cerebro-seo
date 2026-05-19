import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Auth
  NEXTAUTH_SECRET: z.string().min(1),
  NEXTAUTH_URL: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  // Redis
  REDIS_URL: z.string().min(1),

  // DataForSEO
  DATAFORSEO_LOGIN: z.string().min(1),
  DATAFORSEO_PASSWORD: z.string().min(1),

  // Google APIs (PageSpeed solo en Fase 2 crawler)
  GOOGLE_PAGESPEED_API_KEY: z.string().optional(),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1),

  // Notion
  NOTION_API_KEY: z.string().min(1),

  // Cerebro Bridge (activo en Fase 2)
  CEREBRO_API_URL: z.string().url().optional(),
  CEREBRO_INTERNAL_SECRET: z.string().optional(),

  // Storage
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_PROVIDER: z.enum(["r2", "s3"]).optional(),

  // Roles — emails que siempre se promueven a ADMIN en el login.
  // Formato: "jorge@clicksociety.com.mx,otro@clicksociety.com.mx"
  // Si no se define, el rol viene del campo role en la BD (default: EDITOR).
  ADMIN_EMAILS: z.string().optional(),

  // Node env
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

// Durante `npm run build` en Docker las vars de entorno no existen — skip.
// En runtime el contenedor las inyecta y la validación corre normalmente.
export const env =
  process.env.SKIP_ENV_VALIDATION === "1"
    ? (process.env as unknown as z.infer<typeof envSchema>)
    : envSchema.parse(process.env);
