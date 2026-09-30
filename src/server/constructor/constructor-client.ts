/**
 * Cliente HTTP para Constructor (SSE).
 * Llama a POST /api/internal/change-requests/create-and-execute
 * y parsea el stream de eventos SSE.
 */

import { env } from "@/env";

// ─── Tipos de entrada ────────────────────────────────────────────────────────

export interface ConstructorItem {
  section: string;
  change_type: string;
  description: string;
  priority: "normal" | "high";
  extra_data?: Record<string, unknown>;
  attachments_paths?: string[];
}

export interface ConstructorRequest {
  notion_client_id: string;
  items: ConstructorItem[];
  general_notes?: string;
  deadline?: string;
  idempotency_key: string;
}

// ─── Tipos de respuesta ──────────────────────────────────────────────────────

export interface ConstructorStepEvent {
  type: "step";
  step: string;
  message: string;
}

export interface ConstructorResultEvent {
  type: "result";
  success: boolean;
  id: string;
  request_code: string;
  commitSha?: string;
  filesChanged?: number;
  review_url?: string;
}

export interface ConstructorErrorEvent {
  type: "error";
  step: string;
  error: string;
  id?: string;
  review_url?: string;
}

export type ConstructorSSEEvent =
  | ConstructorStepEvent
  | ConstructorResultEvent
  | ConstructorErrorEvent;

export interface ConstructorResult {
  success: boolean;
  id?: string;
  requestCode?: string;
  commitSha?: string;
  filesChanged?: number;
  reviewUrl?: string;
  error?: string;
  events: ConstructorSSEEvent[];
}

// ─── Mapeo kind → change_type ────────────────────────────────────────────────

const KIND_TO_CHANGE_TYPE: Record<string, string | null> = {
  meta: "text_update",
  "contenido-blog": "add_articulo",
  "contenido-landing": "add_page",
  "contenido-optimizar": "text_update",
  schema: "code_change",
  tecnico: "code_change",
  interlinking: "code_change",
  setup: null, // HUMAN_TASK
  otro: null,  // HUMAN_TASK
};

const KIND_TO_SECTION: Record<string, string> = {
  meta: "Meta tags",
  schema: "Structured Data",
  interlinking: "Internal Links",
};

export function mapKindToChangeType(kind: string): string | null {
  return KIND_TO_CHANGE_TYPE[kind] ?? null;
}

export function mapKindToSection(kind: string): string {
  return KIND_TO_SECTION[kind] ?? "General";
}

export function isHumanTask(kind: string): boolean {
  return mapKindToChangeType(kind) === null;
}

// ─── Cliente SSE ─────────────────────────────────────────────────────────────

function getConstructorConfig(): { url: string; secret: string } {
  const url = env.CONSTRUCTOR_BASE_URL;
  const secret = env.CONSTRUCTOR_INTERNAL_SECRET;
  if (!url || !secret) {
    throw new Error(
      "CONSTRUCTOR_BASE_URL y CONSTRUCTOR_INTERNAL_SECRET son requeridos para ejecutar planes."
    );
  }
  return { url, secret };
}

/**
 * Parsea un stream SSE text/event-stream en eventos tipados.
 */
async function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<ConstructorSSEEvent[]> {
  const decoder = new TextDecoder();
  const events: ConstructorSSEEvent[] = [];
  let buffer = "";
  let currentEvent = "";
  let currentData = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    // Keep the last incomplete line in the buffer
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        currentData = line.slice(5).trim();
      } else if (line === "" && currentEvent && currentData) {
        try {
          const parsed = JSON.parse(currentData);
          events.push({ type: currentEvent, ...parsed } as ConstructorSSEEvent);
        } catch {
          console.warn("[constructor-client] Failed to parse SSE data:", currentData);
        }
        currentEvent = "";
        currentData = "";
      }
    }
  }

  return events;
}

/**
 * Llama a Constructor create-and-execute (SSE) y retorna el resultado.
 */
export async function executeChangeRequest(
  request: ConstructorRequest
): Promise<ConstructorResult> {
  const { url, secret } = getConstructorConfig();
  const endpoint = `${url}/api/internal/change-requests/create-and-execute`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(300_000), // 300s matching Constructor timeout
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      success: false,
      error: `Constructor respondió ${response.status}: ${text.slice(0, 500)}`,
      events: [],
    };
  }

  if (!response.body) {
    return {
      success: false,
      error: "Constructor no devolvió body (esperaba SSE stream).",
      events: [],
    };
  }

  const reader = response.body.getReader();
  const events = await parseSSEStream(reader);

  // Find the result or error event
  const resultEvent = events.find(
    (e): e is ConstructorResultEvent => e.type === "result"
  );
  const errorEvent = events.find(
    (e): e is ConstructorErrorEvent => e.type === "error"
  );

  if (resultEvent) {
    return {
      success: resultEvent.success,
      id: resultEvent.id,
      requestCode: resultEvent.request_code,
      commitSha: resultEvent.commitSha,
      filesChanged: resultEvent.filesChanged,
      reviewUrl: resultEvent.review_url,
      events,
    };
  }

  if (errorEvent) {
    return {
      success: false,
      id: errorEvent.id,
      reviewUrl: errorEvent.review_url,
      error: errorEvent.error,
      events,
    };
  }

  return {
    success: false,
    error: "Constructor no devolvió evento result ni error.",
    events,
  };
}

/**
 * Consulta el status de un change-request existente por idempotency_key.
 */
export async function getChangeRequestByIdempotencyKey(
  idempotencyKey: string
): Promise<{ id: string; status: string } | null> {
  const { url, secret } = getConstructorConfig();

  const response = await fetch(
    `${url}/api/internal/change-requests?idempotency_key=${encodeURIComponent(idempotencyKey)}`,
    {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (!response.ok) return null;

  const data = (await response.json()) as { id?: string; status?: string };
  if (!data.id) return null;

  return { id: data.id, status: data.status ?? "unknown" };
}
