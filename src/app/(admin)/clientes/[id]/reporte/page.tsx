export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ArrowLeft, FileText } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { getLatestReport, getReportHistory } from "./actions";
import { ReportPanel } from "./ReportPanel";
import type { MonthlyReportResult } from "@/lib/monthly-report";

export default async function ReportePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { mes?: string };
}) {
  const [session, client] = await Promise.all([
    getSession(),
    prisma.client.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, domain: true, services: true },
    }),
  ]);

  if (!client) notFound();
  if (!client.services.includes("seo")) redirect(`/clientes/${client.id}`);

  // Mes a mostrar: query param o mes actual
  const now = new Date();
  const defaultYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentYearMonth = searchParams.mes ?? defaultYearMonth;

  const [latestRecord, history] = await Promise.all([
    getLatestReport(client.id, currentYearMonth),
    getReportHistory(client.id),
  ]);

  const initialRecord = latestRecord
    ? {
        id: latestRecord.id,
        yearMonth: latestRecord.yearMonth,
        content: JSON.parse(latestRecord.content) as MonthlyReportResult,
        createdAt: latestRecord.createdAt,
      }
    : null;

  const isAdmin = session?.user?.role === "ADMIN";

  return (
    <div className="min-h-full">
      <div className="p-8 space-y-8">

        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link
              href={`/clientes/${client.id}`}
              className={buttonVariants({ variant: "outline-mono", size: "sm" }) + " gap-1.5"}
            >
              <ArrowLeft className="h-3 w-3" />
              {client.name}
            </Link>
          </div>
          <h1 className="font-display font-extrabold text-[clamp(1.6rem,2.5vw,2.4rem)] tracking-tight leading-[1.05] text-foreground flex items-center gap-3">
            <FileText className="h-6 w-6 text-ds-blue shrink-0" />
            Reporte Mensual
          </h1>
          <p className="font-mono text-[0.65rem] text-muted-foreground mt-1">
            {client.domain} · generado con Claude Sonnet 4.6 · datos internos de BD
          </p>
        </div>

        {/* Selector de mes */}
        {history.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            {Array.from(
              new Set([defaultYearMonth, ...history.map((h) => h.yearMonth)])
            )
              .slice(0, 6)
              .map((ym) => (
                <Link
                  key={ym}
                  href={`/clientes/${client.id}/reporte?mes=${ym}`}
                  className={`font-mono text-[0.65rem] px-2.5 py-1 rounded border transition-colors ${
                    ym === currentYearMonth
                      ? "bg-foreground text-background border-foreground"
                      : "bg-card text-muted-foreground border-border hover:text-foreground"
                  }`}
                >
                  {ym}
                </Link>
              ))}
          </div>
        )}

        {/* Panel */}
        <ReportPanel
          clientId={client.id}
          currentYearMonth={currentYearMonth}
          initialRecord={initialRecord}
          history={history.map((h) => ({
            id: h.id,
            yearMonth: h.yearMonth,
            createdAt: h.createdAt,
          }))}
          isAdmin={isAdmin}
        />

      </div>
    </div>
  );
}
