/**
 * Logs plan completion to Notion Bitácora via Cerebro web.
 *
 * Cerebro SEO never writes to Notion directly — all writes go through
 * Cerebro web's POST /api/internal/bitacora endpoint.
 *
 * Called fire-and-forget after a plan is PUBLISHED or a blog is published.
 * Failures are logged but never block the publish flow.
 */

import { prisma } from "@/lib/db";

// ─── Types ──────────────────────────────────────────────────────────────────

interface BitacoraEntry {
  clienteId: string;       // Notion page UUID (with dashes)
  clienteNombre: string;
  actividad: string;
  area: string;
  encargadoNombre?: string;
  fecha?: string;          // YYYY-MM-DD
  campanaOPagina?: string;
  resultadoObtenido?: string;
  impacto?: string;        // "Alto" | "Medio" | "Bajo"
}

// ─── Core: send to Cerebro web ──────────────────────────────────────────────

function cerebroBaseUrl(): string {
  return process.env.CEREBRO_API_URL ?? "http://localhost:3001";
}

function cerebroAuth(): HeadersInit {
  const secret = process.env.CEREBRO_INTERNAL_SECRET;
  if (!secret) return {};
  return { Authorization: `Bearer ${secret}` };
}

/**
 * Sends a single bitácora entry to Cerebro web.
 * Returns true on success, false on failure (never throws).
 */
