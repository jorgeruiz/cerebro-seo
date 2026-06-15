import { Queue } from "bullmq";
import { redisBullMQ } from "@/lib/redis";

const connection = { connection: redisBullMQ };

// Jobs de recolección de datos (sin Claude)
// crawls, rankings, backlinks, competidores, AI search
export const dataCollectionQueue = new Queue("data-collection", {
  ...connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 60_000 }, // 1m → 2m → 4m
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
});

// Jobs de análisis con Claude
// insights, cierre de ciclo, reportes mensuales
export const aiAnalysisQueue = new Queue("ai-analysis", {
  ...connection,
  defaultJobOptions: {
    attempts: 2, // reintentar Claude es caro — solo 2 intentos
    backoff: { type: "fixed", delay: 30_000 },
    removeOnComplete: { count: 20 },
    removeOnFail: { count: 50 },
  },
});

// Jobs de sincronización con Cerebro/Notion (I/O puro)
export const syncQueue = new Queue("sync", {
  ...connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { count: 30 },
    removeOnFail: { count: 100 },
  },
});

// Tipos de jobs — sirven como documentación y para type-safety en los workers

export type DataCollectionJobName =
  | "crawler:audit"
  | "crawler:audit-quick"
  | "tracking:rankings-priority"
  | "tracking:rankings-bulk"
  | "analysis:backlinks"
  | "analysis:competitors"
  | "analysis:ai-search";

export type AiAnalysisJobName =
  | "insights:generate"
  | "advisor:generate"
  | "cycle:close"
  | "report:monthly";

export type SyncJobName = "sync:cerebro";

export interface InsightsJobData {
  clientId: string;
  trigger: "scheduled" | "audit_complete" | "backlink_alert" | "ranking_drop";
  priority?: "normal" | "high" | "urgent";
  context?: Record<string, unknown>;
}

export interface SeoAdvisorJobData {
  clientId: string;
}

export interface CrawlerJobData {
  clientId: string;
  siteId: string;
  mode?: "full" | "quick";
}

export interface RankTrackingJobData {
  clientId: string;
  mode?: "priority" | "bulk";
}

export interface BacklinksJobData {
  clientId: string;
  siteId: string;
}

export interface CycleCloseJobData {
  clientId?: string; // si no se provee, corre para todos los clientes activos
  cycleId?: string;
}

export interface ReportJobData {
  clientId: string;
  cycleId: string;
}
