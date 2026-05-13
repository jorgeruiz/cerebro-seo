"use server";

import { google } from "googleapis";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getOAuth2Client } from "@/lib/google-oauth";
import { prisma } from "@/lib/db";
import { GoogleSearchConsoleProvider } from "@/server/providers/google-search-console";

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

export type GscRange = "28d" | "90d" | "12m";

export interface GscSnapshot {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  // Deltas vs período anterior (absoluto para clics/imps, puntos para posición/ctr)
  clicksDelta: number;
  impressionsDelta: number;
  ctrDelta: number;
  positionDelta: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysBack(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().split("T")[0];
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

// ── Actions ──────────────────────────────────────────────────────────────────

/**
 * Lista todas las propiedades de GSC accesibles por el usuario actual.
 * Devuelve [] si no hay OAuth token o si el scope webmasters no fue otorgado.
 */
export async function listGscSites(): Promise<GscSite[]> {
  const session = await getSession();
  if (!session?.user?.id) return [];

  const oauth = await getOAuth2Client(session.user.id);
  if (!oauth) return [];

  try {
    const wmt = google.webmasters({ version: "v3", auth: oauth });
    const { data } = await wmt.sites.list();
    return (data.siteEntry ?? []).map((s) => ({
      siteUrl: s.siteUrl ?? "",
      permissionLevel: s.permissionLevel ?? "siteUnverifiedUser",
    }));
  } catch {
    // Sin scope webmasters o sin sitios — devolver vacío
    return [];
  }
}

/**
 * Persiste la propiedad GSC elegida en el Site del cliente.
 * Requiere sesión activa.
 */
export async function setClientGscProperty(
  clientId: string,
  siteUrl: string
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.user?.id) return { ok: false, error: "No autenticado" };

  const parsed = z.string().min(1).safeParse(siteUrl);
  if (!parsed.success) return { ok: false, error: "URL de propiedad inválida" };

  const site = await prisma.site.findFirst({ where: { clientId } });
  if (!site) return { ok: false, error: "Cliente sin sitio configurado" };

  await prisma.site.update({
    where: { id: site.id },
    data: { gscProperty: siteUrl },
  });

  return { ok: true };
}

/**
 * Devuelve el snapshot de 28d con comparativa vs los 28d anteriores.
 * Utiliza el provider de GSC con caché 24h.
 */
export async function getGscSnapshot(
  clientId: string
): Promise<GscSnapshot | null> {
  const session = await getSession();
  if (!session?.user?.id) return null;

  const site = await prisma.site.findFirst({ where: { clientId } });
  if (!site?.gscProperty) return null;

  const oauth = await getOAuth2Client(session.user.id);
  if (!oauth) return null;

  const gsc = new GoogleSearchConsoleProvider(oauth);

  // Período actual: últimos 28 días
  const endCurrent = today();
  const startCurrent = daysBack(28);

  // Período anterior: 28 días antes del actual
  const endPrev = daysBack(29);
  const startPrev = daysBack(57);

  const [current, prev] = await Promise.all([
    gsc.getOverview(site.gscProperty, startCurrent, endCurrent),
    gsc.getOverview(site.gscProperty, startPrev, endPrev),
  ]);

  return {
    clicks: current.totalClicks,
    impressions: current.totalImpressions,
    ctr: current.avgCtr,
    position: current.avgPosition,
    clicksDelta: current.totalClicks - prev.totalClicks,
    impressionsDelta: current.totalImpressions - prev.totalImpressions,
    ctrDelta: parseFloat((current.avgCtr - prev.avgCtr).toFixed(2)),
    positionDelta: parseFloat((current.avgPosition - prev.avgPosition).toFixed(1)),
  };
}
