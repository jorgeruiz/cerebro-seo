/**
 * Tests para wp-executor.ts
 *
 * Verifica que:
 * 1. executeWpAiStep para pasos SEO SIEMPRE stagea — nunca aplica directamente.
 * 2. El resultado tiene el prefijo WP_SEO_STAGED: en notes.
 * 3. updateWpSeo NO es llamado bajo ningún page_id (ni 0 ni un ID real).
 * 4. executeWpAiStep para pasos publish devuelve previewUrl (no lo mete en resultUrls).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock Anthropic SDK — devuelve meta JSON válido para tests de SEO
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: '{"meta_title":"Título de prueba para SEO","meta_description":"Descripción de prueba para SEO con exactamente el largo correcto y CTA."}' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  })),
}));

// Mock WP proxy — updateWpSeo es el que NO debe llamarse; publishWpPost sí puede llamarse
const mockUpdateWpSeo = vi.fn();
const mockPublishWpPost = vi.fn().mockResolvedValue({
  ok: true,
  data: { post_id: 123, draft_url: "https://example.com/?p=123&preview=true" },
});

vi.mock("@/lib/wp-proxy-client", () => ({
  updateWpSeo: mockUpdateWpSeo,
  publishWpPost: mockPublishWpPost,
}));

// Mock logApiUsage
vi.mock("@/server/jobs/workers/base-worker", () => ({
  logApiUsage: vi.fn().mockResolvedValue(undefined),
}));

// Mock CLAUDE_MODEL
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
};

const PUBLISH_TASK = {
  title: "Artículo: Beneficios del mantenimiento preventivo",
  objective: "Crear artículo de blog sobre mantenimiento preventivo industrial para keyword objetivo",
  kind: "CONTENT",
  category: "blog",
};

const SEO_STEP_WITH_JSON = {
  title: "Actualizar meta tags de Inicio",
  prompt: JSON.stringify({
    action: "seo",
    endpoint: "POST /seo/45",
    payload: { page_id: 45, focus_keyword: "servicios industriales monterrey" },
    content_brief: "Optimizar meta tags para página de inicio con keyword servicios industriales Monterrey",
  }),
  acceptanceCriteria: ["meta_title entre 50-60 chars", "meta_description entre 140-160 chars"],
  notes: null,
};

const SEO_STEP_PAGE_ID_ZERO = {
  title: "Actualizar meta tags (page_id desconocido)",
  prompt: JSON.stringify({
    action: "seo",
    endpoint: "POST /seo/0",
    payload: { page_id: 0 },
    content_brief: "Optimizar meta tags de la página de servicios",
  }),
  acceptanceCriteria: [],
  notes: null,
};

const PUBLISH_STEP = {
  title: "Crear artículo de blog",
  prompt: JSON.stringify({
    action: "publish",
    endpoint: "POST /publish",
    payload: { title: "Beneficios del mantenimiento preventivo industrial", focus_keyword: "mantenimiento preventivo" },
    content_brief: "Artículo informativo sobre mantenimiento preventivo en industria",
  }),
  acceptanceCriteria: [],
  notes: null,
};

const MOCK_PROFILE: WpSiteProfile = {
  clientName: "Industrial Test SA",
  siteUrl: "https://industrialtest.com",
  pages: [{ title: "Inicio", slug: "" }, { title: "Servicios", slug: "servicios" }],
  contentSummary: "=== Inicio ===\nServicios industriales en Monterrey. Mantenimiento preventivo y correctivo.",
  hasContent: true,
  buildAt: new Date().toISOString(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("executeWpAiStep — SEO steps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply publish mock after clearAllMocks
    mockPublishWpPost.mockResolvedValue({
      ok: true,
      data: { post_id: 123, draft_url: "https://example.com/?p=123&preview=true" },
    });
  });

  it("SIEMPRE stagea — nunca llama a updateWpSeo (page_id conocido)", async () => {
    const result = await executeWpAiStep(
      CEREBRO_CLIENT_ID,
      null,
      SEO_TASK,
      SEO_STEP_WITH_JSON,
      "task-id-001",
    );

    // updateWpSeo NUNCA debe llamarse — incluso con page_id=45
    expect(mockUpdateWpSeo).not.toHaveBeenCalled();

    // notes debe tener el prefijo WP_SEO_STAGED:
    expect(result.notes).toMatch(/^WP_SEO_STAGED:/);

    // No debe haber previewUrl en steps SEO
    expect(result.previewUrl).toBeUndefined();
  });

  it("SIEMPRE stagea — nunca llama a updateWpSeo (page_id=0)", async () => {
    const result = await executeWpAiStep(
      CEREBRO_CLIENT_ID,
      null,
      SEO_TASK,
      SEO_STEP_PAGE_ID_ZERO,
      "task-id-002",
    );

    expect(mockUpdateWpSeo).not.toHaveBeenCalled();
    expect(result.notes).toMatch(/^WP_SEO_STAGED:/);
  });

  it("el payload staged es JSON parseable con campos requeridos", async () => {
    const result = await executeWpAiStep(
      CEREBRO_CLIENT_ID,
      null,
      SEO_TASK,
      SEO_STEP_WITH_JSON,
      "task-id-003",
    );

    const firstLine = result.notes.split("\n")[0];
    const jsonStr = firstLine.replace(/^WP_SEO_STAGED:/, "");
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    expect(parsed).toHaveProperty("page_id");
    expect(parsed).toHaveProperty("meta_title");
    expect(parsed).toHaveProperty("meta_description");
    expect(parsed).toHaveProperty("generated");
    expect(parsed).toHaveProperty("staged_at");
  });

  it("stagea incluso si el step tiene category=seo sin JSON estructurado (heurística)", async () => {
    const stepPlainText = {
      title: "Mejorar meta tags",
      prompt: "Optimiza el meta title y description de la página de inicio para SEO",
      acceptanceCriteria: [],
      notes: null,
    };

    const result = await executeWpAiStep(
      CEREBRO_CLIENT_ID,
      null,
      SEO_TASK,
      stepPlainText,
      "task-id-004",
    );

    expect(mockUpdateWpSeo).not.toHaveBeenCalled();
    expect(result.notes).toMatch(/^WP_SEO_STAGED:/);
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
    expect(result.notes).toContain("wp:publish OK");
    expect(result.notes).toContain("post_id=456");
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

  it("nota incluye advertencia de placeholders si el contenido tiene [COMPLETAR", async () => {
    // Forzar que Claude devuelva contenido con [COMPLETAR
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    (Anthropic as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "<p>Servicios de [COMPLETAR: nombre empresa] en Monterrey.</p>" }],
          usage: { input_tokens: 200, output_tokens: 100 },
        }),
      },
    }));

    const result = await executeWpAiStep(
      CEREBRO_CLIENT_ID,
      MOCK_PROFILE,
      PUBLISH_TASK,
      PUBLISH_STEP,
      "task-id-007",
    );

    expect(result.notes).toContain("placeholder");
  });
});

describe("executeWpAiStep — acciones no implementadas", () => {
  it("stagea sin fallar para acción update", async () => {
    const updateStep = {
      title: "Actualizar página",
      prompt: JSON.stringify({
        action: "update",
        endpoint: "PUT /update/99",
        payload: { post_id: 99 },
      }),
      acceptanceCriteria: [],
      notes: null,
    };

    const result = await executeWpAiStep(
      CEREBRO_CLIENT_ID,
      null,
      { ...SEO_TASK, category: "pagina" },
      updateStep,
      "task-id-008",
    );

    expect(result.notes).toContain("wp:staged");
    expect(result.previewUrl).toBeUndefined();
  });
});
