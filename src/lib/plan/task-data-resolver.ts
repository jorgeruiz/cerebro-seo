/**
 * Task Data Resolver — gathers evidence from Cerebro SEO's databases
 * before the decomposer creates steps.
 *
 * Each actionType may declare required evidence. This module queries the
 * databases and returns structured rows. If required evidence is empty,
 * the decomposer blocks the task as NEEDS_INPUT.
 *
 * No paid API calls. Data comes from: audit tables, rank tracking, GSC cache, task fields.
 */

import { prisma } from "@/lib/db";
import type { ActionType } from "./task-catalog";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EvidenceRow {
  label: string;
  value: string;
  /** Optional "proposed" value for before→after display */
  proposed?: string;
  source: string;
  date: string;
}

export interface TaskEvidence {
  rows: EvidenceRow[];
  summary: string;
  /** If true, there's enough data. If false, required sources returned empty. */
  sufficient: boolean;
  emptySources: string[];
}

/**
 * Which actionTypes REQUIRE evidence rows (not just "nice to have").
 * If the actionType is here and the resolver returns 0 rows, the task
 * goes to NEEDS_INPUT with a message about where to get the data.
 */
export const REQUIRED_EVIDENCE: Partial<Record<ActionType, {
  /** Human-readable description of what data is needed */
  description: string;
  /** Where to get it (shown in NEEDS_INPUT remedy) */
  source: string;
}>> = {
  fix_redirect: {
    description: "URLs con error 404 y sus destinos propuestos",
    source: "Ejecutar un crawl o revisar GSC > Cobertura > Excluidas > No encontrada (404)",
  },
  fix_broken_links: {
    description: "URLs de enlaces rotos detectados en el sitio",
    source: "Ejecutar un crawl o revisar el módulo de auditoría",
  },
  verify_indexation: {
    description: "URLs específicas a verificar en el índice",
    source: "Listar las URLs nuevas o problemáticas, o usar GSC > Cobertura",
  },
  internal_links: {
    description: "URL origen donde agregar enlaces y URLs destino",
    source: "Definir targetUrl en la tarea o revisar el mapa de enlaces del sitio",
  },
  configure_canonical: {
    description: "URL que necesita canonical y la URL canónica correcta",
    source: "Definir targetUrl y canonicalUrl en la tarea",
  },
  merge_content: {
    description: "URLs de las páginas a fusionar y URL destino",
    source: "Definir sourceUrls y targetUrl en la tarea",
  },
  optimize_alt_text: {
    description: "URL de la página con imágenes a optimizar",
    source: "Definir targetUrl en la tarea",
  },
};

// ─── Resolver ───────────────────────────────────────────────────────────────

