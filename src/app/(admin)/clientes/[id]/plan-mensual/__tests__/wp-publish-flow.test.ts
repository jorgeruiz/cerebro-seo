/**
 * Test: WP publish flow — metas → stagedChange → Publicar en WordPress → updateWpSeo called
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WpStagedSeoChange } from "@/lib/wp-staged-change";

// --- Mocks -------------------------------------------------------------------

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ user: { email: "jorge@clicksociety.mx", role: "ADMIN" } }),
}));

const { mockUpdateWpSeo, mockGetWpPages } = vi.hoisted(() => ({
  mockUpdateWpSeo: vi.fn().mockResolvedValue({ ok: true, data: { success: true, page_id: 45 } }),
  mockGetWpPages: vi.fn().mockResolvedValue({
    ok: true,
    data: [
      { id: 45, title: "Servicios", slug: "servicios", link: "https://example.com/servicios/" },
    ],
  }),
}));

vi.mock("@/lib/wp-proxy-client", () => ({
  updateWpSeo: mockUpdateWpSeo,
  getWpPages: mockGetWpPages,
  applyWpElementorDraft: vi.fn(),
}));

const { mockPlanFindUnique, mockPlanUpdate, mockStepUpdate, mockTaskUpdate } = vi.hoisted(() => ({
  mockPlanFindUnique: vi.fn(),
  mockPlanUpdate: vi.fn().mockResolvedValue({}),
  mockStepUpdate: vi.fn().mockResolvedValue({}),
  mockTaskUpdate: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    monthlyPlan: {
      findUnique: (...args: unknown[]) => mockPlanFindUnique(...args),
      update: (...args: unknown[]) => mockPlanUpdate(...args),
    },
    planStep: { update: (...args: unknown[]) => mockStepUpdate(...args) },
    planTask: { update: (...args: unknown[]) => mockTaskUpdate(...args) },
  },
}));

import { publishWpPlanAction } from "../publish-wp-plan-action";

// --- Fixtures ----------------------------------------------------------------

const SEO_STAGED: WpStagedSeoChange = {
  type: "seo",
  page_id: 45,
  meta_title: "Servicios Industriales Monterrey | Quimicol",
  meta_description: "Ofrecemos servicios industriales en Monterrey.",
  focus_keyword: "servicios industriales monterrey",
  objective: "Optimizar meta tags de Servicios",
  generated: true,
  staged_at: "2026-10-30T12:00:00Z",
};

// --- Tests -------------------------------------------------------------------

describe("WP publish flow: metas → stagedChange → publishWpPlanAction → updateWpSeo", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("calls updateWpSeo with correct page_id and meta values", async () => {
    mockPlanFindUnique.mockResolvedValue({
      id: "plan-1",
      status: "ACTIVE",
      client: {
        sites: [{
          id: "site-1",
          platform: "WORDPRESS",
          client: { cerebroClientId: "cerebro-123" },
        }],
      },
      tasks: [{
        id: "task-1",
        resultUrls: [],
        steps: [{
          id: "step-1",
          title: "Meta tags Servicios",
          status: "DONE",
          notes: null,
          stagedChange: SEO_STAGED,
        }],
      }],
    });

    const result = await publishWpPlanAction("plan-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metaApplied).toBe(1);
    }

    // updateWpSeo must have been called with the staged values
    expect(mockUpdateWpSeo).toHaveBeenCalledOnce();
    const [clientId, pageId, payload] = mockUpdateWpSeo.mock.calls[0] as [string, number, Record<string, unknown>];
    expect(clientId).toBe("cerebro-123");
    expect(pageId).toBe(45);
    expect(payload.meta_title).toBe("Servicios Industriales Monterrey | Quimicol");
    expect(payload.meta_description).toBe("Ofrecemos servicios industriales en Monterrey.");
  });

  it("rejects already PUBLISHED plan", async () => {
    mockPlanFindUnique.mockResolvedValue({
      id: "plan-2",
      status: "PUBLISHED",
      client: { sites: [{ id: "s1", platform: "WORDPRESS", client: { cerebroClientId: "c1" } }] },
      tasks: [],
    });

    const result = await publishWpPlanAction("plan-2");

    expect(result.ok).toBe(false);
    if (!result.ok && "error" in result) expect(result.error).toContain("publicado");
    expect(mockUpdateWpSeo).not.toHaveBeenCalled();
  });
});
