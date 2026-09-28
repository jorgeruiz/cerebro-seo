import type {
  OrganicCompetitor,
  CompetitorPage,
  StrikingDistanceKeyword,
} from "@/server/providers/dataforseo";

export interface CompetitorWithPages extends OrganicCompetitor {
  topPages: CompetitorPage[];
}

export interface KeywordGap {
  keyword: string;
  competitorDomain: string;
  competitorPosition: number;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  intent: string | null;
}

export interface ResearchData {
  domain: string;
  strikingDistance: StrikingDistanceKeyword[];
  lowDifficulty: StrikingDistanceKeyword[];
  keywordGaps: KeywordGap[];
  competitors: CompetitorWithPages[];
  suggestions: ResearchSuggestion[] | null;
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
  keywordGaps: number;
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
    keywordGaps: string;
    suggestions: string;
  };
}