export async function resolveTaskEvidence(
  actionType: ActionType,
  clientId: string,
  siteId: string,
  targetUrl?: string | null,
  targetKeyword?: string | null,
): Promise<TaskEvidence> {
  const rows: EvidenceRow[] = [];
  const emptySources: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  try {
    switch (actionType) {
      case "update_meta": {
        if (targetUrl) rows.push({ label: "URL target", value: targetUrl, source: "task", date: today });
        if (targetKeyword) rows.push({ label: "Keyword focus", value: targetKeyword, source: "task", date: today });
        if (!targetUrl) emptySources.push("targetUrl (no URL definida)");
        break;
      }

      case "fix_redirect": {
        const auditIssues = await prisma.auditIssue.findMany({
          where: { audit: { siteId }, type: { contains: "404" } },
          take: 20,
          orderBy: { audit: { date: "desc" } },
          select: { affectedUrl: true, title: true, audit: { select: { date: true } } },
        });
        for (const issue of auditIssues) {
          if (issue.affectedUrl) {
            rows.push({
              label: "404",
              value: issue.affectedUrl,
              proposed: "(definir destino)",
              source: "audit",
              date: issue.audit.date.toISOString().slice(0, 10),
            });
          }
        }
        if (auditIssues.length === 0) emptySources.push("audit (no 404s found)");
        break;
      }

      case "fix_broken_links": {
        const brokenLinks = await prisma.auditIssue.findMany({
          where: {
            audit: { siteId },
            type: { in: ["broken_link", "broken-link", "404_internal"] },
          },
          take: 20,
          orderBy: { audit: { date: "desc" } },
          select: { affectedUrl: true, title: true, audit: { select: { date: true } } },
        });
        for (const issue of brokenLinks) {
          if (issue.affectedUrl) {
            rows.push({
              label: "Enlace roto",
              value: issue.affectedUrl,
              proposed: issue.title ?? "(corregir)",
              source: "audit",
              date: issue.audit.date.toISOString().slice(0, 10),
            });
          }
        }
        if (brokenLinks.length === 0) emptySources.push("audit (no broken links found)");
        break;
      }

      case "keyword_research": {
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
            date: today,
          });
        }
        // keyword_research doesn't REQUIRE existing keywords — it discovers new ones
        break;
      }

      case "verify_indexation": {
        if (targetUrl) {
          rows.push({ label: "URL a verificar", value: targetUrl, source: "task", date: today });
        }
        // Also check recent DONE tasks that created new pages
        const recentDone = await prisma.planTask.findMany({
          where: {
            siteId,
            status: "DONE",
            actionType: { in: ["create_blog", "create_landing"] },
            completedAt: { gte: new Date(Date.now() - 30 * 86400000) },
          },
          take: 10,
          select: { title: true, resultUrls: true, completedAt: true },
        });
        for (const t of recentDone) {
          for (const url of (t.resultUrls ?? [])) {
            rows.push({
              label: "Página nueva (sin verificar)",
              value: url,
              source: "plan",
              date: t.completedAt?.toISOString().slice(0, 10) ?? today,
            });
          }
        }
        if (!targetUrl && recentDone.length === 0) emptySources.push("task (no URLs definidas)");
        break;
      }

      case "internal_links": {
        if (targetUrl) {
          rows.push({ label: "URL origen", value: targetUrl, source: "task", date: today });
        } else {
          emptySources.push("targetUrl (no URL origen definida)");
        }
        break;
      }

      case "configure_canonical": {
        if (targetUrl) {
          rows.push({ label: "URL", value: targetUrl, source: "task", date: today });
        } else {
          emptySources.push("targetUrl (no URL definida)");
        }
        break;
      }

      case "optimize_alt_text": {
        if (targetUrl) {
          rows.push({ label: "Página con imágenes", value: targetUrl, source: "task", date: today });
        } else {
          emptySources.push("targetUrl (no URL definida)");
        }
        break;
      }

      case "merge_content": {
        if (targetUrl) {
          rows.push({ label: "URL destino", value: targetUrl, source: "task", date: today });
        }
        // sourceUrls typically come from the task inputs — we can't resolve them from DB
        if (!targetUrl) emptySources.push("targetUrl/sourceUrls (no URLs definidas)");
        break;
      }

      default:
        if (targetUrl) rows.push({ label: "URL target", value: targetUrl, source: "task", date: today });
        if (targetKeyword) rows.push({ label: "Keyword", value: targetKeyword, source: "task", date: today });
        break;
    }
  } catch (err) {
    console.warn(`[task-data-resolver] Error resolving evidence for ${actionType}: ${(err as Error).message}`);
  }

  // Determine sufficiency: check if required evidence is missing
  const req = REQUIRED_EVIDENCE[actionType];
  const sufficient = req ? rows.length > 0 : true;
  if (req && rows.length === 0 && !emptySources.length) {
    emptySources.push(req.description);
  }

  const summary = rows.length > 0
    ? `${rows.length} datos de ${Array.from(new Set(rows.map((r) => r.source))).join(", ")}`
    : "Sin datos disponibles";

  return { rows, summary, sufficient, emptySources };
}

// ─── Vague reference validator ──────────────────────────────────────────────

const VAGUE_PATTERNS = [
  /\blas\s+URLs?\b/i,
  /\blas\s+keywords?\b/i,
  /\blas\s+palabras\s+clave\b/i,
  /\blas\s+páginas?\b/i,
  /\blos\s+enlaces?\b/i,
  /\blas\s+redirecciones?\b/i,
  /\blos\s+artículos?\b/i,
  /\blas\s+imágenes?\b/i,
];

/**
 * Rejects text that mentions a collection ("las URLs", "las keywords", etc.)
 * without having concrete evidence rows to back it up.
 */
export function validateNoVagueReferences(text: string, evidenceRowCount: number): {
  valid: boolean;
  vagueMatches: string[];
} {
  if (evidenceRowCount > 0) return { valid: true, vagueMatches: [] };

  const vagueMatches: string[] = [];
  for (const pattern of VAGUE_PATTERNS) {
    const match = text.match(pattern);
    if (match) vagueMatches.push(match[0]);
  }

  return { valid: vagueMatches.length === 0, vagueMatches };
}
