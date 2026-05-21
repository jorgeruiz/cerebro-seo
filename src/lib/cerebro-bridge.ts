/**
 * Cliente HTTP tipado para consumir los endpoints internos de Cerebro web.
 *
 * Los endpoints del lado de Cerebro web aún NO existen (2026-05-20).
 * Cuando se implementen en Cerebro web, activar los workers en schedulers.ts.
 * Ver: integration_cerebro.md §4
 */

export interface CerebroClient {
  id: string;           // ID de Notion (page id)
  name: string;
  domain: string;
  status: "active" | "paused" | "inactive";
  services: string[];   // ["seo", "google_ads", ...]
  gscProperty?: string;
  ga4Property?: string;
}

export interface CerebroTask {
  id: string;           // ID de Notion
  title: string;
  description: string | null;
  status: "todo" | "in_progress" | "done" | "blocked";
  dueDate: string | null; // ISO
  assignee: string | null;
  affectedUrls: string[];
  affectedKeywords: string[];
  hypothesis: {
    expectedResult: string;
    timeframeDays: number;
  } | null;
}

export interface CerebroStrategy {
  yearMonth: string;    // "2026-05"
  goals: string[];
  focus: string;
  notes: string | null;
}

// ── Helpers internos ──────────────────────────────────────────────────────────

function baseUrl(): string {
  return process.env.CEREBRO_API_URL ?? "http://localhost:3001";
}

function authHeader(): HeadersInit {
  const secret = process.env.CEREBRO_INTERNAL_SECRET;
  if (!secret) return {};
  return { Authorization: `Bearer ${secret}` };
}

async function cerebroFetch<T>(
  path: string,
  fallback: T
): Promise<T> {
  const url = `${baseUrl()}${path}`;
  const start = Date.now();

  async function attempt(retry: boolean): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(url, {
        headers: { ...authHeader(), "Content-Type": "application/json" },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.status === 404) {
        console.warn(`[cerebro-bridge] endpoint not available yet: ${path}`);
        return fallback;
      }

      // Retry una vez en 5xx
      if (res.status >= 500 && retry) {
        console.warn(`[cerebro-bridge] 5xx from ${path}, retrying once...`);
        await new Promise((r) => setTimeout(r, 1_000));
        return attempt(false);
      }

      if (!res.ok) {
        console.warn(`[cerebro-bridge] ${res.status} from ${path}`);
        return fallback;
      }

      const json = (await res.json()) as T;
      console.log(`[cerebro-bridge] ${path} → ${Date.now() - start}ms`);
      return json;
    } catch (err) {
      clearTimeout(timeout);
      const isAbort = err instanceof Error && err.name === "AbortError";
      console.warn(`[cerebro-bridge] ${isAbort ? "timeout" : "network error"} on ${path}:`, err);
      return fallback;
    }
  }

  return attempt(true);
}

// ── Funciones públicas ────────────────────────────────────────────────────────

export async function fetchClientsFromCerebro(): Promise<CerebroClient[]> {
  return cerebroFetch<CerebroClient[]>("/api/internal/seo/clients", []);
}

export async function fetchActiveTasks(cerebroClientId: string): Promise<CerebroTask[]> {
  return cerebroFetch<CerebroTask[]>(
    `/api/internal/seo/clients/${cerebroClientId}/tasks/active`,
    []
  );
}

export async function fetchCurrentStrategy(
  cerebroClientId: string
): Promise<CerebroStrategy | null> {
  return cerebroFetch<CerebroStrategy | null>(
    `/api/internal/seo/clients/${cerebroClientId}/strategy/current`,
    null
  );
}
