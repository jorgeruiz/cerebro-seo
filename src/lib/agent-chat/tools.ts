import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { MAX_ITEMS_PER_CR } from "./config";

// ── Tool definitions ────────────────────────────────────────────────────────

export function getToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: "get_seo_plan",
      description:
        "Obtiene el plan SEO actual del cliente (tareas, estado, prioridades).",
      input_schema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "get_keywords",
      description:
        "Obtiene las keywords objetivo del cliente con volumen y posicion actual.",
      input_schema: { type: "object" as const, properties: {}, required: [] },
    },
    // get_site_sections — desactivada en v1: Constructor no tiene endpoint de site-map.
    // {
    //   name: "get_site_sections",
    //   description: "Obtiene las secciones y paginas del sitio (equivalente a site-map).",
    //   input_schema: { type: "object" as const, properties: {}, required: [] },
    // },
    // request_attachment — desactivada en v1: no hay endpoint de upload ni storage definido.
    // {
    //   name: "request_attachment",
    //   description: "Pide al usuario que suba un archivo (imagen, documento).",
    //   input_schema: { type: "object" as const, properties: { prompt: { type: "string" } }, required: ["prompt"] },
    // },
    {
      name: "propose_change_summary",
      description: `Muestra al usuario un resumen estructurado de los cambios para confirmar. Max ${MAX_ITEMS_PER_CR} items.`,
      input_schema: {
        type: "object" as const,
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                section: { type: "string" },
                change_type: { type: "string" },
                description: { type: "string" },
                priority: {
                  type: "string",
                  enum: ["urgent", "normal", "whenever"],
                },
                extra_data: { type: "object" },
              },
              required: ["section", "change_type", "description"],
            },
            maxItems: MAX_ITEMS_PER_CR,
          },
          general_notes: { type: "string" },
        },
        required: ["items"],
      },
    },
    {
      name: "submit_change_request",
      description:
        "Envia la solicitud. SOLO despues de confirmacion explicita del usuario.",
      input_schema: {
        type: "object" as const,
        properties: {
          confirmed: { type: "boolean" },
        },
        required: ["confirmed"],
      },
    },
    {
      name: "get_request_status",
      description: "Consulta el estado de una solicitud existente.",
      input_schema: {
        type: "object" as const,
        properties: {
          request_code: { type: "string" },
        },
        required: ["request_code"],
      },
    },
  ];
}

// ── Tool context ────────────────────────────────────────────────────────────

export interface ToolContext {
  notionClientId: string;
  clientId: string; // internal Cerebro SEO client ID
  clientName: string;
  conversationId: string;
  pendingSummary: {
    items: Array<{
      section: string;
      change_type: string;
      description: string;
      priority?: string;
      extra_data?: Record<string, unknown>;
    }>;
    general_notes?: string;
    version: number;
  } | null;
}

// ── Tool executor ───────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  switch (name) {
    case "get_seo_plan":
      return executeGetSeoPlan(ctx);
    case "get_keywords":
      return executeGetKeywords(ctx);
    case "propose_change_summary":
      return executeProposeSummary(
        input as {
          items: Array<{
            section: string;
            change_type: string;
            description: string;
            priority?: string;
            extra_data?: Record<string, unknown>;
          }>;
          general_notes?: string;
        },
        ctx,
      );
    case "submit_change_request":
      return executeSubmit(input as { confirmed: boolean }, ctx);
    case "get_request_status":
      return executeGetStatus(input as { request_code: string });
    default:
      return `Herramienta "${name}" no reconocida.`;
  }
}

// ── Implementations ─────────────────────────────────────────────────────────

async function executeGetSeoPlan(ctx: ToolContext): Promise<string> {
  const plan = await prisma.monthlyPlan.findFirst({
    where: { clientId: ctx.clientId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      month: true,
      status: true,
      summary: true,
      focus: true,
      tasks: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          title: true,
          kind: true,
          status: true,
          actionType: true,
          priority: true,
          order: true,
        },
      },
    },
  });

  if (!plan) {
    return JSON.stringify({
      type: "seo_plan",
      message: "No hay plan mensual activo para este cliente.",
    });
  }

  return JSON.stringify({
    type: "seo_plan",
    month: plan.month,
    status: plan.status,
    summary: plan.summary,
    focus: plan.focus,
    tasks: plan.tasks.map((t) => ({
      title: t.title,
      kind: t.kind,
      status: t.status,
      actionType: t.actionType,
      priority: t.priority,
    })),
  });
}

