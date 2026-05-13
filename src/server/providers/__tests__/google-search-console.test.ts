import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoogleSearchConsoleProvider } from "../google-search-console";
import type { OAuth2Client } from "google-auth-library";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock googleapis
vi.mock("googleapis", () => ({
  google: {
    webmasters: vi.fn().mockReturnValue({
      searchanalytics: {
        query: vi.fn(),
      },
    }),
  },
}));

// Mock ioredis — evita conexión real durante tests
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const fakeOAuth = {} as OAuth2Client;
const site = "https://www.molino-azteca.com.mx/";
const start = "2026-04-01";
const end = "2026-04-30";

async function getQueryMock() {
  const { google } = await import("googleapis");
  const wmt = google.webmasters({ version: "v3", auth: fakeOAuth });
  return wmt.searchanalytics.query as ReturnType<typeof vi.fn>;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GoogleSearchConsoleProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: getDailyMetrics transforma filas de GSC correctamente", async () => {
    const queryMock = await getQueryMock();
    queryMock.mockResolvedValueOnce({
      data: {
        rows: [
          { keys: ["2026-04-01"], clicks: 120, impressions: 2400, ctr: 0.05, position: 8.3 },
          { keys: ["2026-04-02"], clicks: 95, impressions: 1800, ctr: 0.0528, position: 7.9 },
        ],
      },
    });

    const provider = new GoogleSearchConsoleProvider(fakeOAuth);
    const result = await provider.getDailyMetrics(site, start, end);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      date: "2026-04-01",
      clicks: 120,
      impressions: 2400,
      ctr: 5,      // 0.05 × 100
      position: 8.3,
    });
    expect(result[0].label).toMatch(/^\d+ \w+$/); // "1 abr"
  });

  it("getOverview devuelve totales agregados del período", async () => {
    const queryMock = await getQueryMock();
    queryMock.mockResolvedValueOnce({
      data: {
        rows: [
          { clicks: 3400, impressions: 68000, ctr: 0.05, position: 9.1 },
        ],
      },
    });

    const provider = new GoogleSearchConsoleProvider(fakeOAuth);
    const overview = await provider.getOverview(site, start, end);

    expect(overview.totalClicks).toBe(3400);
    expect(overview.totalImpressions).toBe(68000);
    expect(overview.avgCtr).toBe(5);
    expect(overview.avgPosition).toBe(9.1);
  });

  it("getOverview devuelve ceros si GSC no tiene datos para el período", async () => {
    const queryMock = await getQueryMock();
    queryMock.mockResolvedValueOnce({ data: { rows: [] } });

    const provider = new GoogleSearchConsoleProvider(fakeOAuth);
    const overview = await provider.getOverview(site, start, end);

    expect(overview.totalClicks).toBe(0);
    expect(overview.totalImpressions).toBe(0);
    expect(overview.avgCtr).toBe(0);
    expect(overview.avgPosition).toBe(0);
  });

  it("getDailyMetrics usa caché Redis en segunda llamada y no vuelve a llamar a GSC", async () => {
    const { redis } = await import("@/lib/redis");
    const cached = [
      { date: "2026-04-01", label: "1 abr", clicks: 10, impressions: 200, ctr: 5, position: 7 },
    ];
    vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify(cached));

    const queryMock = await getQueryMock();
    const provider = new GoogleSearchConsoleProvider(fakeOAuth);
    const result = await provider.getDailyMetrics(site, start, end);

    expect(result).toEqual(cached);
    expect(queryMock).not.toHaveBeenCalled(); // caché hit, sin llamada a GSC
  });
});
