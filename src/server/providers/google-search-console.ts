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

export interface GscQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;      // porcentaje, ej: 3.45
  position: number; // promedio, ej: 8.2
}

export interface GscQueriesParams {
  siteUrl: string;
  startDate: string;
  endDate: string;
  device?: "all" | "desktop" | "mobile" | "tablet";
  country?: string; // ISO 3166-1 alpha-3: "mex", "usa", "esp", ...
  rowLimit?: number;
}

export interface GscPageRow {
  page: string;      // URL absoluta tal como devuelve GSC
  clicks: number;
  impressions: number;
  ctr: number;       // porcentaje, ej: 3.45
  position: number;  // promedio
}

export interface GscPagesParams {
  siteUrl: string;
  startDate: string;
  endDate: string;
  rowLimit?: number;
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

    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as DailyGscMetric[];
    } catch { /* Redis caído — continuar sin caché */ }

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

    try {
      await redis.set(cacheKey, JSON.stringify(metrics), "EX", 86400);
    } catch { /* Redis caído — devolver datos sin cachear */ }

    return metrics;
  }

  async getOverview(
    siteUrl: string,
    startDate: string,
    endDate: string
  ): Promise<GscOverview> {
    const cacheKey = `cache:gsc:${encodeURIComponent(siteUrl)}:${startDate}:${endDate}:overview`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as GscOverview;
    } catch { /* Redis caído — continuar sin caché */ }

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

    try {
      await redis.set(cacheKey, JSON.stringify(overview), "EX", 86400);
    } catch { /* Redis caído — devolver datos sin cachear */ }

    return overview;
  }

  async getQueries(params: GscQueriesParams): Promise<GscQueryRow[]> {
    const { siteUrl, startDate, endDate, device = "all", country = "all", rowLimit = 1000 } = params;

    // Clave de caché única por combinación de filtros
    const filterKey = `${device}:${country}`;
    const cacheKey = `cache:gsc:${encodeURIComponent(siteUrl)}:${startDate}:${endDate}:queries:${filterKey}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as GscQueryRow[];
    } catch { /* Redis caído — continuar sin caché */ }

    const sc = google.webmasters({ version: "v3", auth: this.auth });

    // Construir filtros de dimensiones
    const dimensionFilterGroups = [];
    if (device !== "all") {
      dimensionFilterGroups.push({
        filters: [{
          dimension: "device",
          operator: "equals",
          expression: device,
        }],
      });
    }
    if (country !== "all") {
      dimensionFilterGroups.push({
        filters: [{
          dimension: "country",
          operator: "equals",
          expression: country,
        }],
      });
    }

    const { data } = await sc.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ["query"],
        ...(dimensionFilterGroups.length > 0 ? { dimensionFilterGroups } : {}),
        rowLimit,
      },
    });

    const rows: GscQueryRow[] = (data.rows ?? []).map((row) => ({
      query: row.keys?.[0] ?? "",
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: parseFloat(((row.ctr ?? 0) * 100).toFixed(2)),
      position: parseFloat((row.position ?? 0).toFixed(1)),
    }));

    try {
      await redis.set(cacheKey, JSON.stringify(rows), "EX", 86400);
    } catch { /* Redis caído — devolver datos sin cachear */ }

    return rows;
  }

  async getPages(params: GscPagesParams): Promise<GscPageRow[]> {
    const { siteUrl, startDate, endDate, rowLimit = 500 } = params;
    const cacheKey = `cache:gsc:${encodeURIComponent(siteUrl)}:${startDate}:${endDate}:pages`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as GscPageRow[];
    } catch { /* Redis caído — continuar sin caché */ }

    const sc = google.webmasters({ version: "v3", auth: this.auth });
    const { data } = await sc.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ["page"],
        rowLimit,
      },
    });

    const rows: GscPageRow[] = (data.rows ?? []).map((row) => ({
      page: row.keys?.[0] ?? "",
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: parseFloat(((row.ctr ?? 0) * 100).toFixed(2)),
      position: parseFloat((row.position ?? 0).toFixed(1)),
    }));

    try {
      await redis.set(cacheKey, JSON.stringify(rows), "EX", 86400);
    } catch { /* Redis caído — devolver datos sin cachear */ }

    return rows;
  }
}
