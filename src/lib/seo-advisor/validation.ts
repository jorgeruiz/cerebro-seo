import { z } from "zod/v4";

const VALID_CATEGORIAS = ["setup", "urgente", "oportunidad", "mejora"] as const;
const VALID_KINDS = ["meta", "contenido-blog", "contenido-landing", "contenido-optimizar", "interlinking", "schema", "tecnico", "otro"] as const;
const VALID_ESFUERZOS = ["bajo", "medio", "alto"] as const;
const VALID_IMPACTOS = ["alto", "medio", "bajo"] as const;
const VALID_ORIGINS = ["data", "ai-insight"] as const;
const VALID_SECCIONES = [
  "keywords", "audit", "backlinks", "competencia", "oportunidades",
  "terminos-busqueda", "trafico-paginas", "aeo-research", "contenido",
  "ai-search", "analisis", "configuracion",
] as const;

export const NextStepSchema = z.object({
  titulo: z.string().max(120),
  descripcion: z.string().max(500),
  categoria: z.enum(VALID_CATEGORIAS),
  prioridad: z.number().int().min(1).max(7),
  seccionDestino: z.enum(VALID_SECCIONES).optional(),
  evidencia: z.string().max(200),
  esfuerzo: z.enum(VALID_ESFUERZOS).nullable().optional(),
  impacto: z.enum(VALID_IMPACTOS).nullable().optional(),
  kind: z.enum(VALID_KINDS).nullable().optional(),
  targetUrl: z.string().nullable().optional(),
  keywords: z.array(z.string()).nullable().optional(),
  origin: z.enum(VALID_ORIGINS).nullable().optional(),
});

export const NextStepArraySchema = z.array(NextStepSchema);

export type ValidatedNextStep = z.infer<typeof NextStepSchema>;

/**
 * Valida un array de steps contra el schema Zod.
 * Retorna { success: true, data } o { success: false, error }.
 */
export function validateNextSteps(raw: unknown): {
  success: true;
  data: ValidatedNextStep[];
} | {
  success: false;
  error: string;
} {
  // Try full array first (fast path)
  const result = NextStepArraySchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }

  // Fallback: parse item by item, keep valid ones
  if (Array.isArray(raw) && raw.length > 0) {
    const valid: ValidatedNextStep[] = [];
    const errors: string[] = [];
    for (const item of raw) {
      const r = NextStepSchema.safeParse(item);
      if (r.success) {
        valid.push(r.data);
      } else {
        errors.push(z.prettifyError(r.error).slice(0, 100));
      }
    }
    if (valid.length > 0) {
      if (errors.length > 0) {
        console.warn(`[validation] ${errors.length} steps dropped, ${valid.length} kept. Errors: ${errors[0]}`);
      }
      return { success: true, data: valid };
    }
  }

  return {
    success: false,
    error: z.prettifyError(result.error),
  };
}
