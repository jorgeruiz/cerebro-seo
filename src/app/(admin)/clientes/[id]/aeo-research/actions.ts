"use server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { dataForSeoProvider } from "@/server/providers/dataforseo";
import { classifyAeoResearchForClient, type AeoResearchResult } from "@/lib/aeo-classify";

export interface AeoResearchRecord {
  id: string;
  seeds: string[];
  result: AeoResearchResult;
  model: string;
  cost: number;
  questionCount: number;
  triggeredBy: string | null;
  createdAt: Date;
}

export async function actionGenerateAeoResearch(
  clientId: string
): Promise<{ ok: true; record: AeoResearchRecord } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores pueden generar análisis AEO/GEO." };
  }

  try {
    // Seeds: keywords de prioridad del cliente (máx 5)
    const keywords = await prisma.keyword.findMany({
      where: { clientId, isPriority: true, deletedAt: null },
      select: { term: true },
      take: 5,
    });

    if (keywords.length === 0) {
      return {
        ok: false,
        error: "El cliente no tiene keywords marcadas como prioridad. Agrega al menos una en la sección de Keywords.",
      };
    }

    const seeds = keywords.map((k) => k.term);

    // 1. Question keywords de DataForSEO Labs (cache 7d)
    const labsQuestions = await dataForSeoProvider.getQuestionKeywords(
      seeds,
      { limit: 100 },
      clientId
    );

    // 2. PAA de SERP para cada seed en paralelo (cache 7d, $0.002/req)
    const client = await prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { keywords: { where: { isPriority: true, deletedAt: null }, take: 1, select: { country: true, language: true } } },
    });
    const country = client.keywords[0]?.country ?? "MX";
    const language = client.keywords[0]?.language ?? "es";

    const paaResults = await Promise.allSettled(
      seeds.map((seed) =>
        dataForSeoProvider.getSerpQuestions(seed, country, language, clientId)
      )
    );
    const paaQuestions = paaResults
      .filter((r): r is PromiseFulfilledResult<typeof labsQuestions> => r.status === "fulfilled")
      .flatMap((r) => r.value);

    // Deduplicar combinando labs + PAA
    const seen = new Set<string>();
    const allQuestions = [...labsQuestions, ...paaQuestions].filter((q) => {
      const key = q.keyword.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (allQuestions.length === 0) {
      return {
        ok: false,
        error: "No se encontraron preguntas para las seeds configuradas. Prueba con seeds más genéricas.",
      };
    }

    // 3. Clasificar con Claude
    const { result, researchId } = await classifyAeoResearchForClient(
      clientId,
      allQuestions,
      seeds,
      session.user.email ?? undefined
    );

    const record = await prisma.aeoResearch.findUniqueOrThrow({ where: { id: researchId } });

    return {
      ok: true,
      record: {
        id: record.id,
        seeds: record.seeds,
        result,
        model: record.model,
        cost: Number(record.cost),
        questionCount: record.questionCount,
        triggeredBy: record.triggeredBy,
        createdAt: record.createdAt,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[aeo-research] Error generando análisis:", err);
    return { ok: false, error: msg };
  }
}

export async function getAeoResearchHistory(clientId: string): Promise<AeoResearchRecord[]> {
  const records = await prisma.aeoResearch.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return records.map((r) => ({
    id: r.id,
    seeds: r.seeds,
    result: r.clusters as unknown as AeoResearchResult,
    model: r.model,
    cost: Number(r.cost),
    questionCount: r.questionCount,
    triggeredBy: r.triggeredBy,
    createdAt: r.createdAt,
  }));
}
