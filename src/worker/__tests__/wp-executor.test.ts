/**
 * Tests para wp-executor.ts
 *
 * Verifica:
 * 1. SEO steps SIEMPRE stagean (stagedChange) — nunca aplican directamente.
 * 2. Publish steps llaman a publishWpPost con status=draft.
 * 3. updateWpSeo NO es llamado (se aplica en publishWpPlanAction, no aquí).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock Anthropic SDK — class mock for `new Anthropic()`
vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: '{"meta_title":"Título de prueba para SEO","meta_description":"Descripción de prueba para SEO con exactamente el largo correcto y CTA."}' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    };
  }
  return { default: MockAnthropic };
});

const { mockUpdateWpSeo, mockPublishWpPost } = vi.hoisted(() => ({
  mockUpdateWpSeo: vi.fn(),
  mockPublishWpPost: vi.fn().mockResolvedValue({
    ok: true,
    data: { post_id: 123, draft_url: "https://example.com/?p=123&preview=true" },
  }),
}));

vi.mock("@/lib/wp-proxy-client", () => ({
  updateWpSeo: mockUpdateWpSeo,
  publishWpPost: mockPublishWpPost,
  getWpPages: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  getWpElementorPage: vi.fn().mockResolvedValue({ ok: false, error: "not available" }),
  duplicateWpElementorPage: vi.fn(),
  updateWpElementorWidgets: vi.fn(),
}));

vi.mock("@/server/jobs/workers/base-worker", () => ({
  logApiUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/anthropic-config", () => ({
  CLAUDE_MODEL: "claude-sonnet-4-6",
}));

// ─── Import SUT ───────────────────────────────────────────────────────────────

import { executeWpAiStep } from "../wp-executor";
import type { WpSiteProfile } from "@/lib/wp-site-profile";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CEREBRO_CLIENT_ID = "test-client-id-123";

const SEO_TASK = {
  title: "Optimizar meta tags de la página Inicio",
  objective: "Mejorar el meta title y description para keyword 'servicios industriales Monterrey'",
  kind: "CODE",
  category: "seo",
  targetKeyword: "servicios industriales Monterrey",
};

const PUBLISH_TASK = {
  title: "Artículo: Beneficios del mantenimiento preventivo",
  objective: "Crear artículo de blog sobre mantenimiento preventivo industrial",
  kind: "CONTENT",
  category: "blog",
  targetKeyword: "mantenimiento preventivo industrial",
};

const SEO_STEP_WITH_JSON = {
  title: "Optimizar meta tags",
  prompt: JSON.stringify({
    action: "seo",
    endpoint: "POST /seo/{page_id}",
    payload: { page_id: 45, meta_title: "", meta_description: "", focus_keyword: "servicios industriales" },
  }),
  acceptanceCriteria: ["meta_title 50-60 chars"],
  notes: null,
};

const PUBLISH_STEP = {
  title: "Crear borrador",
  prompt: JSON.stringify({
    action: "publish",
    endpoint: "POST /publish",
    payload: { title: "Mantenimiento preventivo", slug: "mantenimiento-preventivo", focus_keyword: "mantenimiento", categories: ["Blog"] },
    content_brief: "Artículo sobre mantenimiento preventivo industrial.",
  }),
  acceptanceCriteria: ["Borrador creado"],
  notes: null,
};

const MOCK_PROFILE: WpSiteProfile = {
  clientName: "Test Client",
  siteUrl: "https://example.com",
  pages: [
    { id: 1, title: "Inicio", slug: "", link: "https://example.com/" },
    { id: 2, title: "Servicios", slug: "servicios", link: "https://example.com/servicios/" },
  ],
  contentSummary: "",
  fetchedAt: new Date().toISOString(),
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("executeWpAiStep — SEO steps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("SIEMPRE stagea — nunca llama a updateWpSeo", async () => {
    const result = await executeWpAiStep(
      CEREBRO_CLIENT_ID,
      null,
      SEO_TASK,
      SEO_STEP_WITH_JSON,
      "task-id-001",
    );

    // updateWpSeo NUNCA debe llamarse
    expect(mockUpdateWpSeo).not.toHaveBeenCalled();

    // Result should have stagedChange
    expect(result.stagedChange).toBeDefined();
    expect(result.stagedChange?.type).toBe("seo");

    // Notes should indicate staging
    expect(result.notes).toContain("seo staged");
  });

  it("stagedChange tiene los campos requeridos", async () => {
    const result = await executeWpAiStep(
      CEREBRO_CLIENT_ID,
      null,
      SEO_TASK,
      SEO_STEP_WITH_JSON,
      "task-id-002",
    );

    const staged = result.stagedChange;
    expect(staged).toBeDefined();
    if (staged && staged.type === "seo") {
      expect(staged).toHaveProperty("page_id");
      expect(staged).toHaveProperty("meta_title");
      expect(staged).toHaveProperty("meta_description");
      expect(staged).toHaveProperty("generated");
      expect(staged).toHaveProperty("staged_at");
    }
  });

  it("no devuelve previewUrl en steps SEO", async () => {
    const result = await executeWpAiStep(
      CEREBRO_CLIENT_ID,
      null,
      SEO_TASK,
      SEO_STEP_WITH_JSON,
      "task-id-003",
    );
    expect(result.previewUrl).toBeUndefined();
  });
});

describe("executeWpAiStep — publish steps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPublishWpPost.mockResolvedValue({
      ok: true,
      data: { post_id: 456, draft_url: "https://example.com/?p=456&preview=true" },
    });
  });

  it("llama a publishWpPost y devuelve previewUrl", async () => {
    const result = await executeWpAiStep(
      CEREBRO_CLIENT_ID,
      MOCK_PROFILE,
      PUBLISH_TASK,
      PUBLISH_STEP,
      "task-id-005",
    );

    expect(mockPublishWpPost).toHaveBeenCalledOnce();
    expect(result.previewUrl).toBe("https://example.com/?p=456&preview=true");
  });

  it("publishWpPost recibe status=draft siempre", async () => {
    await executeWpAiStep(
      CEREBRO_CLIENT_ID,
      MOCK_PROFILE,
      PUBLISH_TASK,
      PUBLISH_STEP,
      "task-id-006",
    );

    const callArgs = mockPublishWpPost.mock.calls[0] as [string, Record<string, unknown>, string];
    expect(callArgs[1].status).toBe("draft");
  });
});
