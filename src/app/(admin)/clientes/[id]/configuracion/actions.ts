"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

const SUPPORTED_COUNTRIES = ["MX", "US", "ES", "CO", "AR"] as const;
const SUPPORTED_LANGUAGES = ["es", "en"] as const;
type Country = typeof SUPPORTED_COUNTRIES[number];
type Language = typeof SUPPORTED_LANGUAGES[number];

// ─── Keywords ─────────────────────────────────────────────────────────────────

export async function actionCreateKeyword(params: {
  clientId: string;
  term: string;
  country: string;
  language: string;
  isPriority: boolean;
}): Promise<{ ok?: true; error?: string }> {
  const session = await getSession();
  if (!session?.user) return { error: "No autenticado" };

  const term = params.term.trim().toLowerCase();
  if (!term || term.length > 200) return { error: "Keyword inválida (máx. 200 caracteres)" };
  if (!SUPPORTED_COUNTRIES.includes(params.country as Country)) return { error: "País no soportado" };
  if (!SUPPORTED_LANGUAGES.includes(params.language as Language)) return { error: "Idioma no soportado" };

  const existing = await prisma.keyword.findFirst({
    where: { clientId: params.clientId, term, deletedAt: null },
    select: { id: true },
  });
  if (existing) return { error: "Esta keyword ya existe" };

  if (params.isPriority) {
    const priorityCount = await prisma.keyword.count({
      where: { clientId: params.clientId, isPriority: true, deletedAt: null },
    });
    if (priorityCount >= 10) return { error: "Máximo 10 keywords priority" };
  }

  await prisma.keyword.create({
    data: {
      clientId: params.clientId,
      term,
      country: params.country,
      language: params.language,
      isPriority: params.isPriority,
    },
  });

  revalidatePath(`/clientes/${params.clientId}/configuracion`);
  return { ok: true };
}

export async function actionToggleKeywordPriority(params: {
  keywordId: string;
  clientId: string;
}): Promise<{ ok?: true; error?: string }> {
  const session = await getSession();
  if (!session?.user) return { error: "No autenticado" };

  const keyword = await prisma.keyword.findFirst({
    where: { id: params.keywordId, clientId: params.clientId, deletedAt: null },
    select: { id: true, isPriority: true },
  });
  if (!keyword) return { error: "Keyword no encontrada" };

  if (!keyword.isPriority) {
    const priorityCount = await prisma.keyword.count({
      where: { clientId: params.clientId, isPriority: true, deletedAt: null },
    });
    if (priorityCount >= 10) return { error: "Máximo 10 keywords priority. Quita una primero." };
  }

  await prisma.keyword.update({
    where: { id: params.keywordId },
    data: { isPriority: !keyword.isPriority },
  });

  revalidatePath(`/clientes/${params.clientId}/configuracion`);
  return { ok: true };
}

export async function actionDeleteKeyword(params: {
  keywordId: string;
  clientId: string;
}): Promise<{ ok?: true; error?: string }> {
  const session = await getSession();
  if (!session?.user) return { error: "No autenticado" };

  await prisma.keyword.updateMany({
    where: { id: params.keywordId, clientId: params.clientId },
    data: { deletedAt: new Date() },
  });

  revalidatePath(`/clientes/${params.clientId}/configuracion`);
  return { ok: true };
}

