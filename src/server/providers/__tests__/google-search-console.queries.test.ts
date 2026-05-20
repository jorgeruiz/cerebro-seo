import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoogleSearchConsoleProvider } from "../google-search-console";
import type { OAuth2Client } from "google-auth-library";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("googleapis", () => ({
  google: {
    webmasters: vi.fn().mockReturnValue({
      searchanalytics: {
        query: vi.fn(),
      },
    }),
  },
}));

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

describe("GoogleSearchConsoleProvider.getQueries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: getQueries transforma filas de GSC en GscQueryRow[]", async () => {
    const queryMock = await getQueryMock();
    queryMock.mockResolvedValueOnce({
      data: {
        rows: [
          { keys: ["instalación filtros industriales"], clicks: 320, impressions: 4200, ctr: 0.0762, position: 4.1 },
          { keys: ["filtros industriales precio"],       clicks: 140, impressions: 2800, ctr: 0.05,   position: 7.3 },
        ],
      },
    });

    const provider = new GoogleSearchConsoleProvider(fakeOAuth);
    const result = await provider.getQueries({ siteUrl: site, startDate: start, endDate: end });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      query: "instalación filtros industriales",
      clicks: 320,
      impressions: 4200,
      ctr: 7.62,     // 0.0762 × 100
      position: 4.1,
    });
  });

  it("filtro device se traduce a dimensionFilterGroups en el request", async () => {
    const queryMock = await getQueryMock();
    queryMock.mockResolvedValueOnce({ data: { rows: [] } });

    const provider = new GoogleSearchConsoleProvider(fakeOAuth);
    await provider.getQueries({ siteUrl: site, startDate: start, endDate: end, device: "mobile" });

    const callArgs = queryMock.mock.calls[0][0];
    expect(callArgs.requestBody.dimensionFilterGroups).toEqual([
      {
        filters: [{ dimension: "device", operator: "equals", expression: "mobile" }],
      },
    ]);
  });

  it("caché Redis hit no llama a la API", async () => {
    const { redis } = await import("@/lib/redis");
    const cached = [
      { query: "filtros agua", clicks: 50, impressions: 900, ctr: 5.56, position: 6.2 },
    ];
    vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify(cached));

    const queryMock = await getQueryMock();
    const provider = new GoogleSearchConsoleProvider(fakeOAuth);
    const result = await provider.getQueries({ siteUrl: site, startDate: start, endDate: end });

    expect(result).toEqual(cached);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
