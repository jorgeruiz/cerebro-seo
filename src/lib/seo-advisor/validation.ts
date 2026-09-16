import { z } from "zod/v4";

const VALID_CATEGORIAS = ["setup", "urgente", "oportunidad", "mejora"] as const;
const VALID_KINDS = ["meta", "contenido-blog", "contenido-landing", "schema", "tecnico", "otro"] as const;
const VALID_ESFUERZOS = ["bajo", "medio", "alto"] as const;
const VALID_IMPACTOS = ["alto", "medio", "bajo"] as const;
const VALID_SECCIONES = [
  "keywords", "audit", "backlinks", "competencia", "oportunidades",
  "terminos-busqueda", "trafico-paginas", "aeo-research", "contenido",
  "ai-search", "analisis", "configuracion",
] as const;

export const NextStepSchema = z.object({
  titulo: z.string().max(120),
  descripcion: z.string().max(500),
  categoria: z.enum(VALID_CATEGORIAS),
  prioridad: z.number().int().min(1).max(5),
  seccionDestino: z.enum(VALID_SECCIONES).optional(),
  evidencia: z.string().max(200),
  esfuerzo: z.enum(VALID_ESFUERZOS).nullable().optional(),
  impacto: z.enum(VALID_IMPACTOS).nullable().optional(),
  kind: z.enum(VALID_KINDS).nullable().optional(),
  targetUrl: z.string().nullable().optional(),
  keywords: z.array(z.string()).nullable().optional(),
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
  const result = NextStepArraySchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: z.prettifyError(result.error),
  };
}
