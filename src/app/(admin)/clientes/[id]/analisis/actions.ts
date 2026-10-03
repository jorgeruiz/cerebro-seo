"use server";

import { getSession } from "@/lib/auth";
import { generateClientAnalysis, type AnalysisResult } from "@/lib/claude-analysis";
import { prisma } from "@/lib/db";

export interface AnalysisRecord {
  id: string;
  analysis: AnalysisResult;
  model: string;
  cost: number;
  triggeredBy: string | null;
  createdAt: Date;
}

export async function actionGenerateAnalysis(
  clientId: string
): Promise<{ ok: true; record: AnalysisRecord } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session?.user) {
    return { ok: false, error: "No autenticado" };
  }

  try {
    const { analysis, analysisId } = await generateClientAnalysis(
      clientId,
      session.user.email ?? undefined
    );

    const record = await prisma.clientAnalysis.findUniqueOrThrow({
      where: { id: analysisId },
    });

    return {
      ok: true,
      record: {
        id: record.id,
        analysis,
        model: record.model,
        cost: Number(record.cost),
        triggeredBy: record.triggeredBy,
        createdAt: record.createdAt,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[analysis] Error generando análisis:", err);
    return { ok: false, error: msg };
  }
}

export async function getAnalysisHistory(clientId: string): Promise<AnalysisRecord[]> {
  const records = await prisma.clientAnalysis.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return records.map((r) => ({
    id: r.id,
    analysis: JSON.parse(r.content) as AnalysisResult,
    model: r.model,
    cost: Number(r.cost),
    triggeredBy: r.triggeredBy,
    createdAt: r.createdAt,
  }));
}
