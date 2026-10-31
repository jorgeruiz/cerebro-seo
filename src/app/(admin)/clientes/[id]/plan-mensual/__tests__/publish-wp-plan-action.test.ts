/**
 * Tests para publishWpPlanAction.
 *
 * Comportamiento actual:
 * - SEO: aplica meta tags via POST /seo/{page_id}
 * - Elementor: aplica borrador via POST /elementor/apply/{draftId}
 * - Blog: SKIP — borradores se revisan manualmente en WP Admin
 *   (no se publican automáticamente desde aquí)
 * - page_id=0: resolución automática via GET /pages
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WpStagedBlogChange, WpStagedSeoChange } from "@/lib/wp-staged-change";

// --- Mocks -------------------------------------------------------------------

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ user: { email: "jorge@clicksociety.mx" } }),
}));

const {
  mockUpdateWpSeo,
  mockGetWpPages,
  mockApplyWpElementorDraft,
} = vi.hoisted(() => ({
  mockUpdateWpSeo: vi.fn(),
  mockGetWpPages: vi.fn(),
  mockApplyWpElementorDraft: vi.fn(),
}));

vi.mock("@/lib/wp-proxy-client", () => ({
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

const SEO_CHANGE_WITH_ID: WpStagedSeoChange = {
  type: "seo",
  page_id: 45,
  meta_title: "Servicios industriales Monterrey | Industrial Test",
  meta_description: "Ofrecemos servicios industriales en Monterrey.",
  focus_keyword: "servicios industriales monterrey",
  objective: "Mejorar meta tags de la pagina Servicios",
  generated: true,
  staged_at: "2026-10-17T12:00:00.000Z",
};

const WP_PAGES = [
  { id: 45, title: "Servicios", slug: "servicios", link: "https://example.com/servicios/" },
  { id: 12, title: "Inicio", slug: "", link: "https://example.com/" },
];

function makePlan(options: {
  tasks: Array<{
    id: string;
    resultUrls?: string[];
    steps: Array<{ id: string; title: string; stagedChange: unknown }>;
  }>;
  status?: string;
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

describe("publishWpPlanAction — blog drafts are SKIPPED", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWpPages.mockResolvedValue({ ok: true, data: WP_PAGES });
  });

  it("skips blog changes (blogs are published manually from WP Admin)", async () => {
    mockMonthlyPlanFindUnique.mockResolvedValue(makePlan({
      tasks: [{
        id: "task-1",
        steps: [{ id: "step-1", title: "Articulo limpio", stagedChange: BLOG_CHANGE_CLEAN }],
      }],
    }));

    const result = await publishWpPlanAction(PLAN_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skipped).toBe(1);
      expect(result.metaApplied).toBe(0);
      expect(result.details[0]).toContain("borrador");
    }
  });
});

describe("publishWpPlanAction — SEO meta tags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWpPages.mockResolvedValue({ ok: true, data: WP_PAGES });
  });

  it("aplica meta tags via POST /seo/{page_id}", async () => {
    mockMonthlyPlanFindUnique.mockResolvedValue(makePlan({
      tasks: [{
        id: "task-1",
        steps: [{ id: "step-1", title: "Meta Inicio", stagedChange: SEO_CHANGE_WITH_ID }],
      }],
    }));
    mockUpdateWpSeo.mockResolvedValue({ ok: true, data: { success: true, page_id: 45 } });

    const result = await publishWpPlanAction(PLAN_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metaApplied).toBe(1);
    }
    expect(mockUpdateWpSeo).toHaveBeenCalled();
  });

  it("continues with SEO even if blog is also present", async () => {
    mockMonthlyPlanFindUnique.mockResolvedValue(makePlan({
      tasks: [
        {
          id: "task-1",
          steps: [{ id: "step-1", title: "Articulo", stagedChange: BLOG_CHANGE_CLEAN }],
        },
        {
          id: "task-2",
          steps: [{ id: "step-2", title: "Meta Inicio", stagedChange: SEO_CHANGE_WITH_ID }],
        },
      ],
    }));
    mockUpdateWpSeo.mockResolvedValue({ ok: true, data: { success: true, page_id: 45 } });

    const result = await publishWpPlanAction(PLAN_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skipped).toBe(1); // blog skipped
      expect(result.metaApplied).toBe(1); // seo applied
    }
  });
});

describe("publishWpPlanAction — already published", () => {
  it("returns error if plan already PUBLISHED", async () => {
    mockMonthlyPlanFindUnique.mockResolvedValue(makePlan({
      status: "PUBLISHED",
      tasks: [],
    }));

    const result = await publishWpPlanAction(PLAN_ID);

    expect(result.ok).toBe(false);
    if (!result.ok && "error" in result) expect(result.error).toContain("publicado");
  });
});
