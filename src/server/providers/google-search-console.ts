import { google } from "googleapis";
import { redis } from "@/lib/redis";
import type { OAuth2Client } from "google-auth-library";

export interface DailyGscMetric {
  date: string;       // "YYYY-MM-DD"
  label: string;      // "12 may" — formateado para el chart
  clicks: number;
  impressions: number;
  ctr: number;        // porcentaje, ej: 3.45
  position: number;   // promedio, ej: 8.2
}

export interface GscOverview {
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;
  avgPosition: number;
}

const MONTHS_ES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

function formatDateLabel(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${parseInt(d)} ${MONTHS_ES[parseInt(m) - 1]}`;
}

export class GoogleSearchConsoleProvider {
  constructor(private auth: OAuth2Client) {}

  async getDailyMetrics(
    siteUrl: string,
    startDate: string,
    endDate: string
  ): Promise<DailyGscMetric[]> {
    const cacheKey = `cache:gsc:${encodeURIComponent(siteUrl)}:${startDate}:${endDate}:daily`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as DailyGscMetric[];

    const sc = google.webmasters({ version: "v3", auth: this.auth });
    const { data } = await sc.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ["date"],
        rowLimit: 90,
      },
    });

    const metrics: DailyGscMetric[] = (data.rows ?? []).map((row) => {
      const iso = row.keys?.[0] ?? "";
      return {
        date: iso,
        label: formatDateLabel(iso),
        clicks: row.clicks ?? 0,
        impressions: row.impressions ?? 0,
        ctr: parseFloat(((row.ctr ?? 0) * 100).toFixed(2)),
        position: parseFloat((row.position ?? 0).toFixed(1)),
      };
    });

    await redis.set(cacheKey, JSON.stringify(metrics), "EX", 86400);
    return metrics;
  }

  async getOverview(
    siteUrl: string,
    startDate: string,
    endDate: string
  ): Promise<GscOverview> {
    const cacheKey = `cache:gsc:${encodeURIComponent(siteUrl)}:${startDate}:${endDate}:overview`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as GscOverview;

    const sc = google.webmasters({ version: "v3", auth: this.auth });
    const { data } = await sc.searchanalytics.query({
      siteUrl,
      requestBody: { startDate, endDate, rowLimit: 1 },
    });

    const row = data.rows?.[0];
    const overview: GscOverview = {
      totalClicks: row?.clicks ?? 0,
      totalImpressions: row?.impressions ?? 0,
      avgCtr: parseFloat(((row?.ctr ?? 0) * 100).toFixed(2)),
      avgPosition: parseFloat((row?.position ?? 0).toFixed(1)),
    };

    await redis.set(cacheKey, JSON.stringify(overview), "EX", 86400);
    return overview;
  }
}
