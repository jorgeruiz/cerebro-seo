"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { generateMonthlyReport } from "@/lib/monthly-report";
import type { MonthlyReportResult } from "@/lib/monthly-report";

export async function actionGenerateMonthlyReport(
  clientId: string,
  yearMonth: string
): Promise<{ ok: true; record: { id: string; content: MonthlyReportResult; createdAt: Date; yearMonth: string } } | { ok: false; error: string }> {
  try {
    const session = await getSession();
    if (session?.user?.role !== "ADMIN") {
      return { ok: false, error: "Solo administradores pueden generar reportes." };
    }

    const { report, reportId } = await generateMonthlyReport(
      clientId,
      yearMonth,
      session.user.email ?? undefined
    );

    revalidatePath(`/clientes/${clientId}/reporte`);

    return {
      ok: true,
      record: {
        id: reportId,
        content: report,
        createdAt: new Date(),
        yearMonth,
      },
    };
  } catch (err) {
    console.error("[actionGenerateMonthlyReport]", err);
    return { ok: false, error: "Error al generar el reporte. Intenta de nuevo." };
  }
}

export async function getReportHistory(clientId: string) {
  return prisma.monthlyReport.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: {
      id: true,
      yearMonth: true,
      createdAt: true,
      inputTokens: true,
      outputTokens: true,
      cost: true,
    },
  });
}

export async function getLatestReport(clientId: string, yearMonth?: string) {
  return prisma.monthlyReport.findFirst({
    where: { clientId, ...(yearMonth ? { yearMonth } : {}) },
    orderBy: { createdAt: "desc" },
    select: { id: true, yearMonth: true, content: true, createdAt: true },
  });
}
