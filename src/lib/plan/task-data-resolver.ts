/**
 * Task Data Resolver — gathers evidence from Cerebro SEO's databases
 * before the LLM generates step parameters.
 *
 * Each actionType declares its dataSources. This module queries them
 * and returns structured evidence that the LLM uses to fill concrete
 * values into the step templates.
 *
 * No paid API calls unless the catalog explicitly requires them.
 * Data comes from: GSC, GA4, audit tables, rank tracking, crawl, plugin.
 */

import { prisma } from "@/lib/db";
import type { ActionType } from "./task-catalog";

export interface EvidenceRow {
  label: string;
  value: string;
  source: string;
  date: string;
}

export interface TaskEvidence {
  rows: EvidenceRow[];
  summary: string;
  /** If true, there's enough data. If false, some sources returned empty. */
  sufficient: boolean;
  emptySources: string[];
}

/**
 * Resolve evidence for a task based on its actionType and target.
 * Returns structured data that the LLM uses to fill step parameters.
 */
export async function resolveTaskEvidence(
  actionType: ActionType,
  clientId: string,
  siteId: string,
  targetUrl?: string | null,
  targetKeyword?: string | null,
): Promise<TaskEvidence> {
  const rows: EvidenceRow[] = [];
  const emptySources: string[] = [];

  try {
    switch (actionType) {
      case "update_meta": {
        if (targetUrl) {
          rows.push({ label: "URL target", value: targetUrl, source: "task", date: new Date().toISOString().slice(0, 10) });
        }
        if (targetKeyword) {
          rows.push({ label: "Keyword focus", value: targetKeyword, source: "task", date: new Date().toISOString().slice(0, 10) });
        }
        break;
      }

      case "fix_redirect": {
        // Get 404 URLs from audit issues
        const auditIssues = await prisma.auditIssue.findMany({
          where: {
            audit: { siteId },
            type: { contains: "404" },
          },
          take: 20,
          orderBy: { audit: { date: "desc" } },
          select: { affectedUrl: true, title: true, audit: { select: { date: true } } },
        });
        for (const issue of auditIssues) {
          if (issue.affectedUrl) {
            rows.push({
              label: "404",
              value: issue.affectedUrl,
              source: "audit",
              date: issue.audit.date.toISOString().slice(0, 10),
            });
          }
        }
        if (auditIssues.length === 0) emptySources.push("audit (no 404s found)");
        break;
      }

      case "keyword_research": {
        // Get existing keywords
        const keywords = await prisma.keyword.findMany({
          where: { clientId, isPriority: true, deletedAt: null },
          take: 20,
          select: { term: true, category: true, targetUrl: true },
        });
        for (const kw of keywords) {
          rows.push({
            label: "Keyword existente",
            value: `${kw.term}${kw.targetUrl ? ` → ${kw.targetUrl}` : ""}`,
            source: "rank_tracking",
            date: new Date().toISOString().slice(0, 10),
          });
        }
        if (keywords.length === 0) emptySources.push("rank_tracking (no keywords)");
        break;
      }

      case "verify_indexation": {
        // Get URLs to check from recent content tasks
        if (targetUrl) {
          rows.push({
            label: "URL a verificar",
            value: targetUrl,
            source: "task",
            date: new Date().toISOString().slice(0, 10),
          });
        }
        break;
      }

      default:
        // For other types, just include target info
        if (targetUrl) {
          rows.push({ label: "URL target", value: targetUrl, source: "task", date: new Date().toISOString().slice(0, 10) });
        }
        if (targetKeyword) {
          rows.push({ label: "Keyword", value: targetKeyword, source: "task", date: new Date().toISOString().slice(0, 10) });
        }
        break;
    }
  } catch (err) {
    console.warn(`[task-data-resolver] Error resolving evidence for ${actionType}: ${(err as Error).message}`);
  }

  const sufficient = emptySources.length === 0;
  const summary = rows.length > 0
    ? `${rows.length} datos de ${Array.from(new Set(rows.map((r) => r.source))).join(", ")}`
    : "Sin datos disponibles";

  return { rows, summary, sufficient, emptySources };
}
