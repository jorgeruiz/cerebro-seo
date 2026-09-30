/**
 * Cliente HTTP para Constructor.
 *
 * Rutea automáticamente al endpoint correcto según el kind del step:
 * - meta, contenido-blog, contenido-landing → endpoints directos ($0, 3-8s)
 * - schema, tecnico, interlinking, contenido-optimizar → agente SSE (~$0.05, 30-90s)
 * - setup, otro → HUMAN_TASK (no llama a Constructor)
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

// ─── Tipos de respuesta (SSE) ────────────────────────────────────────────────

export interface ConstructorStepEvent {
  type: "step";
  step: string;
  message: string;
  id?: string;
  request_code?: string;
}

export interface ConstructorResultEvent {
  type: "result";
  success: boolean;
  id: string;
  request_code: string;
  commitSha?: string;
  commitUrl?: string;
  filesChanged?: string[];
  toolCalls?: number;
  tokensUsed?: { input: number; output: number };
  review_url?: string;
  prompt?: string; // incluido si success:false, para ejecución manual
}

export interface ConstructorErrorEvent {
  type: "error";
  step: string;
  error: string;
  id?: string;
  review_url?: string;
  prompt?: string;
  filesChanged?: string[];
  toolCalls?: number;
  tokensUsed?: { input: number; output: number };
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
  commitUrl?: string;
  filesChanged?: string[];
  reviewUrl?: string;
  error?: string;
  prompt?: string; // si falla, prompt para ejecución manual
  events: ConstructorSSEEvent[];
  /** true si se usó un endpoint directo ($0) en vez del agente */
  directPublish: boolean;
}

// ─── Tipos para endpoints directos ──────────────────────────────────────────

export interface DirectPublishResult {
  success: boolean;
  sha?: string;
  url?: string;
  slug?: string;
  filesCreated?: string[];
  filesUpdated?: string[];
  error?: string;
  needsBootstrap?: boolean;
}

// ─── Clasificación de ejecución ──────────────────────────────────────────────

/** Tipo de ejecución visible al usuario */
export type ExecutionType = "ia" | "hibrido" | "ht";

/** Ruta interna de ejecución */
export type ExecutionRoute = "direct-blog" | "direct-landing" | "direct-meta" | "agent" | "human";

const KIND_TO_ROUTE: Record<string, ExecutionRoute> = {
  meta: "direct-meta",
  "contenido-blog": "direct-blog",
  "contenido-landing": "direct-landing",
  "contenido-optimizar": "agent",
  schema: "agent",
  tecnico: "agent",
  interlinking: "agent",
  setup: "human",
  otro: "human",
};

const KIND_TO_EXEC_TYPE: Record<string, ExecutionType> = {
  meta: "ia",
  schema: "ia",
  tecnico: "ia",
  interlinking: "ia",
  "contenido-optimizar": "ia",
  "contenido-blog": "hibrido",    // Constructor publica, humano revisa + cover image
  "contenido-landing": "hibrido", // Constructor publica, humano revisa
  setup: "ht",
  otro: "ht",
};

const KIND_TO_CHANGE_TYPE: Record<string, string | null> = {
  meta: "text_update",
  "contenido-blog": "add_articulo",
  "contenido-landing": "add_page",
  "contenido-optimizar": "text_update",
  schema: "code_change",
  tecnico: "code_change",
  interlinking: "code_change",
  setup: null,
  otro: null,
};

const KIND_TO_SECTION: Record<string, string> = {
  meta: "Meta tags",
  schema: "Structured Data",
  interlinking: "Internal Links",
};

export function getExecutionRoute(kind: string): ExecutionRoute {
  return KIND_TO_ROUTE[kind] ?? "human";
}

export function getExecutionType(kind: string): ExecutionType {
  return KIND_TO_EXEC_TYPE[kind] ?? "ht";
}

export function mapKindToChangeType(kind: string): string | null {
  return KIND_TO_CHANGE_TYPE[kind] ?? null;
}

export function mapKindToSection(kind: string): string {
  return KIND_TO_SECTION[kind] ?? "General";
}

export function isHumanTask(kind: string): boolean {
  return getExecutionRoute(kind) === "human";
}

export function isDirectPublish(kind: string): boolean {
  const route = getExecutionRoute(kind);
  return route === "direct-blog" || route === "direct-landing" || route === "direct-meta";
}

// ─── Config ──────────────────────────────────────────────────────────────────

function getConstructorConfig(): { url: string; secret: string } {
  const url = env.CONSTRUCTOR_URL;
  const secret = env.CONSTRUCTOR_INTERNAL_SECRET;
  if (!url || !secret) {
    throw new Error(
      "CONSTRUCTOR_URL y CONSTRUCTOR_INTERNAL_SECRET son requeridos para ejecutar planes."
    );
  }
  return { url, secret };
}

