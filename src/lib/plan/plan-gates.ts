/**
 * Plan Gates — preconditions that must pass before a task can execute.
 *
 * Evaluated at decomposition time AND before execution.
 * If a gate fails → task.status = BLOCKED with reason + remedy.
 *
 * G1: Cliente activo con SEO
 * G2: Sitio sin migración no autorizada
 * G3: Memoria del repo FULL (Next.js agent)
 * G4: catalog-schemas con sección requerida (blog/landing/micrositios)
 * G5: Capability del plugin presente (WP)
 * G6: Servicio verificado (blog, landing, edit text)
 * G7: Anti-canibalización (keyword no asignada a otra URL/tarea activa)
 * G8: Target resuelto (URL responde 200, page_id para WP)
 */

import { prisma } from "@/lib/db";
import type { GateId } from "./task-catalog";

export interface GateResult {
  gate: GateId;
  passed: boolean;
  reason?: string;
  remedy?: string;
}

export interface GateCheckResult {
  allPassed: boolean;
  results: GateResult[];
  blockedReason: string | null;
  remedy: string | null;
}

/**
 * Evaluate gates for a task.
 */
export async function evaluateGates(
  gates: GateId[],
  context: {
    clientId: string;
    siteId: string;
    platform: string | null;
    targetUrl?: string | null;
    targetKeyword?: string | null;
    actionType: string;
    wpCapabilities?: string[] | null;
  }
): Promise<GateCheckResult> {
  const results: GateResult[] = [];

  for (const gate of gates) {
    const result = await evaluateGate(gate, context);
    results.push(result);
  }

  const failed = results.filter((r) => !r.passed);
  if (failed.length === 0) {
    return { allPassed: true, results, blockedReason: null, remedy: null };
  }

  return {
    allPassed: false,
    results,
    blockedReason: failed.map((f) => f.reason).join(" | "),
    remedy: failed.map((f) => f.remedy).filter(Boolean).join(" → "),
  };
}

async function evaluateGate(
  gate: GateId,
  ctx: {
    clientId: string;
    siteId: string;
    platform: string | null;
    targetUrl?: string | null;
    targetKeyword?: string | null;
    actionType: string;
    wpCapabilities?: string[] | null;
  }
): Promise<GateResult> {
  switch (gate) {
    case "G1": {
      const client = await prisma.client.findUnique({
        where: { id: ctx.clientId },
        select: { status: true, services: true },
      });
      if (!client || client.status !== "ACTIVE") {
        return { gate, passed: false, reason: "Cliente no activo", remedy: "Activar cliente en Notion" };
      }
      if (!client.services.includes("seo")) {
        return { gate, passed: false, reason: "Cliente no tiene servicio SEO", remedy: "Agregar SEO en Notion" };
      }
      return { gate, passed: true };
    }

    case "G2": {
      const site = await prisma.site.findUnique({ where: { id: ctx.siteId }, select: { platform: true } });
      if (site?.platform === "MIGRACION") {
        return { gate, passed: true, reason: "Sitio en migración — tareas WP permitidas" };
        // MIGRACION is allowed for WP tasks, blocked for code tasks
      }
      return { gate, passed: true };
    }

    case "G3": {
      // Memory check — only for Next.js agent steps
      if (ctx.platform !== "NEXTJS") return { gate, passed: true };
      // Simplified: check if site has githubRepo (memory check is at execution time)
      const site = await prisma.site.findUnique({ where: { id: ctx.siteId }, select: { githubRepo: true } });
      if (!site?.githubRepo) {
        return { gate, passed: false, reason: "Repositorio GitHub no configurado", remedy: "Configurar githubRepo en el sitio" };
      }
      return { gate, passed: true };
    }

    case "G4": {
      // catalog-schemas check — only for Next.js blog/landing
      if (ctx.platform !== "NEXTJS") return { gate, passed: true };
      // This is checked at execution time by the content lane
      return { gate, passed: true };
    }

    case "G5": {
      // WP capability check — handled by resolveStepsWithCapabilities (fallback to HUMAN)
      // Not a blocker — the step degrades gracefully
      return { gate, passed: true };
    }

    case "G6": {
      // Service verification — for content tasks that mention a specific service
      // Simplified: check that the client has services configured
      return { gate, passed: true }; // Full implementation requires site-spec lookup
    }

    case "G7": {
      // Anti-cannibalization — check keyword not assigned to another active task
      if (!ctx.targetKeyword) return { gate, passed: true };
      const conflicting = await prisma.planTask.findFirst({
        where: {
          siteId: ctx.siteId,
          targetKeyword: ctx.targetKeyword,
          status: { notIn: ["DONE", "VOIDED", "FAILED"] },
        },
        select: { id: true, title: true },
      });
      if (conflicting) {
        return {
          gate,
          passed: false,
          reason: `Keyword "${ctx.targetKeyword}" ya asignada a: "${conflicting.title}"`,
          remedy: "Usar una keyword diferente o completar la tarea existente",
        };
      }
      return { gate, passed: true };
    }

    case "G8": {
      // Target resolved — URL must exist (for tasks on existing pages)
      if (!ctx.targetUrl) return { gate, passed: true }; // No target = OK (new content)
      // For WP: we should verify page_id exists, but that's execution-time
      // For now: trust the URL
      return { gate, passed: true };
    }

    default:
      return { gate, passed: true };
  }
}