export async function sendBitacoraEntry(entry: BitacoraEntry): Promise<boolean> {
  try {
    const res = await fetch(`${cerebroBaseUrl()}/api/internal/bitacora`, {
      method: "POST",
      headers: {
        ...cerebroAuth(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(entry),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[bitacora] POST failed (${res.status}): ${text.slice(0, 200)}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`[bitacora] Error: ${(err as Error).message}`);
    return false;
  }
}

// ─── Format Notion UUID ─────────────────────────────────────────────────────

/** Converts a 32-char cerebroClientId to UUID with dashes */
function toNotionUuid(id: string): string {
  if (id.includes("-")) return id;
  // 8-4-4-4-12
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

// ─── Plan Published → Bitácora ──────────────────────────────────────────────

/**
 * Logs all completed tasks from a published plan to Notion Bitácora.
 * One entry per DONE task. Fire-and-forget — never blocks.
 */
export async function logPlanToBitacora(
  planId: string,
  mergedByEmail: string,
): Promise<void> {
  try {
    const plan = await prisma.monthlyPlan.findUnique({
      where: { id: planId },
      include: {
        client: { select: { name: true, cerebroClientId: true } },
        tasks: {
          where: { status: "DONE" },
          orderBy: { order: "asc" },
          select: {
            title: true,
            kind: true,
            category: true,
            resultUrls: true,
            runs: {
              where: { status: "SUCCEEDED" },
              orderBy: { finishedAt: "desc" },
              take: 1,
              select: { changedRoutes: true, costUsd: true },
            },
          },
        },
      },
    });

    if (!plan || !plan.client.cerebroClientId) {
      console.warn(`[bitacora] Plan ${planId}: no client or cerebroClientId — skipping`);
      return;
    }

    const clienteId = toNotionUuid(plan.client.cerebroClientId);
    const clienteNombre = plan.client.name;
    const fecha = new Date().toISOString().slice(0, 10);

    // Map task kind to Bitácora "Área"
    const areaMap: Record<string, string> = {
      CONTENT: "Contenido",
      CODE: "SEO",
      SETUP: "SEO",
    };

    let successCount = 0;

    for (const task of plan.tasks) {
      const routes = task.runs.flatMap((r) => r.changedRoutes);
      const urls = task.resultUrls;

      const resultado = urls.length > 0
        ? urls.join(", ")
        : routes.length > 0
          ? `Rutas: ${routes.join(", ")}`
          : "Completado";

      const impacto = task.kind === "CONTENT" ? "Alto" : "Medio";

      const ok = await sendBitacoraEntry({
        clienteId,
        clienteNombre,
        actividad: `Plan ${plan.month}: ${task.title}`,
        area: areaMap[task.kind] ?? "SEO",
        encargadoNombre: mergedByEmail.split("@")[0] ?? "Cerebro SEO",
        fecha,
        campanaOPagina: routes[0] ?? urls[0] ?? undefined,
        resultadoObtenido: resultado,
        impacto,
      });

      if (ok) successCount++;
    }

    console.log(`[bitacora] Plan ${plan.month}: ${successCount}/${plan.tasks.length} tareas registradas en Bitácora`);
  } catch (err) {
    console.error(`[bitacora] logPlanToBitacora failed: ${(err as Error).message}`);
  }
}

// ─── Blog Published → Bitácora ──────────────────────────────────────────────

/**
 * Logs a single blog article publication to Bitácora.
 */
export async function logBlogToBitacora(
  clientId: string,
  articleTitle: string,
  articleUrl: string,
  publishedByEmail: string,
): Promise<void> {
  try {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { name: true, cerebroClientId: true },
    });

    if (!client?.cerebroClientId) {
      console.warn(`[bitacora] Client ${clientId}: no cerebroClientId — skipping`);
      return;
    }

    await sendBitacoraEntry({
      clienteId: toNotionUuid(client.cerebroClientId),
      clienteNombre: client.name,
      actividad: `Blog publicado: ${articleTitle}`,
      area: "Contenido",
      encargadoNombre: publishedByEmail.split("@")[0] ?? "Cerebro SEO",
      fecha: new Date().toISOString().slice(0, 10),
      campanaOPagina: articleUrl,
      resultadoObtenido: `Artículo en ${articleUrl}`,
      impacto: "Alto",
    });
  } catch (err) {
    console.error(`[bitacora] logBlogToBitacora failed: ${(err as Error).message}`);
  }
}

// ─── Estrategia Mensual → Notion ────────────────────────────────────────────

interface EstrategiaEntry {
  clienteId: string;
  clienteNombre: string;
  mes: string;           // YYYY-MM
  objetivos: string;
  plan: string;
  servicio?: string;
  estado?: string;
}

/**
 * Sends estrategia mensual to Cerebro web.
 * Returns { id, url, wasUpdate } on success, null on failure.
 */
export async function sendEstrategia(entry: EstrategiaEntry): Promise<{ id: string; url: string; wasUpdate: boolean } | null> {
  try {
    const res = await fetch(`${cerebroBaseUrl()}/api/internal/estrategia`, {
      method: "POST",
      headers: {
        ...cerebroAuth(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(entry),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[estrategia] POST failed (${res.status}): ${text.slice(0, 200)}`);
      return null;
    }

    const data = (await res.json()) as { ok: boolean; data?: { id: string; url: string; wasUpdate: boolean } };
    return data.data ?? null;
  } catch (err) {
    console.error(`[estrategia] Error: ${(err as Error).message}`);
    return null;
  }
}

// ─── Upload Plan to Notion (Bitácora + Estrategia) ──────────────────────────

export interface NotionUploadResult {
  bitacoraCount: number;
  bitacoraTotal: number;
  estrategia: { id: string; url: string; wasUpdate: boolean } | null;
  errors: string[];
}

/**
 * Uploads a completed plan to Notion:
 * 1. One Bitácora entry per DONE task
 * 2. One Estrategia Mensual with objectives + plan summary
 */
export async function uploadPlanToNotion(
  planId: string,
  uploadedByEmail: string,
): Promise<NotionUploadResult> {
  const errors: string[] = [];

  const plan = await prisma.monthlyPlan.findUnique({
    where: { id: planId },
    include: {
      client: { select: { name: true, cerebroClientId: true } },
      tasks: {
        where: { status: "DONE" },
        orderBy: { order: "asc" },
        select: {
          title: true,
          kind: true,
          category: true,
          objective: true,
          resultUrls: true,
          runs: {
            where: { status: "SUCCEEDED" },
            orderBy: { finishedAt: "desc" },
            take: 1,
            select: { changedRoutes: true, costUsd: true },
          },
        },
      },
    },
  });

  if (!plan || !plan.client.cerebroClientId) {
    return { bitacoraCount: 0, bitacoraTotal: 0, estrategia: null, errors: ["Plan o cerebroClientId no encontrado"] };
  }

  const clienteId = toNotionUuid(plan.client.cerebroClientId);
  const clienteNombre = plan.client.name;
  const fecha = new Date().toISOString().slice(0, 10);

  const areaMap: Record<string, string> = {
    CONTENT: "Contenido",
    CODE: "SEO",
    SETUP: "SEO",
  };

  // ── 1. Bitácora: one entry per task ────────────────────────────────────
  let bitacoraCount = 0;
  for (const task of plan.tasks) {
    const routes = task.runs.flatMap((r) => r.changedRoutes);
    const urls = task.resultUrls;
    const resultado = urls.length > 0
      ? urls.join(", ")
      : routes.length > 0
        ? `Rutas: ${routes.join(", ")}`
        : "Completado";

    const ok = await sendBitacoraEntry({
      clienteId,
      clienteNombre,
      actividad: `Plan ${plan.month}: ${task.title}`,
      area: areaMap[task.kind] ?? "SEO",
      encargadoNombre: uploadedByEmail.split("@")[0] ?? "Cerebro SEO",
      fecha,
      campanaOPagina: routes[0] ?? urls[0] ?? undefined,
      resultadoObtenido: resultado,
      impacto: task.kind === "CONTENT" ? "Alto" : "Medio",
    });
    if (ok) bitacoraCount++;
  }

  // ── 2. Estrategia Mensual ──────────────────────────────────────────────
  // Build objectives and plan from tasks
  const objetivos = plan.tasks
    .map((t, i) => `${i + 1}. ${t.title}`)
    .join("\n");

  const planSummary = plan.tasks
    .map((t) => {
      const urls = t.resultUrls;
      const routes = t.runs.flatMap((r) => r.changedRoutes);
      const result = urls.length > 0 ? urls.join(", ") : routes.length > 0 ? routes.join(", ") : "—";
      return `• ${t.title}\n  Categoría: ${t.category} | Resultado: ${result}`;
    })
    .join("\n\n");

  const estrategia = await sendEstrategia({
    clienteId,
    clienteNombre,
    mes: plan.month,
    objetivos: `Objetivos del plan ${plan.month}:\n\n${objetivos}`,
    plan: `Trabajo realizado:\n\n${planSummary}`,
    servicio: "SEO",
    estado: "Borrador",
  });

  if (!estrategia) {
    errors.push("No se pudo crear/actualizar la Estrategia Mensual en Notion");
  }

  console.log(
    `[notion-upload] Plan ${plan.month}: ${bitacoraCount}/${plan.tasks.length} bitácora, ` +
    `estrategia: ${estrategia ? (estrategia.wasUpdate ? "actualizada" : "creada") : "FALLÓ"}`
  );

  return {
    bitacoraCount,
    bitacoraTotal: plan.tasks.length,
    estrategia,
    errors,
  };
}