// ─── Endpoints directos ─────────────────────────────────────────────────────

/**
 * Publica un artículo de blog directamente ($0, 3-8s).
 */
export async function publishBlogPost(params: {
  notionClientId: string;
  titulo: string;
  cuerpo: string;
  categoria?: string;
  tags?: string;
  extracto?: string;
  autor?: string;
}): Promise<DirectPublishResult> {
  const { url, secret } = getConstructorConfig();

  const response = await fetch(`${url}/api/internal/blog/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      notion_client_id: params.notionClientId,
      titulo: params.titulo,
      cuerpo: params.cuerpo,
      categoria: params.categoria ?? "General",
      tags: params.tags ?? "",
      extracto: params.extracto ?? "",
      autor: params.autor ?? "Click Society",
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 409) {
    return { success: false, needsBootstrap: true, error: "Blog no bootstrapped en este sitio." };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { success: false, error: `Constructor respondió ${response.status}: ${text.slice(0, 500)}` };
  }

  const data = await response.json() as Record<string, unknown>;
  return {
    success: true,
    sha: data.sha as string | undefined,
    url: data.url as string | undefined,
    slug: data.slug as string | undefined,
    filesCreated: data.filesCreated as string[] | undefined,
  };
}

/**
 * Publica una landing page directamente ($0, 3-8s).
 */
export async function publishLanding(params: {
  notionClientId: string;
  titulo: string;
  descripcion: string;
  cuerpo: string;
  ctaPrincipal?: string;
  noindex?: boolean;
}): Promise<DirectPublishResult> {
  const { url, secret } = getConstructorConfig();

  const response = await fetch(`${url}/api/internal/content/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      type: "landing",
      notion_client_id: params.notionClientId,
      titulo: params.titulo,
      descripcion: params.descripcion,
      cuerpo: params.cuerpo,
      cta_principal: params.ctaPrincipal ?? "Contactar",
      noindex: params.noindex ?? false,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 409) {
    return { success: false, needsBootstrap: true, error: "Landing pages no bootstrapped en este sitio." };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { success: false, error: `Constructor respondió ${response.status}: ${text.slice(0, 500)}` };
  }

  const data = await response.json() as Record<string, unknown>;
  return {
    success: true,
    sha: data.sha as string | undefined,
    slug: data.slug as string | undefined,
    filesCreated: data.filesCreated as string[] | undefined,
  };
}

/**
 * Actualiza meta tags directamente ($0, 3-8s).
 */
export async function publishMetaTags(params: {
  notionClientId: string;
  pages: Array<{
    page_path: string;
    meta_title?: string;
    meta_description?: string;
    og_title?: string;
    og_description?: string;
    noindex?: boolean;
  }>;
}): Promise<DirectPublishResult> {
  const { url, secret } = getConstructorConfig();

  const response = await fetch(`${url}/api/internal/content/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      type: "meta_tags",
      notion_client_id: params.notionClientId,
      pages: params.pages,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { success: false, error: `Constructor respondió ${response.status}: ${text.slice(0, 500)}` };
  }

  const data = await response.json() as Record<string, unknown>;
  return {
    success: true,
    sha: data.sha as string | undefined,
    url: data.url as string | undefined,
    filesUpdated: data.filesUpdated as string[] | undefined,
  };
}

// ─── SSE Parser ──────────────────────────────────────────────────────────────

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

// ─── Agente SSE ──────────────────────────────────────────────────────────────

/**
 * Llama a Constructor create-and-execute (SSE) y retorna el resultado.
 * Usar para cambios de código que requieren el agente IA.
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
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      success: false,
      error: `Constructor respondió ${response.status}: ${text.slice(0, 500)}`,
      events: [],
      directPublish: false,
    };
  }

  if (!response.body) {
    return {
      success: false,
      error: "Constructor no devolvió body (esperaba SSE stream).",
      events: [],
      directPublish: false,
    };
  }

  const reader = response.body.getReader();
  const events = await parseSSEStream(reader);

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
      commitUrl: resultEvent.commitUrl,
      filesChanged: resultEvent.filesChanged,
      reviewUrl: resultEvent.review_url,
      prompt: resultEvent.prompt,
      events,
      directPublish: false,
    };
  }

  if (errorEvent) {
    return {
      success: false,
      id: errorEvent.id,
      reviewUrl: errorEvent.review_url,
      error: errorEvent.error,
      prompt: errorEvent.prompt,
      events,
      directPublish: false,
    };
  }

  return {
    success: false,
    error: "Constructor no devolvió evento result ni error.",
    events,
    directPublish: false,
  };
}

// ─── Consulta ────────────────────────────────────────────────────────────────

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

  const data = (await response.json()) as { request?: { id?: string; status?: string } };
  const req = data.request;
  if (!req?.id) return null;

  return { id: req.id, status: req.status ?? "unknown" };
}
