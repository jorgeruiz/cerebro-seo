import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("@/lib/redis", () => ({
  redis: { get: vi.fn().mockResolvedValue(null), setex: vi.fn() },
  redisBullMQ: {},
}));

vi.mock("@/lib/db", () => ({
  prisma: { apiUsage: { create: vi.fn() } },
}));

// ─── Response helpers ─────────────────────────────────────────────────────────

function makeTaskPostResponse(taskIds: string[]) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        tasks: taskIds.map((id) => ({
          id,
          status_code: 20100,
          cost: 0.00195,
          result_count: 0,
          result: null,
        })),
      }),
  };
}

function makeTasksReadyResponse(ids: string[]) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        tasks: [{ id: "ready-check", status_code: 20000, cost: 0, result_count: ids.length, result: ids.map((id) => ({ id })) }],
      }),
  };
}

function makeTaskGetResponse(keyword: string, domain: string, position: number) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        tasks: [
          {
            id: "task-abc",
            status_code: 20000,
            cost: 0,
            result_count: 1,
            result: [
              {
                keyword,
                items: [
                  { type: "organic", rank_absolute: position, url: `https://${domain}/page` },
                ],
              },
            ],
          },
        ],
      }),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DataForSeoProvider.bulkGetRankings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.env.DATAFORSEO_LOGIN = "test@test.com";
    process.env.DATAFORSEO_PASSWORD = "test-password";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("usa depth:30 por defecto en task_post", async () => {
    const taskId = "task-001";

    mockFetch
      .mockResolvedValueOnce(makeTaskPostResponse([taskId]))    // task_post
      .mockResolvedValueOnce(makeTasksReadyResponse([taskId]))  // tasks_ready
      .mockResolvedValueOnce(makeTaskGetResponse("harina industrial", "molinoazteca.mx", 5)); // task_get

    const { DataForSeoProvider } = await import("../dataforseo");
    const provider = new DataForSeoProvider();

    const p = provider.bulkGetRankings([
      { keyword: "harina industrial", domain: "molinoazteca.mx", country: "MX", language: "es" },
    ]);
    await vi.runAllTimersAsync();
    await p;

    const postCall = mockFetch.mock.calls[0];
    const body = JSON.parse(postCall[1].body as string);
    expect(body[0].depth).toBe(30);
  });

  it("respeta depth personalizado pasado como parámetro", async () => {
    const taskId = "task-002";

    mockFetch
      .mockResolvedValueOnce(makeTaskPostResponse([taskId]))
      .mockResolvedValueOnce(makeTasksReadyResponse([taskId]))
      .mockResolvedValueOnce(makeTaskGetResponse("keyword test", "example.com", 10));

    const { DataForSeoProvider } = await import("../dataforseo");
    const provider = new DataForSeoProvider();

    const p = provider.bulkGetRankings(
      [{ keyword: "keyword test", domain: "example.com", country: "MX", language: "es" }],
      50
    );
    await vi.runAllTimersAsync();
    await p;

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body[0].depth).toBe(50);
  });

  it("Standard Queue polling: devuelve la posición cuando la task completa", async () => {
    const taskId = "task-003";

    mockFetch
      .mockResolvedValueOnce(makeTaskPostResponse([taskId]))
      .mockResolvedValueOnce(makeTasksReadyResponse([taskId]))
      .mockResolvedValueOnce(makeTaskGetResponse("molino azteca", "molinoazteca.mx", 2));

    const { DataForSeoProvider } = await import("../dataforseo");
    const provider = new DataForSeoProvider();

    const p = provider.bulkGetRankings([
      { keyword: "molino azteca", domain: "molinoazteca.mx", country: "MX", language: "es" },
    ]);
    await vi.runAllTimersAsync();
    const results = await p;

    expect(results).toHaveLength(1);
    expect(results[0].position).toBe(2);
    expect(results[0].keyword).toBe("molino azteca");
    expect(results[0].rankingUrl).toBe("https://molinoazteca.mx/page");
  });

  it("keyword sin posición en top → retorna position:null", async () => {
    const taskId = "task-004";

    mockFetch
      .mockResolvedValueOnce(makeTaskPostResponse([taskId]))
      .mockResolvedValueOnce(makeTasksReadyResponse([taskId]))
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tasks: [
              {
                id: taskId,
                status_code: 20000,
                cost: 0,
                result_count: 1,
                result: [
                  {
                    keyword: "keyword sin rank",
                    // items no contiene el dominio buscado
                    items: [
                      { type: "organic", rank_absolute: 5, url: "https://otro-sitio.com/page" },
                    ],
                  },
                ],
              },
            ],
          }),
      });

    const { DataForSeoProvider } = await import("../dataforseo");
    const provider = new DataForSeoProvider();

    const p = provider.bulkGetRankings([
      { keyword: "keyword sin rank", domain: "molinoazteca.mx", country: "MX", language: "es" },
    ]);
    await vi.runAllTimersAsync();
    const results = await p;

    expect(results[0].position).toBeNull();
  });
});
