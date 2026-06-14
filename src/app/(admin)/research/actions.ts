"use server";

import { getSession } from "@/lib/auth";
import { dataForSeoProvider } from "@/server/providers/dataforseo";
import {
  classifyAeoResearchEphemeral,
  type AeoResearchResult,
} from "@/lib/aeo-classify";
import type {
  KeywordIdea,
  QuestionKeyword,
  DomainRankOverview,
} from "@/server/providers/dataforseo";

// ─── Tipos de resultado ────────────────────────────────────────────────────

export interface KeywordResearchResult {
  seeds: string[];
  ideas: KeywordIdea[];
  questionCount: number;
  aeo: AeoResearchResult;
  cost: number;
}

export interface DomainResearchResult {
  domain: string;
  overview: DomainRankOverview;
}

// ─── Mapeos country/language ───────────────────────────────────────────────

const LOCATION_NAME: Record<string, string> = {
  MX: "Mexico",
  US: "United States",
  ES: "Spain",
  AR: "Argentina",
  CO: "Colombia",
};

const LANGUAGE_NAME: Record<string, string> = {
  es: "Spanish",
  en: "English",
};

// ─── actionResearchKeywords ────────────────────────────────────────────────

export async function actionResearchKeywords({
  seeds,
  country,
  language,
}: {
  seeds: string[];
  country: string;
  language: string;
}): Promise<
  { ok: true; data: KeywordResearchResult } | { ok: false; error: string }
> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores pueden ejecutar research." };
  }

  const cleanSeeds = seeds
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);

  if (cleanSeeds.length === 0) {
    return { ok: false, error: "Ingresa al menos una keyword seed." };
  }

  try {
    const locationName = LOCATION_NAME[country] ?? "Mexico";
    const languageName = LANGUAGE_NAME[language] ?? "Spanish";

    // 1. Keyword ideas — DataForSEO Labs (cache 7d, clientId: null)
    const ideas = await dataForSeoProvider
      .getKeywordIdeas(cleanSeeds, {
        limit: 100,
        locationName,
        languageName,
      })
      .catch(() => [] as KeywordIdea[]);

    // 2. Question keywords filtradas (cache 7d)
    const labsQuestions = await dataForSeoProvider
      .getQuestionKeywords(cleanSeeds, { limit: 80, locationName, languageName })
      .catch(() => [] as QuestionKeyword[]);

    // 3. PAA de SERP por seed en paralelo (cache 7d, ~$0.002/req × seed)
    const paaResults = await Promise.allSettled(
      cleanSeeds.map((seed) =>
        dataForSeoProvider.getSerpQuestions(seed, country, language)
      )
    );
    const paaQuestions = paaResults
      .filter(
        (r): r is PromiseFulfilledResult<QuestionKeyword[]> =>
          r.status === "fulfilled"
      )
      .flatMap((r) => r.value);

    // Deduplicar questions
    const seen = new Set<string>();
    const allQuestions = [...labsQuestions, ...paaQuestions].filter((q) => {
      const key = q.keyword.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 4. Clasificación AEO/GEO con Claude (efímera — sin persistir en BD)
    let aeo: AeoResearchResult = {
      resumen: "",
      clusters: [],
      notaEstrategica: "",
    };
    let cost = 0;

    if (allQuestions.length > 0) {
      const classified = await classifyAeoResearchEphemeral(
        allQuestions,
        {
          name: "Research General",
          domain: cleanSeeds.slice(0, 3).join(" / "),
        },
        cleanSeeds
      );
      aeo = classified.result;
      cost = classified.cost;
    }

    return {
      ok: true,
      data: {
        seeds: cleanSeeds,
        ideas,
        questionCount: allQuestions.length,
        aeo,
        cost,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[research/keywords] Error:", err);
    return { ok: false, error: msg };
  }
}

// ─── actionResearchDomain ──────────────────────────────────────────────────

export async function actionResearchDomain({
  domain,
}: {
  domain: string;
}): Promise<
  { ok: true; data: DomainResearchResult } | { ok: false; error: string }
> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores pueden ejecutar research." };
  }

  const cleanDomain = domain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");

  if (!cleanDomain || !cleanDomain.includes(".")) {
    return { ok: false, error: "Ingresa un dominio válido (ej: ejemplo.com)." };
  }

  try {
    // getDomainRankOverview ya tiene cache 7d y loggea ApiUsage con clientId: undefined
    const overview = await dataForSeoProvider.getDomainRankOverview(cleanDomain);
    return { ok: true, data: { domain: cleanDomain, overview } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[research/domain] Error:", err);
    return { ok: false, error: msg };
  }
}
