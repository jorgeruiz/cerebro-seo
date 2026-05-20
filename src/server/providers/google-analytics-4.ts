import { google } from "googleapis";
import { redis } from "@/lib/redis";
import type { OAuth2Client } from "google-auth-library";

export interface DailyGa4Metric {
  date: string;     // "YYYY-MM-DD"
  sessions: number;
  users: number;
  bounceRate: number; // porcentaje, ej: 45.2
}

export interface Ga4Overview {
  totalSessions: number;
  totalUsers: number;
  avgBounceRate: number;
  totalConversions: number;
}

export interface Ga4PageRow {
  page: string;               // pagePath relativa, ej: "/servicios/filtros"
  sessions: number;
  users: number;
  conversions: number;
  bounceRate: number;         // porcentaje, ej: 45.2
  avgSessionDuration: number; // segundos
}

// GA4 devuelve fechas como "20260412" — convertir a "2026-04-12"
function parseGa4Date(raw: string): string {
  return raw.length === 8
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
    : raw;
}

export class GoogleAnalytics4Provider {
  constructor(private auth: OAuth2Client) {}

  async getDailyMetrics(
    propertyId: string,
    startDate: string,
    endDate: string
  ): Promise<DailyGa4Metric[]> {
    const cacheKey = `cache:ga4:${propertyId}:${startDate}:${endDate}:daily`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as DailyGa4Metric[];
    } catch { /* Redis caído — continuar sin caché */ }

    const analyticsData = google.analyticsdata({ version: "v1beta", auth: this.auth });
    const { data } = await analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "date" }],
        metrics: [
          { name: "sessions" },
          { name: "activeUsers" },
          { name: "bounceRate" },
        ],
        dimensionFilter: {
          filter: {
            fieldName: "sessionDefaultChannelGrouping",
            stringFilter: { value: "Organic Search" },
          },
        },
        orderBys: [{ dimension: { dimensionName: "date" } }],
      },
    });

    const metrics: DailyGa4Metric[] = (data.rows ?? []).map((row) => ({
      date: parseGa4Date(row.dimensionValues?.[0]?.value ?? ""),
      sessions: parseInt(row.metricValues?.[0]?.value ?? "0"),
      users: parseInt(row.metricValues?.[1]?.value ?? "0"),
      bounceRate: parseFloat(
        (parseFloat(row.metricValues?.[2]?.value ?? "0") * 100).toFixed(1)
      ),
    }));

    try {
      await redis.set(cacheKey, JSON.stringify(metrics), "EX", 14400); // 4h
    } catch { /* Redis caído — devolver datos sin cachear */ }

    return metrics;
  }

  async getOverview(
    propertyId: string,
    startDate: string,
    endDate: string
  ): Promise<Ga4Overview> {
    const cacheKey = `cache:ga4:${propertyId}:${startDate}:${endDate}:overview`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as Ga4Overview;
    } catch { /* Redis caído — continuar sin caché */ }

    const analyticsData = google.analyticsdata({ version: "v1beta", auth: this.auth });
    const { data } = await analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        metrics: [
          { name: "sessions" },
          { name: "activeUsers" },
          { name: "bounceRate" },
          { name: "conversions" },
        ],
        dimensionFilter: {
          filter: {
            fieldName: "sessionDefaultChannelGrouping",
            stringFilter: { value: "Organic Search" },
          },
        },
        // TOTAL para que data.totals[0] contenga el agregado — sin esto devuelve undefined
        metricAggregations: ["TOTAL"],
        keepEmptyRows: false,
      },
    });

    // data.totals[0] tiene el agregado cuando se solicita TOTAL
    // data.rows[0] es fallback cuando GA4 no devuelve totals (sin dimensiones)
    const totals = data.totals?.[0] ?? data.rows?.[0];
    const overview: Ga4Overview = {
      totalSessions: parseInt(totals?.metricValues?.[0]?.value ?? "0"),
      totalUsers: parseInt(totals?.metricValues?.[1]?.value ?? "0"),
      avgBounceRate: parseFloat(
        (parseFloat(totals?.metricValues?.[2]?.value ?? "0") * 100).toFixed(1)
      ),
      totalConversions: parseInt(totals?.metricValues?.[3]?.value ?? "0"),
    };

    try {
      await redis.set(cacheKey, JSON.stringify(overview), "EX", 14400);
    } catch { /* Redis caído — devolver datos sin cachear */ }

    return overview;
  }

  async getPagesMetrics(
    propertyId: string,
    startDate: string,
    endDate: string
  ): Promise<Ga4PageRow[]> {
    const cacheKey = `cache:ga4:${propertyId}:${startDate}:${endDate}:pages`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as Ga4PageRow[];
    } catch { /* Redis caído — continuar sin caché */ }

    const analyticsData = google.analyticsdata({ version: "v1beta", auth: this.auth });
    const { data } = await analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "pagePath" }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "conversions" },
          { name: "bounceRate" },
          { name: "averageSessionDuration" },
        ],
        dimensionFilter: {
          filter: {
            fieldName: "sessionDefaultChannelGrouping",
            stringFilter: { value: "Organic Search" },
          },
        },
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      },
    });

    const rows: Ga4PageRow[] = (data.rows ?? []).map((row) => ({
      page: row.dimensionValues?.[0]?.value ?? "",
      sessions: parseInt(row.metricValues?.[0]?.value ?? "0"),
      users: parseInt(row.metricValues?.[1]?.value ?? "0"),
      conversions: parseInt(row.metricValues?.[2]?.value ?? "0"),
      bounceRate: parseFloat(
        (parseFloat(row.metricValues?.[3]?.value ?? "0") * 100).toFixed(1)
      ),
      avgSessionDuration: parseFloat(
        parseFloat(row.metricValues?.[4]?.value ?? "0").toFixed(0)
      ),
    }));

    try {
      await redis.set(cacheKey, JSON.stringify(rows), "EX", 14400); // 4h
    } catch { /* Redis caído — devolver datos sin cachear */ }

    return rows;
  }
}
