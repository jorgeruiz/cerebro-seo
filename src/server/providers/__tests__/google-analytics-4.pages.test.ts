import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoogleAnalytics4Provider } from "../google-analytics-4";
import type { OAuth2Client } from "google-auth-library";

vi.mock("googleapis", () => ({
  google: {
    analyticsdata: vi.fn().mockReturnValue({
      properties: { runReport: vi.fn() },
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
const propertyId = "372913066";
const start = "2026-04-01";
const end = "2026-04-30";

async function getRunReportMock() {
  const { google } = await import("googleapis");
  const analyticsData = google.analyticsdata({ version: "v1beta", auth: fakeOAuth });
  return analyticsData.properties.runReport as ReturnType<typeof vi.fn>;
}

describe("GoogleAnalytics4Provider.getPagesMetrics", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("happy path: getPagesMetrics transforma filas con pagePath", async () => {
    const runMock = await getRunReportMock();
    runMock.mockResolvedValueOnce({
      data: {
        rows: [
          {
            dimensionValues: [{ value: "/servicios/filtros/" }],
            metricValues: [
              { value: "320" },   // sessions
              { value: "280" },   // totalUsers
              { value: "15" },    // conversions
              { value: "0.42" },  // bounceRate → 42.0%
              { value: "125.5" }, // avgSessionDuration
            ],
          },
        ],
      },
    });

    const provider = new GoogleAnalytics4Provider(fakeOAuth);
    const result = await provider.getPagesMetrics(propertyId, start, end);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      page: "/servicios/filtros/",
      sessions: 320,
      users: 280,
      conversions: 15,
      bounceRate: 42.0,
      avgSessionDuration: 126, // parseFloat("125.5").toFixed(0) = "126" → parseFloat = 126
    });
  });

  it("request incluye filtro Organic Search en dimensionFilter", async () => {
    const runMock = await getRunReportMock();
    runMock.mockResolvedValueOnce({ data: { rows: [] } });

    const provider = new GoogleAnalytics4Provider(fakeOAuth);
    await provider.getPagesMetrics(propertyId, start, end);

    const callArgs = runMock.mock.calls[0][0];
    expect(callArgs.requestBody.dimensionFilter).toMatchObject({
      filter: {
        fieldName: "sessionDefaultChannelGrouping",
        stringFilter: { value: "Organic Search" },
      },
    });
    expect(callArgs.requestBody.dimensions).toEqual([{ name: "pagePath" }]);
  });

  it("caché Redis hit no llama a GA4 API", async () => {
    const { redis } = await import("@/lib/redis");
    const cached = [
      { page: "/home/", sessions: 100, users: 80, conversions: 5, bounceRate: 35.0, avgSessionDuration: 90 },
    ];
    vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify(cached));

    const runMock = await getRunReportMock();
    const provider = new GoogleAnalytics4Provider(fakeOAuth);
    const result = await provider.getPagesMetrics(propertyId, start, end);

    expect(result).toEqual(cached);
    expect(runMock).not.toHaveBeenCalled();
  });
});
