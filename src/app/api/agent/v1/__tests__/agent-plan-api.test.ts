/**
 * Tests for Agent Plan API endpoints.
 *
 * These are structural/contract tests that verify the route files exist,
 * have the correct exports, and validate Zod schemas. They don't hit a real DB.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

// ─── Schemas (mirror the ones in the route files) ──────────────────────────

const createPlanSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  focus: z.enum(["all", "technical_only"]).default("all"),
  summary: z.string().max(5000).optional(),
  source: z.literal("agent").default("agent"),
});

const actionSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  url: z.string().max(500).optional(),
  targetKeyword: z.string().max(200).optional(),
  priority: z.number().int().min(1).max(10).default(5),
  category: z.enum(["technical", "content", "setup"]).default("technical"),
  mode: z.enum(["AI", "HYBRID", "HUMAN"]).default("HYBRID"),
  assignee: z.enum(["ejecutor", "felix"]).default("ejecutor"),
  requiresApproval: z.boolean().default(false),
  dataSource: z.string().max(2000).optional(),
  steps: z.array(z.string().max(1000)).max(20).optional(),
});

const batchSchema = z.array(actionSchema).min(1).max(50);

const patchPlanSchema = z.object({
  status: z.enum(["draft", "approved", "in_progress", "completed"]),
});

const patchActionSchema = z.object({
  status: z.enum(["pending", "in_progress", "blocked", "waiting_approval", "done", "skipped"]),
  note: z.string().max(2000).optional(),
  url: z.string().url().max(500).optional(),
  steps: z.array(z.string().max(1000)).max(20).optional(),
});

// ─── Route structure tests ──────────────────────────────────────────────────

describe("Agent Plan API — route structure", () => {
  it("POST /clients/{id}/plans route exists and exports POST + GET", () => {
    const source = readFileSync(
      join(ROOT, "src/app/api/agent/v1/clients/[id]/plans/route.ts"),
      "utf-8"
    );
    expect(source).toContain("export const POST");
    expect(source).toContain("export const GET");
    expect(source).toContain("withAgentAuth");
  });

  it("POST /plans/{planId}/actions route exists and exports POST", () => {
    const source = readFileSync(
      join(ROOT, "src/app/api/agent/v1/plans/[planId]/actions/route.ts"),
      "utf-8"
    );
    expect(source).toContain("export const POST");
    expect(source).toContain("withAgentAuth");
    expect(source).toContain("ACTION_TYPES");
  });

  it("GET/PATCH /plans/{planId} route exists and exports both", () => {
    const source = readFileSync(
      join(ROOT, "src/app/api/agent/v1/plans/[planId]/route.ts"),
      "utf-8"
    );
    expect(source).toContain("export const GET");
    expect(source).toContain("export const PATCH");
  });

  it("PATCH /actions/{id} route exists with enhanced statuses", () => {
    const source = readFileSync(
      join(ROOT, "src/app/api/agent/v1/actions/[id]/route.ts"),
      "utf-8"
    );
    expect(source).toContain("export const PATCH");
    expect(source).toContain('"blocked"');
    expect(source).toContain('"skipped"');
    expect(source).toContain('"waiting_approval"');
    expect(source).toContain("agentSteps");
  });
});

// ─── Schema: create plan ────────────────────────────────────────────────────

describe("Agent Plan API — create plan schema", () => {
  it("accepts valid plan creation", () => {
    const result = createPlanSchema.safeParse({
      month: "2026-12",
      focus: "all",
      summary: "Plan de prueba",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid month format", () => {
    const result = createPlanSchema.safeParse({ month: "2026-13" });
    expect(result.success).toBe(false);
  });

  it("rejects month without leading zero", () => {
    const result = createPlanSchema.safeParse({ month: "2026-1" });
    expect(result.success).toBe(false);
  });

  it("defaults focus to all", () => {
    const result = createPlanSchema.parse({ month: "2026-06" });
    expect(result.focus).toBe("all");
  });

  it("accepts technical_only focus", () => {
    const result = createPlanSchema.parse({ month: "2026-06", focus: "technical_only" });
    expect(result.focus).toBe("technical_only");
  });
});

// ─── Schema: create actions (batch) ─────────────────────────────────────────

describe("Agent Plan API — create actions schema", () => {
  it("accepts a valid batch of actions", () => {
    const result = batchSchema.safeParse([
      {
        type: "update_meta",
        title: "Optimizar meta de /servicios",
        description: "Ajustar meta title y description",
        assignee: "felix",
        mode: "HUMAN",
        steps: ["Revisar meta actual", "Escribir nueva versión", "Verificar en GSC"],
      },
      {
        type: "create_blog",
        title: "Blog sobre SEO local",
        priority: 2,
        category: "content",
        mode: "AI",
        assignee: "ejecutor",
      },
    ]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].steps).toHaveLength(3);
      expect(result.data[0].assignee).toBe("felix");
      expect(result.data[1].mode).toBe("AI");
    }
  });

  it("rejects empty batch", () => {
    const result = batchSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it("rejects batch over 50", () => {
    const big = Array.from({ length: 51 }, (_, i) => ({
      type: "update_meta",
      title: `Task ${i}`,
    }));
    const result = batchSchema.safeParse(big);
    expect(result.success).toBe(false);
  });

  it("defaults category to technical", () => {
    const result = actionSchema.parse({ type: "schema", title: "Add FAQ schema" });
    expect(result.category).toBe("technical");
  });

  it("defaults assignee to ejecutor", () => {
    const result = actionSchema.parse({ type: "schema", title: "Add FAQ schema" });
    expect(result.assignee).toBe("ejecutor");
  });

  it("defaults mode to HYBRID", () => {
    const result = actionSchema.parse({ type: "schema", title: "Test" });
    expect(result.mode).toBe("HYBRID");
  });

  it("accepts steps as string array", () => {
    const result = actionSchema.parse({
      type: "edit_page_text",
      title: "Reescribir intro",
      steps: ["Leer versión actual", "Reescribir con keyword", "Revisar"],
    });
    expect(result.steps).toEqual(["Leer versión actual", "Reescribir con keyword", "Revisar"]);
  });

  it("rejects steps with more than 20 items", () => {
    const result = actionSchema.safeParse({
      type: "edit_page_text",
      title: "Test",
      steps: Array.from({ length: 21 }, (_, i) => `Step ${i}`),
    });
    expect(result.success).toBe(false);
  });
});

// ─── Schema: PATCH plan status ──────────────────────────────────────────────

describe("Agent Plan API — patch plan schema", () => {
  it("accepts valid transitions", () => {
    for (const s of ["draft", "approved", "in_progress", "completed"]) {
      const result = patchPlanSchema.safeParse({ status: s });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    const result = patchPlanSchema.safeParse({ status: "archived" });
    expect(result.success).toBe(false);
  });
});

// ─── Schema: PATCH action status ────────────────────────────────────────────

describe("Agent Plan API — patch action schema", () => {
  it("accepts all valid statuses", () => {
    for (const s of ["pending", "in_progress", "blocked", "waiting_approval", "done", "skipped"]) {
      const result = patchActionSchema.safeParse({ status: s, note: "test note" });
      expect(result.success).toBe(true);
    }
  });

  it("rejects unknown status", () => {
    const result = patchActionSchema.safeParse({ status: "cancelled" });
    expect(result.success).toBe(false);
  });

  it("accepts steps array in PATCH", () => {
    const result = patchActionSchema.parse({
      status: "in_progress",
      steps: ["Paso 1", "Paso 2"],
    });
    expect(result.steps).toEqual(["Paso 1", "Paso 2"]);
  });
});

// ─── Business logic: blocked/skipped require note ───────────────────────────

describe("Agent Plan API — blocked/skipped note requirement", () => {
  it("route enforces note for blocked status", () => {
    const source = readFileSync(
      join(ROOT, "src/app/api/agent/v1/actions/[id]/route.ts"),
      "utf-8"
    );
    expect(source).toContain('requires a note');
    expect(source).toContain('"blocked"');
    expect(source).toContain('"skipped"');
  });
});

// ─── Business logic: plan 409 on duplicate ──────────────────────────────────

describe("Agent Plan API — plan duplicate handling", () => {
  it("route checks existing plan and returns 409 if not draft", () => {
    const source = readFileSync(
      join(ROOT, "src/app/api/agent/v1/clients/[id]/plans/route.ts"),
      "utf-8"
    );
    expect(source).toContain("clientId_month");
    expect(source).toContain("409");
    expect(source).toContain("Plan already exists and is not a draft");
  });

  it("route allows replacement of PLANNING (draft) plans", () => {
    const source = readFileSync(
      join(ROOT, "src/app/api/agent/v1/clients/[id]/plans/route.ts"),
      "utf-8"
    );
    expect(source).toContain("PLANNING");
    expect(source).toContain("delete");
    expect(source).toContain("replaced");
  });
});

// ─── Business logic: action type validation ─────────────────────────────────

describe("Agent Plan API — action type validation against catalog", () => {
  it("route imports ACTION_TYPES from task-catalog", () => {
    const source = readFileSync(
      join(ROOT, "src/app/api/agent/v1/plans/[planId]/actions/route.ts"),
      "utf-8"
    );
    expect(source).toContain('from "@/lib/plan/task-catalog"');
    expect(source).toContain("ACTION_TYPES");
  });

  it("route rejects invalid types with clear error", () => {
    const source = readFileSync(
      join(ROOT, "src/app/api/agent/v1/plans/[planId]/actions/route.ts"),
      "utf-8"
    );
    expect(source).toContain("Invalid action types in batch");
    expect(source).toContain("invalidActions");
    expect(source).toContain("Valid types:");
  });
});

// ─── Progress: VOIDED counts as closed ──────────────────────────────────────

describe("Agent Plan API — progress includes HUMAN and skipped", () => {
  it("plan progress counts VOIDED as closed", () => {
    const source = readFileSync(
      join(ROOT, "src/app/api/agent/v1/plans/[planId]/route.ts"),
      "utf-8"
    );
    // The progress formula includes VOIDED
    expect(source).toContain('"DONE"');
    expect(source).toContain('"VOIDED"');
    // closed = DONE + VOIDED
    expect(source).toMatch(/closed.*DONE.*VOIDED|VOIDED.*DONE/s);
  });

  it("plan GET counts humanWork by assignee", () => {
    const source = readFileSync(
      join(ROOT, "src/app/api/agent/v1/plans/[planId]/route.ts"),
      "utf-8"
    );
    expect(source).toContain("humanWork");
    expect(source).toContain('"felix"');
  });

  it("auto-completes plan when all actions closed", () => {
    const source = readFileSync(
      join(ROOT, "src/app/api/agent/v1/actions/[id]/route.ts"),
      "utf-8"
    );
    expect(source).toContain("allClosed");
    expect(source).toContain("PUBLISHED");
    expect(source).toContain("completedAt");
  });
});

// ─── PLAN_SOURCE=agent flag ─────────────────────────────────────────────────

describe("Agent Plan API — PLAN_SOURCE=agent flag", () => {
  it("env.ts defines PLAN_SOURCE with agent/legacy enum", () => {
    const source = readFileSync(join(ROOT, "src/env.ts"), "utf-8");
    expect(source).toContain("PLAN_SOURCE");
    expect(source).toContain('"agent"');
    expect(source).toContain('"legacy"');
  });

  it("actionSendToPlan is guarded by PLAN_SOURCE=agent", () => {
    const source = readFileSync(
      join(ROOT, "src/app/(admin)/clientes/[id]/analisis/plan-actions.ts"),
      "utf-8"
    );
    expect(source).toContain('process.env.PLAN_SOURCE === "agent"');
    // The guard appears before the ADMIN role check
    const guardIdx = source.indexOf('PLAN_SOURCE === "agent"');
    const adminIdx = source.indexOf('Solo administradores pueden enviar al plan');
    expect(guardIdx).toBeLessThan(adminIdx);
  });

  it("actionConfirmProposal is guarded by PLAN_SOURCE=agent", () => {
    const source = readFileSync(
      join(ROOT, "src/app/(admin)/clientes/[id]/analisis/plan-actions.ts"),
      "utf-8"
    );
    // Count occurrences — should guard both functions
    const matches = source.match(/PLAN_SOURCE === "agent"/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it("analysis:generate is NOT auto-scheduled", () => {
    const source = readFileSync(
      join(ROOT, "src/server/jobs/schedulers.ts"),
      "utf-8"
    );
    expect(source).not.toContain("analysis:generate");
  });

  it("análisis page shows deprecated badge", () => {
    const source = readFileSync(
      join(ROOT, "src/app/(admin)/clientes/[id]/analisis/page.tsx"),
      "utf-8"
    );
    expect(source).toContain("Deprecated");
    expect(source).toContain("deprecada");
  });
});

// ─── Schema: agentSteps field exists ────────────────────────────────────────

describe("Agent Plan API — agentSteps schema field", () => {
  it("PlanTask schema has agentSteps Json field", () => {
    const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf-8");
    expect(schema).toContain("agentSteps");
    expect(schema).toContain("Json?");
  });

  it("migration for agentSteps exists", () => {
    const sql = readFileSync(
      join(ROOT, "prisma/migrations/20261125190000_add_agent_steps/migration.sql"),
      "utf-8"
    );
    expect(sql).toContain("agentSteps");
    expect(sql).toContain("JSONB");
  });

  it("GET /plans/{planId} exposes steps field in actions", () => {
    const source = readFileSync(
      join(ROOT, "src/app/api/agent/v1/plans/[planId]/route.ts"),
      "utf-8"
    );
    expect(source).toContain("agentSteps: true");
    expect(source).toContain("steps: t.agentSteps");
  });

  it("PATCH /actions/{id} writes agentSteps from steps input", () => {
    const source = readFileSync(
      join(ROOT, "src/app/api/agent/v1/actions/[id]/route.ts"),
      "utf-8"
    );
    expect(source).toContain("agentSteps");
    // Input accepts array of strings
    expect(source).toContain("z.array(z.string()");
  });

  it("POST /plans/{planId}/actions writes agentSteps from steps input", () => {
    const source = readFileSync(
      join(ROOT, "src/app/api/agent/v1/plans/[planId]/actions/route.ts"),
      "utf-8"
    );
    expect(source).toContain("agentSteps: action.steps");
  });
});