export async function actionBulkCreateKeywords(params: {
  clientId: string;
  terms: string[];
  country: string;
  language: string;
  isPriority: boolean;
}): Promise<{ ok?: true; count?: number; error?: string }> {
  const session = await getSession();
  if (!session?.user) return { error: "No autenticado" };

  if (!SUPPORTED_COUNTRIES.includes(params.country as Country)) return { error: "País no soportado" };
  if (!SUPPORTED_LANGUAGES.includes(params.language as Language)) return { error: "Idioma no soportado" };

  const terms = Array.from(new Set(
    params.terms
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0 && t.length <= 200),
  )).slice(0, 100);

  if (terms.length === 0) return { error: "No hay keywords válidas" };

  const existing = await prisma.keyword.findMany({
    where: { clientId: params.clientId, deletedAt: null },
    select: { term: true },
  });
  const existingTerms = new Set(existing.map((k) => k.term));
  const newTerms = terms.filter((t) => !existingTerms.has(t));

  if (newTerms.length === 0) return { error: "Todas las keywords ya existen" };

  if (params.isPriority) {
    const currentPriority = await prisma.keyword.count({
      where: { clientId: params.clientId, isPriority: true, deletedAt: null },
    });
    const available = 10 - currentPriority;
    if (available <= 0) return { error: "Límite priority alcanzado (máx. 10)" };
    if (newTerms.length > available) {
      return { error: `Solo puedes agregar ${available} más como priority. Desactiva priority o reduce el lote.` };
    }
  }

  await prisma.keyword.createMany({
    data: newTerms.map((term) => ({
      clientId: params.clientId,
      term,
      country: params.country,
      language: params.language,
      isPriority: params.isPriority,
    })),
    skipDuplicates: true,
  });

  revalidatePath(`/clientes/${params.clientId}/configuracion`);
  return { ok: true, count: newTerms.length };
}

// ─── Competitors ──────────────────────────────────────────────────────────────

export async function actionAddCompetitor(params: {
  clientId: string;
  domain: string;
}): Promise<{ ok?: true; error?: string }> {
  const session = await getSession();
  if (!session?.user) return { error: "No autenticado" };

  const domain = params.domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(domain)) {
    return { error: "Formato de dominio inválido (ej: competidor.com)" };
  }

  const count = await prisma.competitor.count({
    where: { clientId: params.clientId, deletedAt: null },
  });
  if (count >= 5) return { error: "Máximo 5 competidores. Elimina uno primero." };

  const exists = await prisma.competitor.findFirst({
    where: { clientId: params.clientId, domain, deletedAt: null },
    select: { id: true },
  });
  if (exists) return { error: "Este competidor ya existe" };

  await prisma.competitor.create({
    data: { clientId: params.clientId, domain },
  });

  revalidatePath(`/clientes/${params.clientId}/configuracion`);
  return { ok: true };
}

export async function actionDeleteCompetitor(params: {
  competitorId: string;
  clientId: string;
}): Promise<{ ok?: true; error?: string }> {
  const session = await getSession();
  if (!session?.user) return { error: "No autenticado" };

  await prisma.competitor.updateMany({
    where: { id: params.competitorId, clientId: params.clientId },
    data: { deletedAt: new Date() },
  });

  revalidatePath(`/clientes/${params.clientId}/configuracion`);
  return { ok: true };
}

// ─── Propiedades GSC / GA4 ────────────────────────────────────────────────────

export async function actionUpdateGscProperty(
  clientId: string,
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  const session = await getSession();
  if (!session?.user) return { error: "No autenticado" };

  const gscProperty = ((formData.get("gscProperty") as string) ?? "").trim();

  if (gscProperty && !/^(sc-domain:|https?:\/\/)/.test(gscProperty)) {
    return { error: "Formato inválido. Usa sc-domain:tu-dominio.com o https://tu-dominio.com/" };
  }

  await prisma.site.updateMany({
    where: { clientId },
    data: { gscProperty: gscProperty || null },
  });

  revalidatePath(`/clientes/${clientId}/configuracion`);
  revalidatePath(`/clientes/${clientId}`);
  return { ok: true };
}

export async function actionUpdateGa4Property(
  clientId: string,
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  const session = await getSession();
  if (!session?.user) return { error: "No autenticado" };

  const ga4Property = ((formData.get("ga4Property") as string) ?? "").trim();

  if (ga4Property && !/^properties\/\d+$/.test(ga4Property)) {
    return { error: "Formato inválido. Usa properties/123456789" };
  }

  await prisma.site.updateMany({
    where: { clientId },
    data: { ga4Property: ga4Property || null },
  });

  revalidatePath(`/clientes/${clientId}/configuracion`);
  revalidatePath(`/clientes/${clientId}`);
  return { ok: true };
}
