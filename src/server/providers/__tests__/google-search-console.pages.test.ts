import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoogleSearchConsoleProvider } from "../google-search-console";
import type { OAuth2Client } from "google-auth-library";

vi.mock("googleapis", () => ({
  google: {
    webmasters: vi.fn().mockReturnValue({
      searchanalytics: { query: vi.fn() },
    }),
  },
}));

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
  },
}));

const fakeOAuth = {} as OAuth2Client;
const site = "https://www.molino-azteca.com.mx/";
const start = "2026-04-01";
const end = "2026-04-30";

async function getQueryMock() {
  const { google } = await import("googleapis");
  const wmt = google.webmasters({ version: "v3", auth: fakeOAuth });
  return wmt.searchanalytics.query as ReturnType<typeof vi.fn>;
}

describe("GoogleSearchConsoleProvider.getPages", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("happy path: getPages transforma filas con dimension page", async () => {
    const queryMock = await getQueryMock();
    queryMock.mockResolvedValueOnce({
      data: {
        rows: [
          { keys: ["https://www.molino-azteca.com.mx/servicios/"], clicks: 180, impressions: 3200, ctr: 0.05625, position: 5.2 },
          { keys: ["https://www.molino-azteca.com.mx/"],           clicks: 95,  impressions: 1400, ctr: 0.0679, position: 8.1 },
        ],
      },
    });

    const provider = new GoogleSearchConsoleProvider(fakeOAuth);
    const result = await provider.getPages({ siteUrl: site, startDate: start, endDate: end });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      page: "https://www.molino-azteca.com.mx/servicios/",
      clicks: 180,
      impressions: 3200,
      ctr: 5.63,     // 0.05625 × 100 → 5.625 → toFixed(2) = 5.63
      position: 5.2,
    });
    // request debe enviar dimensions: ['page']
    const callArgs = queryMock.mock.calls[0][0];
    expect(callArgs.requestBody.dimensions).toEqual(["page"]);
  });

  it("caché Redis hit no llama a la API GSC", async () => {
    const { redis } = await import("@/lib/redis");
    const cached = [
      { page: "/servicios/", clicks: 50, impressions: 900, ctr: 5.56, position: 6.2 },
    ];
    vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify(cached));

    const queryMock = await getQueryMock();
    const provider = new GoogleSearchConsoleProvider(fakeOAuth);
    const result = await provider.getPages({ siteUrl: site, startDate: start, endDate: end });

    expect(result).toEqual(cached);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
