/**
 * Claim Checker — validates agent-generated content for unsupported claims.
 *
 * 1. Agent declares claims[] with source in its output.
 * 2. Deterministic validator scans for risk terms not in claims[].
 * 3. Unsourced claims → ClaimCheck PENDING → Notion task for Félix.
 */

import { prisma } from "@/lib/db";
import type { ClientContext } from "./client-context";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentClaim {
  text: string;
  source: "context" | "page" | "none";
  field?: string; // e.g. "verifiedServices", "confirmedClaims"
}

export interface ClaimCheckResult {
  claims: AgentClaim[];
  unsourced: AgentClaim[];
  hasUnsourced: boolean;
}

// ─── Risk terms ─────────────────────────────────────────────────────────────

const RISK_PATTERNS = [
  // Services / products
  /\b(venta|alquiler|renta|servicio de|instalación de|mantenimiento de|reparación de)\s+\w+/gi,
  // Locations / zones
  /\b(en toda la república\w*|a nivel nacional|zona metropolitana|cobertura en\s+\w+)/gi,
  // Times / guarantees
  /\b(entrega en \d+\s*\w*|disponibilidad inmediata|garantía de\s+\w+|tiempo de respuesta\s*\w*)/gi,
  // Certifications / numbers
  /\b(certificad[oa]s?|ISO \d|NOM-\d|\d+ años de experiencia|\d+ clientes)\b/gi,
  // People / roles
  /\b(con operador|con técnico|equipo de \d+|personal capacitado)\b/gi,
  // Prices
  /\$[\d,.]+|precio[s]?\s+(desde|a partir)/gi,
];

/**
 * Extract claims from generated text and validate against client context.
 */
export function extractAndValidateClaims(
  generatedText: string,
  agentClaims: AgentClaim[],
  ctx: ClientContext,
): ClaimCheckResult {
  const claims: AgentClaim[] = [...agentClaims];
  const knownFacts = buildKnownFacts(ctx);

  // Scan generated text for risk terms not declared by the agent
  for (const pattern of RISK_PATTERNS) {
    const matches = generatedText.matchAll(pattern);
    for (const match of Array.from(matches)) {
      const text = match[0].trim();
      if (!text) continue;

      // Already declared by agent?
      if (agentClaims.some((c) => generatedText.includes(c.text) && c.text.includes(text))) continue;

      // Known fact from context? Check substring + significant word overlap
      const textLower = text.toLowerCase();
      const isKnown = knownFacts.some((f) => {
        const fLower = f.toLowerCase();
        // Substring match (either direction)
        if (fLower.includes(textLower) || textLower.includes(fLower)) return true;
        // Word overlap: ≥2 significant words from the fact appear in the text
        const fWords = fLower.split(/\s+/).filter((w) => w.length > 3);
        const overlap = fWords.filter((w) => textLower.includes(w)).length;
        return overlap >= 1 && overlap >= Math.ceil(fWords.length / 2);
      });
      if (isKnown) {
        claims.push({ text, source: "context", field: "auto-detected" });
        continue;
      }

      // Not in context → unsourced
      if (!claims.some((c) => c.text === text)) {
        claims.push({ text, source: "none" });
      }
    }
  }

  const unsourced = claims.filter((c) => c.source === "none");
  return { claims, unsourced, hasUnsourced: unsourced.length > 0 };
}

function buildKnownFacts(ctx: ClientContext): string[] {
  const facts: string[] = [];
  facts.push(...ctx.verifiedServices);
  facts.push(...ctx.confirmedClaims.map((c) => c.claim));
  if (ctx.identity) facts.push(ctx.identity);
  if (ctx.learnings) facts.push(ctx.learnings);
  return facts;
}

// ─── Persist claims + create Notion task ────────────────────────────────────

/**
 * Save unsourced claims to DB and create a grouped Notion task for Félix.
 */
export async function persistUnsourcedClaims(
  clientId: string,
  taskId: string,
  url: string | null,
  taskTitle: string,
  unsourced: AgentClaim[],
): Promise<{ claimIds: string[]; notionTaskUrl: string | null }> {
  if (unsourced.length === 0) return { claimIds: [], notionTaskUrl: null };

  // Create ClaimCheck records
  const claimIds: string[] = [];
  for (const claim of unsourced) {
    const record = await prisma.claimCheck.create({
      data: {
        clientId,
        taskId,
        url,
        claim: claim.text,
        source: claim.source,
        status: "PENDING",
      },
    });
    claimIds.push(record.id);
  }

  // Create Notion task via cerebro-web bridge
  let notionTaskUrl: string | null = null;
  try {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { name: true, cerebroClientId: true },
    });

    if (client) {
      const claimList = unsourced.map((c) => `- "${c.text}"`).join("\n");
      const body = [
        `Se publicó contenido para ${url ?? taskTitle} con afirmaciones sin confirmar:`,
        "",
        claimList,
        "",
        "Acción: confirmar con el cliente si cada afirmación es verdadera.",
        "Si alguna es falsa, marcarla como negada y se generará una corrección.",
      ].join("\n");

      const result = await createNotionTask({
        clienteNombre: client.name,
        clienteId: client.cerebroClientId ?? undefined,
        tarea: `Confirmar con cliente: ${client.name} — ${url ?? taskTitle}`,
        responsable: "Félix",
        comentarios: body,
        servicio: ["seo"],
        tipo: "Verificación",
      });

      if (result) {
        notionTaskUrl = result.url;
        // Update all claims with the Notion task reference
        await prisma.claimCheck.updateMany({
          where: { id: { in: claimIds } },
          data: { notionTaskId: result.id, notionTaskUrl: result.url },
        });
      }
    }
  } catch (err) {
    console.warn(`[claim-checker] Error creating Notion task: ${(err as Error).message}`);
  }

  return { claimIds, notionTaskUrl };
}

// ─── Bridge: create task in Notion ──────────────────────────────────────────

async function createNotionTask(params: {
  clienteNombre: string;
  clienteId?: string;
  tarea: string;
  responsable: string;
  comentarios: string;
  servicio: string[];
  tipo: string;
}): Promise<{ id: string; url: string } | null> {
  const baseUrl = process.env.CEREBRO_API_URL;
  const secret = process.env.SEO_INTERNAL_SECRET ?? process.env.CEREBRO_INTERNAL_SECRET;
  if (!baseUrl || !secret) return null;

  // Calculate due date: 3 business days from now
  const due = new Date();
  let added = 0;
  while (added < 3) {
    due.setDate(due.getDate() + 1);
    if (due.getDay() !== 0 && due.getDay() !== 6) added++;
  }

  const res = await fetch(`${baseUrl}/api/internal/tareas`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      ...params,
      fecha: due.toISOString().slice(0, 10),
      status: "Por hacer",
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) return null;
  const data = await res.json() as { ok: boolean; data?: { id: string; url: string } };
  return data.ok ? (data.data ?? null) : null;
}
