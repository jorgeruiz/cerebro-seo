/**
 * Tests para publishWpPlanAction.
 *
 * Verifica:
 * 1. GUARD: bloquea si algun borrador tiene has_placeholders=true.
 * 2. page_id=0: resolucion automatica via GET /pages cuando hay coincidencia unica.
 * 3. page_id=0: no resuelto -> step omitido (no bloquea los demas).
 * 4. Blog: PUT /update/{post_id} con status=publish; resultUrls se llena con link.
 * 5. SEO: POST /seo/{page_id} aplicado; stagedChange actualizado.
 * 6. Plan ya publicado: devuelve error sin tocar WP.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WpStagedBlogChange, WpStagedSeoChange } from "@/lib/wp-staged-change";

// --- Mocks -------------------------------------------------------------------

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ user: { email: "jorge@clicksociety.mx" } }),
}));

const {
  mockUpdateWpPost,
  mockUpdateWpSeo,
  mockGetWpPages,
  mockApplyWpElementorDraft,
} = vi.hoisted(() => ({
  mockUpdateWpPost: vi.fn(),
  mockUpdateWpSeo: vi.fn(),
  mockGetWpPages: vi.fn(),
  mockApplyWpElementorDraft: vi.fn(),
}));

vi.mock("@/lib/wp-proxy-client", () => ({
  updateWpPost: mockUpdateWpPost,
  updateWpSeo: mockUpdateWpSeo,
  getWpPages: mockGetWpPages,
  applyWpElementorDraft: mockApplyWpElementorDraft,
}));

const {
  mockPlanStepUpdate,
  mockPlanTaskUpdate,
  mockMonthlyPlanFindUnique,
} = vi.hoisted(() => ({
  mockPlanStepUpdate: vi.fn().mockResolvedValue({}),
  mockPlanTaskUpdate: vi.fn().mockResolvedValue({}),
  mockMonthlyPlanFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    monthlyPlan: { findUnique: () => mockMonthlyPlanFindUnique() },
    planStep: { update: (...args: unknown[]) => mockPlanStepUpdate(...args) },
    planTask: { update: (...args: unknown[]) => mockPlanTaskUpdate(...args) },
  },
}));

// --- Import SUT --------------------------------------------------------------

import { publishWpPlanAction } from "../publish-wp-plan-action";

// --- Fixtures ----------------------------------------------------------------

const PLAN_ID = "plan-abc-123";
const CEREBRO_CLIENT_ID = "cerebro-client-xyz";

const BLOG_CHANGE_CLEAN: WpStagedBlogChange = {
  type: "blog",
  post_id: 101,
  title: "Beneficios del mantenimiento preventivo",
  draft_url: "https://example.com/?p=101&preview=true",
  focus_keyword: "mantenimiento preventivo",
  has_placeholders: false,
  placeholder_count: 0,
  placeholder_samples: [],
  staged_at: "2026-10-17T12:00:00.000Z",
};

const BLOG_CHANGE_WITH_PLACEHOLDERS: WpStagedBlogChange = {
  type: "blog",
  post_id: 102,
  title: "Servicios de la empresa",
  draft_url: "https://example.com/?p=102&preview=true",
  focus_keyword: null,
  has_placeholders: true,
  placeholder_count: 3,
  placeholder_samples: ["[COMPLETAR: nombre empresa]", "[COMPLETAR: telefono]", "[COMPLETAR: ciudad]"],
  staged_at: "2026-10-17T12:00:00.000Z",
};

const SEO_CHANGE_WITH_ID: WpStagedSeoChange = {
  type: "seo",
  page_id: 45,
  meta_title: "Servicios industriales Monterrey | Industrial Test",
  meta_description: "Ofrecemos servicios industriales en Monterrey. Contactanos para una cotizacion gratis.",
  focus_keyword: "servicios industriales monterrey",
  objective: "Mejorar meta tags de la pagina Servicios",
  generated: true,
  staged_at: "2026-10-17T12:00:00.000Z",
};

const SEO_CHANGE_PAGE_ID_ZERO: WpStagedSeoChange = {
  type: "seo",
  page_id: 0,
  meta_title: "Inicio | Industrial Test",
  meta_description: "Industrial Test ofrece soluciones industriales en Monterrey.",
  focus_keyword: "servicios industriales",
  objective: "Optimizar meta tags de la pagina Inicio",
  generated: true,
  staged_at: "2026-10-17T12:00:00.000Z",
};

const WP_PAGES = [
  { id: 1, title: "Inicio", slug: "", link: "https://example.com/" },
  { id: 45, title: "Servicios", slug: "servicios", link: "https://example.com/servicios/" },
  { id: 67, title: "Contacto", slug: "contacto", link: "https://example.com/contacto/" },
];

function makePlan(options: {
  status?: string;
  tasks?: Array<{
    id: string;
    resultUrls?: string[];
    steps: Array<{ id: string; title: string; stagedChange: unknown }>;
  }>;
}) {
  return {
    id: PLAN_ID,
    status: options.status ?? "ACTIVE",
    client: {
      sites: [{
        id: "site-1",
        platform: "WORDPRESS",
        client: { cerebroClientId: CEREBRO_CLIENT_ID },
      }],
    },
    tasks: (options.tasks ?? []).map((t) => ({
      id: t.id,
      resultUrls: t.resultUrls ?? [],
      steps: t.steps.map((s) => ({
        ...s,
        status: "DONE",
        notes: null,
      })),
    })),
  };
}

// --- Tests -------------------------------------------------------------------

describe("publishWpPlanAction — guard de placeholders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWpPages.mockResolvedValue({ ok: true, data: WP_PAGES });
  });

  it("bloquea si algun borrador tiene has_placeholders=true", async () => {
    mockMonthlyPlanFindUnique.mockResolvedValue(makePlan({
      tasks: [{
        id: "task-1",
        steps: [{ id: "step-1", title: "Articulo con placeholders", stagedChange: BLOG_CHANGE_WITH_PLACEHOLDERS }],
      }],
    }));

    const result = await publishWpPlanAction(PLAN_ID);

    expect(result.ok).toBe(false);
    if (!result.ok && "blocked" in result) {
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("placeholder");
      expect(result.details[0]).toContain("[COMPLETAR: nombre empresa]");
    }
    expect(mockUpdateWpPost).not.toHaveBeenCalled();
    expect(mockUpdateWpSeo).not.toHaveBeenCalled();
  });

  it("bloquea incluso si solo 1 de varios borradores tiene placeholders", async () => {
    mockMonthlyPlanFindUnique.mockResolvedValue(makePlan({
      tasks: [
        {
          id: "task-1",
          steps: [{ id: "step-1", title: "Articulo limpio", stagedChange: BLOG_CHANGE_CLEAN }],
        },
        {
          id: "task-2",
          steps: [{ id: "step-2", title: "Articulo con placeholders", stagedChange: BLOG_CHANGE_WITH_PLACEHOLDERS }],
        },
      ],
    }));

    const result = await publishWpPlanAction(PLAN_ID);

    expect(result.ok).toBe(false);
    expect(mockUpdateWpPost).not.toHaveBeenCalled();
  });

  it("permite publicar si ningun borrador tiene placeholders", async () => {
    mockMonthlyPlanFindUnique.mockResolvedValue(makePlan({
      tasks: [{
        id: "task-1",
        steps: [{ id: "step-1", title: "Articulo limpio", stagedChange: BLOG_CHANGE_CLEAN }],
      }],
    }));
    mockUpdateWpPost.mockResolvedValue({ ok: true, data: { success: true, post_id: 101, link: "https://example.com/articulo/" } });

    const result = await publishWpPlanAction(PLAN_ID);

    expect(result.ok).toBe(true);
  });
});

describe("publishWpPlanAction — blog drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWpPages.mockResolvedValue({ ok: true, data: WP_PAGES });
  });

  it("llama PUT /update/{post_id} con status=publish", async () => {
    mockMonthlyPlanFindUnique.mockResolvedValue(makePlan({
      tasks: [{
        id: "task-1",
        steps: [{ id: "step-1", title: "Articulo", stagedChange: BLOG_CHANGE_CLEAN }],
      }],
    }));
    mockUpdateWpPost.mockResolvedValue({ ok: true, data: { success: true, post_id: 101, link: "https://example.com/articulo/" } });

    await publishWpPlanAction(PLAN_ID);

    expect(mockUpdateWpPost).toHaveBeenCalledWith(
      CEREBRO_CLIENT_ID,
      101,
      { status: "publish" },
    );
  });

  it("agrega el link publico a resultUrls de la tarea", async () => {
    mockMonthlyPlanFindUnique.mockResolvedValue(makePlan({
      tasks: [{
        id: "task-1",
        resultUrls: [],
        steps: [{ id: "step-1", title: "Articulo", stagedChange: BLOG_CHANGE_CLEAN }],
      }],
    }));
    mockUpdateWpPost.mockResolvedValue({
      ok: true,
      data: { success: true, post_id: 101, link: "https://example.com/articulo-final/" },
    });

    await publishWpPlanAction(PLAN_ID);

    const updateCall = mockPlanTaskUpdate.mock.calls.find(
      (call: unknown[]) => {
        const [args] = call as [{ data: { resultUrls?: string[] } }];
        return Array.isArray(args?.data?.resultUrls);
      },
    );
    expect(updateCall).toBeDefined();
    const [{ data }] = updateCall as [{ data: { resultUrls: string[] } }];
    expect(data.resultUrls).toContain("https://example.com/articulo-final/");
  });

  it("reporta error de WP pero continua con los demas steps", async () => {
    mockMonthlyPlanFindUnique.mockResolvedValue(makePlan({
      tasks: [
        {
          id: "task-1",
          steps: [{ id: "step-1", title: "Articulo 1", stagedChange: BLOG_CHANGE_CLEAN }],
        },
        {
          id: "task-2",
          steps: [{ id: "step-2", title: "Meta Inicio", stagedChange: SEO_CHANGE_WITH_ID }],
        },
      ],
    }));
    mockUpdateWpPost.mockResolvedValue({ ok: false, error: "WP timeout" });
    mockUpdateWpSeo.mockResolvedValue({ ok: true, data: { success: true, page_id: 45 } });

    const result = await publishWpPlanAction(PLAN_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.failed).toBe(1);
      expect(result.metaApplied).toBe(1);
      expect(result.details.some((d) => d.includes("WP timeout"))).toBe(true);
    }
  });
});

describe("publishWpPlanAction — SEO meta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWpPages.mockResolvedValue({ ok: true, data: WP_PAGES });
  });

  it("llama POST /seo/{page_id} con los meta tags correctos", async () => {
    mockMonthlyPlanFindUnique.mockResolvedValue(makePlan({
      tasks: [{
        id: "task-1",
        steps: [{ id: "step-1", title: "Meta Servicios", stagedChange: SEO_CHANGE_WITH_ID }],
      }],
    }));
    mockUpdateWpSeo.mockResolvedValue({ ok: true, data: { success: true, page_id: 45 } });

    await publishWpPlanAction(PLAN_ID);

    expect(mockUpdateWpSeo).toHaveBeenCalledWith(
      CEREBRO_CLIENT_ID,
      45,
      expect.objectContaining({
        meta_title: SEO_CHANGE_WITH_ID.meta_title,
        meta_description: SEO_CHANGE_WITH_ID.meta_description,
      }),
    );
  });

  it("resuelve page_id=0 via GET /pages cuando hay coincidencia unica", async () => {
    // objective menciona "Inicio" — coincide con WP_PAGES[0] (title="Inicio", id=1)
    mockMonthlyPlanFindUnique.mockResolvedValue(makePlan({
      tasks: [{
        id: "task-1",
        steps: [{ id: "step-1", title: "Meta Inicio", stagedChange: SEO_CHANGE_PAGE_ID_ZERO }],
      }],
    }));
    mockUpdateWpSeo.mockResolvedValue({ ok: true, data: { success: true, page_id: 1 } });

    const result = await publishWpPlanAction(PLAN_ID);

    expect(mockGetWpPages).toHaveBeenCalledWith(CEREBRO_CLIENT_ID);
    // updateWpSeo se llama con el page_id resuelto (1 = Inicio)
    expect(mockUpdateWpSeo).toHaveBeenCalledWith(
      CEREBRO_CLIENT_ID,
      1,
      expect.any(Object),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.metaApplied).toBe(1);
  });

  it("omite step SEO si page_id=0 no se puede resolver (sin coincidencia)", async () => {
    const unresolvableSeo: WpStagedSeoChange = {
      ...SEO_CHANGE_PAGE_ID_ZERO,
      objective: "Optimizar meta tags de una pagina sin nombre claro",
    };
    mockMonthlyPlanFindUnique.mockResolvedValue(makePlan({
      tasks: [{
        id: "task-1",
        steps: [{ id: "step-1", title: "Meta desconocida", stagedChange: unresolvableSeo }],
      }],
    }));

    const result = await publishWpPlanAction(PLAN_ID);

    expect(mockUpdateWpSeo).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skipped).toBe(1);
      expect(result.details.some((d) => d.includes("page_id=0"))).toBe(true);
    }
  });
});

describe("publishWpPlanAction — casos de error", () => {
  beforeEach(() => vi.clearAllMocks());

  it("devuelve error si el plan no existe", async () => {
    mockMonthlyPlanFindUnique.mockResolvedValue(null);
    const result = await publishWpPlanAction(PLAN_ID);
    expect(result.ok).toBe(false);
  });

  it("devuelve error si el plan ya esta publicado", async () => {
    mockMonthlyPlanFindUnique.mockResolvedValue(makePlan({ status: "PUBLISHED", tasks: [] }));
    const result = await publishWpPlanAction(PLAN_ID);
    expect(result.ok).toBe(false);
    if (!result.ok && !("blocked" in result)) {
      expect(result.error).toContain("publicado");
    }
  });

  it("devuelve error si no hay sitio WP configurado", async () => {
    mockMonthlyPlanFindUnique.mockResolvedValue({
      id: PLAN_ID,
      status: "ACTIVE",
      client: { sites: [] },
      tasks: [],
    });
    const result = await publishWpPlanAction(PLAN_ID);
    expect(result.ok).toBe(false);
  });

  it("devuelve ok con 0 cambios si no hay steps con stagedChange", async () => {
    mockMonthlyPlanFindUnique.mockResolvedValue(makePlan({ tasks: [] }));
    const result = await publishWpPlanAction(PLAN_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.metaApplied + result.elementorApplied).toBe(0);
  });
});
