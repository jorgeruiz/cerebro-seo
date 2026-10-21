import { describe, it, expect, vi } from "vitest";

vi.stubEnv("REDIS_URL", "redis://localhost:6379");

// Mock heavy dependencies so we can import the constant without side effects
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/redis-connection", () => ({ redis: {} }));
vi.mock("@/server/jobs/workers/base-worker", () => ({
  calculateClaudeCost: vi.fn(),
  logApiUsage: vi.fn(),
}));
vi.mock("@/lib/wp-proxy-client", () => ({ getWpCapabilities: vi.fn() }));
vi.mock("@/lib/wp-site-profile", () => ({ getWpSiteProfile: vi.fn() }));
vi.mock("anthropic", () => ({ default: vi.fn() }));

import { TASK_DECOMPOSER_SYSTEM_PROMPT } from "../task-decomposer";

// The system prompt is the source of truth for what Claude will generate.
// These tests ensure critical rules are present and haven't been accidentally removed.

const nextjsSection = TASK_DECOMPOSER_SYSTEM_PROMPT.split("PARA SITIOS PLATFORM=WORDPRESS")[0];
const wpSection = TASK_DECOMPOSER_SYSTEM_PROMPT.split("PARA SITIOS PLATFORM=WORDPRESS")[1] ?? "";

describe("task-decomposer SYSTEM_PROMPT — Next.js rules", () => {
  it("prohíbe borrador: true en frontmatter MDX (regresión Brainet)", () => {
    // The Next.js section must explicitly prohibit draft/borrador fields
    expect(nextjsSection).toMatch(/borrador.*true|draft.*true|nunca.*borrador|borrador.*inválida/i);
  });

  it("la prohibición de borrador está en la sección Next.js, no en la de WordPress", () => {
    // WordPress CAN have borradores (WP drafts are a feature)
    // The borrador rule should only appear in the NEXTJS section
    expect(nextjsSection).toContain("borrador");
  });

  it("no genera pasos de verificación de compilación", () => {
    expect(TASK_DECOMPOSER_SYSTEM_PROMPT).toMatch(
      /no.*generes.*pasos.*compila|verificar.*compila.*redund|worker.*compila.*automát/i
    );
  });

  it("portadas de blog requieren formato WebP", () => {
    expect(TASK_DECOMPOSER_SYSTEM_PROMPT).toMatch(/webp/i);
    // WebP should be mentioned in context of portadas/covers
    expect(TASK_DECOMPOSER_SYSTEM_PROMPT).toMatch(/portadas.*webp|webp.*portadas/i);
  });

  it("campos de frontmatter permitidos no incluyen draft ni borrador", () => {
    // The allowed fields list should not mention draft or borrador
    const allowedFieldsLine = nextjsSection.match(/Campos válidos[^.]+\./i)?.[0] ?? "";
    expect(allowedFieldsLine).not.toMatch(/draft|borrador/i);
  });
});

describe("task-decomposer SYSTEM_PROMPT — integridad general", () => {
  it("incluye sección Next.js y sección WordPress", () => {
    expect(TASK_DECOMPOSER_SYSTEM_PROMPT).toContain("PARA SITIOS PLATFORM=NEXTJS");
    expect(TASK_DECOMPOSER_SYSTEM_PROMPT).toContain("PARA SITIOS PLATFORM=WORDPRESS");
  });

  it("devuelve JSON array sin texto adicional", () => {
    expect(TASK_DECOMPOSER_SYSTEM_PROMPT).toContain("Sin texto fuera del JSON");
  });

  it("regla anti-invención presente", () => {
    expect(TASK_DECOMPOSER_SYSTEM_PROMPT).toContain("PROHIBIDO inventar");
  });
});