async function executeGetKeywords(ctx: ToolContext): Promise<string> {
  const keywords = await prisma.keyword.findMany({
    where: { clientId: ctx.clientId },
    orderBy: [{ isPriority: "desc" }, { term: "asc" }],
    take: 30,
    select: {
      term: true,
      isPriority: true,
      category: true,
      targetUrl: true,
      rankings: {
        orderBy: { checkedAt: "desc" },
        take: 1,
        select: { position: true, checkedAt: true },
      },
    },
  });

  if (keywords.length === 0) {
    return JSON.stringify({
      type: "keywords",
      message: "No hay keywords configuradas para este cliente.",
    });
  }

  return JSON.stringify({
    type: "keywords",
    keywords: keywords.map((k) => ({
      term: k.term,
      isPriority: k.isPriority,
      category: k.category,
      targetUrl: k.targetUrl,
      position: k.rankings[0]?.position ?? null,
      lastChecked: k.rankings[0]?.checkedAt ?? null,
    })),
  });
}

function executeProposeSummary(
  input: {
    items: Array<{
      section: string;
      change_type: string;
      description: string;
      priority?: string;
      extra_data?: Record<string, unknown>;
    }>;
    general_notes?: string;
  },
  ctx: ToolContext,
): string {
  if (!input.items || input.items.length === 0) {
    return "No hay items en el resumen.";
  }

  const version = (ctx.pendingSummary?.version ?? 0) + 1;
  ctx.pendingSummary = {
    items: input.items.map((item) => ({
      section: item.section,
      change_type: item.change_type,
      description: item.description,
      priority: item.priority ?? "normal",
      extra_data: item.extra_data,
    })),
    general_notes: input.general_notes,
    version,
  };

  return JSON.stringify({
    type: "change_summary",
    version,
    items: ctx.pendingSummary.items,
    general_notes: ctx.pendingSummary.general_notes,
    message: "Resumen generado. Espera confirmacion del usuario.",
  });
}

async function executeSubmit(
  input: { confirmed: boolean },
  ctx: ToolContext,
): Promise<string> {
  if (!input.confirmed) {
    return "No se puede enviar sin confirmacion.";
  }
  if (!ctx.pendingSummary) {
    return "No hay resumen pendiente. Llama propose_change_summary primero.";
  }

  const constructorUrl = process.env.CONSTRUCTOR_URL;
  const constructorSecret = process.env.CONSTRUCTOR_INTERNAL_SECRET;

  if (!constructorUrl || !constructorSecret) {
    return "Constructor no esta configurado. Configura CONSTRUCTOR_URL y CONSTRUCTOR_INTERNAL_SECRET.";
  }

  try {
    const res = await fetch(
      `${constructorUrl}/api/internal/change-requests`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${constructorSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          notion_client_id: ctx.notionClientId,
          items: ctx.pendingSummary.items.map((item) => ({
            section: item.section,
            change_type: item.change_type,
            description: item.description,
            priority: item.priority ?? "normal",
            extra_data: item.extra_data,
          })),
          general_notes: ctx.pendingSummary.general_notes,
          submitted_by: "Cerebro SEO",
          idempotency_key: `cerebro:${ctx.conversationId}:v${ctx.pendingSummary.version}`,
        }),
      },
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      return `Error creando solicitud en Constructor: ${(err as { error?: string }).error ?? res.status}`;
    }

    const data = (await res.json()) as {
      id: string;
      request_code: string;
    };

    // Update conversation with CR info
    await prisma.agentConversation.update({
      where: { id: ctx.conversationId },
      data: {
        constructorCrId: data.id,
        constructorCrCode: data.request_code,
        status: "SUBMITTED",
      },
    });

    return JSON.stringify({
      type: "change_request_created",
      id: data.id,
      request_code: data.request_code,
      status: "submitted",
      message: `Solicitud ${data.request_code} creada. El equipo la procesara automaticamente.`,
    });
  } catch (err) {
    return `Error de conexion con Constructor: ${err instanceof Error ? err.message : "desconocido"}`;
  }
}

async function executeGetStatus(input: {
  request_code: string;
}): Promise<string> {
  const constructorUrl = process.env.CONSTRUCTOR_URL;
  const constructorSecret = process.env.CONSTRUCTOR_INTERNAL_SECRET;

  if (!constructorUrl || !constructorSecret) {
    return "Constructor no esta configurado.";
  }

  try {
    const res = await fetch(
      `${constructorUrl}/api/internal/change-requests/${encodeURIComponent(input.request_code)}`,
      {
        headers: { Authorization: `Bearer ${constructorSecret}` },
      },
    );

    if (!res.ok) {
      return `No se encontro la solicitud ${input.request_code} (HTTP ${res.status}).`;
    }

    const data = (await res.json()) as {
      request: { status: string; request_code: string };
    };
    return JSON.stringify({
      type: "request_status",
      request_code: data.request.request_code,
      status: data.request.status,
    });
  } catch (err) {
    return `Error consultando Constructor: ${err instanceof Error ? err.message : "desconocido"}`;
  }
}
