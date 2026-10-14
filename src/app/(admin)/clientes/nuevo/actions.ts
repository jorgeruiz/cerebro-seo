"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export interface WizardClient {
  id: string;
  name: string;
  domain: string;
  services: string[];
  cerebroClientId: string | null;
  gscProperty: string | null;
  ga4Property: string | null;
  keywordsCount: number;
  competitorsCount: number;
}

/** Lista todos los clientes activos para el picker del wizard. */
export async function listClientsForWizard(): Promise<WizardClient[]> {
  const session = await getSession();
  if (!session?.user) return [];

  const clients = await prisma.client.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      domain: true,
      services: true,
      cerebroClientId: true,
      sites: {
        take: 1,
        select: { gscProperty: true, ga4Property: true },
      },
      _count: {
        select: {
          keywords: { where: { deletedAt: null } },
          competitors: { where: { deletedAt: null } },
        },
      },
    },
  });

  return clients.map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain,
    services: c.services,
    cerebroClientId: c.cerebroClientId,
    gscProperty: c.sites[0]?.gscProperty ?? null,
    ga4Property: c.sites[0]?.ga4Property ?? null,
    keywordsCount: c._count.keywords,
    competitorsCount: c._count.competitors,
  }));
}

export interface ConfigureClientInput {
  clientId: string;
  gscProperty: string;
  ga4Property: string;
  keywords: string;   // separadas por coma
  competitors: string; // separadas por coma
}

/** Configura GSC/GA4/keywords/competidores en un cliente existente. */
export async function configureClientSeo(
  input: ConfigureClientInput
): Promise<{ ok?: true; clientId?: string; error?: string }> {
  const session = await getSession();
  if (!session?.user || session.user.role !== "ADMIN") {
    return { error: "Solo ADMIN puede configurar clientes" };
  }

  const { clientId, gscProperty, ga4Property, keywords, competitors } = input;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: { sites: { take: 1 } },
  });
  if (!client) return { error: "Cliente no encontrado" };

  const site = client.sites[0];
  if (!site) return { error: "El cliente no tiene sitio configurado" };

  // Actualizar GSC y GA4
  await prisma.site.update({
    where: { id: site.id },
    data: {
      gscProperty: gscProperty || null,
      ga4Property: ga4Property || null,
    },
  });

  // Agregar keywords nuevas (ignorar duplicadas)
  const keywordTerms = keywords
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 50);

  for (let i = 0; i < keywordTerms.length; i++) {
    const term = keywordTerms[i];
    const exists = await prisma.keyword.findFirst({
      where: { clientId, term, deletedAt: null },
    });
    if (!exists) {
      await prisma.keyword.create({
        data: { clientId, term, isPriority: i < 10 },
      });
    }
  }

  // Agregar competidores nuevos (ignorar duplicados)
  const competitorDomains = competitors
    .split(",")
    .map((c) => c.trim().replace(/^https?:\/\//, "").replace(/\/$/, ""))
    .filter(Boolean)
    .slice(0, 5);

  const existingCount = await prisma.competitor.count({
    where: { clientId, deletedAt: null },
  });

  for (const domain of competitorDomains) {
    if (existingCount >= 5) break;
    const exists = await prisma.competitor.findFirst({
      where: { clientId, domain, deletedAt: null },
    });
    if (!exists) {
      await prisma.competitor.create({ data: { clientId, domain } });
    }
  }

  revalidatePath(`/clientes/${clientId}`);
  revalidatePath(`/clientes/${clientId}/configuracion`);

  return { ok: true, clientId };
}
