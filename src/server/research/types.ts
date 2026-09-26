import type {
  OrganicCompetitor,
  CompetitorPage,
  StrikingDistanceKeyword,
  TopKeywordResult,
} from "@/server/providers/dataforseo";

export interface CompetitorWithPages extends OrganicCompetitor {
  topPages: CompetitorPage[];
}

export interface ResearchData {
  domain: string;
  strikingDistance: StrikingDistanceKeyword[];
  lowDifficulty: TopKeywordResult[];
  competitors: CompetitorWithPages[];
  suggestions: ResearchSuggestion[] | null; // null if Claude not called
  costBreakdown: CostBreakdown;
}

export interface ResearchSuggestion {
  tipo: "quick-win" | "contenido-nuevo" | "optimizar-existente";
  titulo: string;
  descripcion: string;
  targetUrl: string | null;
  keywords: string[];
  prioridad: number; // 1-5
  razon: string;
}

export interface CostBreakdown {
  strikingDistance: number;
  competitors: number;
  competitorPages: number;
  suggestions: number;
  total: number;
}

export interface ResearchEstimate {
  competitorCount: number;
  pagesPerCompetitor: number;
  estimatedCost: number;
  breakdown: {
    strikingDistance: string;
    competitors: string;
    competitorPages: string;
    suggestions: string;
  };
}
