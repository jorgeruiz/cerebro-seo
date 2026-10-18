/**
 * Tests para image-executor — valida lógica de optimización, QA, y límites.
 * No hace llamadas reales a Higgsfield ni Claude — todo mockeado.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock sharp
vi.mock("sharp", () => {
  const mockSharp = vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(50_000)), // 50 KB
  }));
  return { default: mockSharp };
});

// Mock Anthropic (for QA vision)
const mockAnthropicCreate = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: '{"pass": true, "reason": "Image looks good"}' }],
  usage: { input_tokens: 100, output_tokens: 50 },
});

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockAnthropicCreate };
    },
  };
});

// Mock logApiUsage
vi.mock("@/server/jobs/workers/base-worker", () => ({
  logApiUsage: vi.fn().mockResolvedValue(undefined),
}));

// Mock wp-proxy-client
const mockUpdateWpPost = vi.fn().mockResolvedValue({ ok: true, data: { success: true, post_id: 99 } });
vi.mock("@/lib/wp-proxy-client", () => ({
  uploadWpMedia: vi.fn().mockResolvedValue({
    ok: true,
    data: { id: 42, source_url: "https://example.com/wp-content/uploads/test.webp" },
  }),
  updateWpPost: mockUpdateWpPost,
}));

// Mock fetch for Higgsfield API
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Set env vars
process.env.HIGGSFIELD_KEY_ID = "test-key-id";
process.env.HIGGSFIELD_KEY_SECRET = "test-key-secret";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

describe("image-executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default fetch mock: Higgsfield submit → poll → completed
    mockFetch.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : String(url);

      // Higgsfield submit
      if (urlStr.includes("/recraft/")) {
        return {
          ok: true,
          json: async () => ({
            status: "queued",
            request_id: "test-req-123",
            status_url: "https://api.higgsfield.ai/requests/test-req-123/status",
            cancel_url: "https://api.higgsfield.ai/requests/test-req-123/cancel",
          }),
        };
      }

      // Higgsfield estimate
      if (urlStr.includes("/estimate/")) {
        return {
          ok: true,
          json: async () => ({ usd: "0.035", credits: "0.050" }),
        };
      }

      // Higgsfield poll status
      if (urlStr.includes("/requests/") && urlStr.includes("/status")) {
        return {
          ok: true,
          json: async () => ({
            status: "completed",
            request_id: "test-req-123",
            images: [{ url: "https://cdn.higgsfield.ai/test-image.jpg", seed: 12345 }],
          }),
        };
      }

      // Fetch generated image
      if (urlStr.includes("cdn.higgsfield.ai")) {
        return {
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(100_000),
        };
      }

      return { ok: false, status: 404, text: async () => "Not found" };
    });
  });

  it("generates and optimizes an image for WP blog (no repoDir)", async () => {
    const { executeImage } = await import("../image-executor");

    const result = await executeImage(
      {
        action: "image",
        endpoint: "POST /media",
        payload: {
          usage: "featured_image",
          aspect_ratio: "16:9",
          style: "conceptual",
          subject_type: "conceptual",
        },
        content_brief: "Industrial waterproofing roof with blue and gray tones",
      },
      {
        cerebroClientId: "test-client-id",
        taskId: "test-task-id",
        brandColors: "Primary: #2563eb, Secondary: #64748b",
        imageCount: 0,
      },
    );

    expect(result.notes).toContain("image:ok");
    expect(result.imageUrl).toBe("https://example.com/wp-content/uploads/test.webp");

    // Verify Higgsfield was called
    const submitCall = mockFetch.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("/recraft/"),
    );
    expect(submitCall).toBeDefined();

    // Verify brand colors were included in the prompt
    const body = JSON.parse(submitCall![1].body);
    expect(body.prompt).toContain("Primary: #2563eb");
  });

  it("respects image count limit", async () => {
    const { executeImage } = await import("../image-executor");

    const result = await executeImage(
      {
        action: "image",
        endpoint: "POST /media",
        payload: { usage: "inline", aspect_ratio: "4:3", subject_type: "conceptual" },
        content_brief: "Test image",
      },
      {
        cerebroClientId: "test-client-id",
        taskId: "test-task-id",
        imageCount: 2, // already at limit
      },
    );

    expect(result.notes).toContain("image:limit");
    expect(result.imageUrl).toBeUndefined();
    // No Higgsfield calls should have been made
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("retries on QA failure and falls back to HUMAN", async () => {
    // Override the shared mock to fail QA
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"pass": false, "reason": "Image contains visible text overlay"}' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { executeImage } = await import("../image-executor");

    const result = await executeImage(
      {
        action: "image",
        endpoint: "POST /media",
        payload: { usage: "featured_image", aspect_ratio: "16:9", subject_type: "conceptual" },
        content_brief: "Clean industrial scene",
      },
      {
        cerebroClientId: "test-client-id",
        taskId: "test-task-id",
        imageCount: 0,
      },
    );

    expect(result.notes).toContain("image:qa-failed");
    expect(result.notes).toContain("text overlay");
  });

  it("blocks image generation for non-blog tasks (landing)", async () => {
    const { executeImage } = await import("../image-executor");

    const result = await executeImage(
      {
        action: "image",
        endpoint: "POST /media",
        payload: { usage: "featured_image", aspect_ratio: "16:9", subject_type: "conceptual" },
        content_brief: "Landing page hero image",
      },
      {
        cerebroClientId: "test-client-id",
        taskId: "test-task-id",
        imageCount: 0,
        taskKind: "CONTENT",
        taskCategory: "landing",
      },
    );

    expect(result.notes).toContain("image:human-required");
    expect(result.imageUrl).toBeUndefined();
    // No Higgsfield calls
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("blocks image generation for service page tasks", async () => {
    const { executeImage } = await import("../image-executor");

    const result = await executeImage(
      {
        action: "image",
        endpoint: "POST /media",
        payload: { usage: "featured_image", aspect_ratio: "16:9", subject_type: "conceptual" },
        content_brief: "Service page hero",
      },
      {
        cerebroClientId: "test-client-id",
        taskId: "test-task-id",
        imageCount: 0,
        taskKind: "TECHNICAL",
        taskCategory: "servicio",
      },
    );

    expect(result.notes).toContain("image:human-required");
  });

  it("allows image generation for blog tasks", async () => {
    // Reset the mock to pass QA
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"pass": true, "reason": "Looks good"}' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { executeImage } = await import("../image-executor");

    const result = await executeImage(
      {
        action: "image",
        endpoint: "POST /media",
        payload: { usage: "featured_image", aspect_ratio: "16:9", subject_type: "conceptual" },
        content_brief: "Blog post about waterproofing",
      },
      {
        cerebroClientId: "test-client-id",
        taskId: "test-task-id",
        imageCount: 0,
        taskKind: "CONTENT",
        taskCategory: "blog",
      },
    );

    expect(result.notes).toContain("image:ok");
  });

  it("auto-assigns featured_media when attach_to_post_id is set", async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"pass": true, "reason": "Looks good"}' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { executeImage } = await import("../image-executor");

    const result = await executeImage(
      {
        action: "image",
        endpoint: "POST /media",
        payload: {
          usage: "featured_image",
          attach_to_post_id: 99,
          aspect_ratio: "16:9",
          subject_type: "conceptual",
        },
        content_brief: "Industrial waterproofing article cover",
      },
      {
        cerebroClientId: "test-client-id",
        taskId: "test-task-id",
        imageCount: 0,
        taskKind: "CONTENT",
        taskCategory: "blog",
      },
    );

    expect(result.notes).toContain("image:ok");
    expect(result.notes).toContain("featured_image asignada a post_id=99");
    // Verify updateWpPost was called with featured_image_id
    expect(mockUpdateWpPost).toHaveBeenCalledWith(
      "test-client-id",
      99,
      { featured_image_id: 42 },
      "test-task-id",
    );
  });
});

// ─── Unit tests for isBlogTask ──────────────────────────────────────────────

describe("isBlogTask", () => {
  it("returns true for blog category", async () => {
    const { isBlogTask } = await import("../image-executor");
    expect(isBlogTask("CONTENT", "blog")).toBe(true);
    expect(isBlogTask("CONTENT", "articulo")).toBe(true);
    expect(isBlogTask("CONTENT", "article")).toBe(true);
  });

  it("returns false for landing/service categories", async () => {
    const { isBlogTask } = await import("../image-executor");
    expect(isBlogTask("CONTENT", "landing")).toBe(false);
    expect(isBlogTask("CONTENT", "servicio")).toBe(false);
    expect(isBlogTask("CONTENT", "pagina")).toBe(false);
    expect(isBlogTask("TECHNICAL", "home")).toBe(false);
  });

  it("returns true when no context provided (fallback permissive)", async () => {
    const { isBlogTask } = await import("../image-executor");
    expect(isBlogTask()).toBe(true);
    expect(isBlogTask(undefined, undefined)).toBe(true);
  });
});
