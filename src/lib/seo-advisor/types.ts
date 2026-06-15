export type NextStepCategoria = "setup" | "urgente" | "oportunidad" | "mejora";

export interface NextStep {
  titulo: string;
  descripcion: string;
  categoria: NextStepCategoria;
  prioridad: number;        // 1–5, 1 = más urgente
  seccionDestino?: string;  // slug relativo: "keywords", "audit", "backlinks", etc.
  evidencia: string;        // dato específico que justifica el paso
}

export interface AdvisorResult {
  steps: NextStep[];
  planId: string;
  tokensUsed: { input: number; output: number; cached: number };
  cost: number;
}
