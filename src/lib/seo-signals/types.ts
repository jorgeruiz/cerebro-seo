export type NextStepCategoria = "setup" | "urgente" | "oportunidad" | "mejora";

export type NextStepKind =
  | "meta"
  | "contenido-blog"
  | "contenido-landing"
  | "contenido-optimizar"
  | "interlinking"
  | "schema"
  | "tecnico"
  | "otro";

export type NextStepEsfuerzo = "bajo" | "medio" | "alto";
export type NextStepImpacto = "alto" | "medio" | "bajo";
export type NextStepOrigin = "data" | "ai-insight";

export interface NextStep {
  titulo: string;
  descripcion: string;
  categoria: NextStepCategoria;
  prioridad: number;        // 1–5, 1 = más urgente
  seccionDestino?: string;  // slug relativo: "keywords", "audit", "backlinks", etc.
  evidencia: string;        // dato específico que justifica el paso
  // ── Campos v2 (nullable para planes viejos) ──
  esfuerzo?: NextStepEsfuerzo | null;
  impacto?: NextStepImpacto | null;
  kind?: NextStepKind | null;
  targetUrl?: string | null;
  keywords?: string[] | null;
  // ── Campo v3: origen del step ──
  origin?: NextStepOrigin | null;
}

export interface AdvisorResult {
  steps: NextStep[];
  planId: string;
  tokensUsed: { input: number; output: number; cached: number };
  cost: number;
}
