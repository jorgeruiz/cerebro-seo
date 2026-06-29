"use client";

import { useTransition, useState } from "react";
import {
  FileText,
  RefreshCw,
  AlertCircle,
  Download,
} from "lucide-react";
import { SectionHeader } from "@/components/ui-darkui";
import { ReportContent } from "@/components/report/ReportContent";
import { actionGenerateMonthlyReport } from "./actions";
import type { MonthlyReportResult } from "@/lib/monthly-report";

// ─── Tipos internos ──────────────────────────────────────────────────────────

interface ReportRecord {
  id: string;
  yearMonth: string;
  content: MonthlyReportResult;
  createdAt: Date;
}

interface HistoryEntry {
  id: string;
  yearMonth: string;
  createdAt: Date;
}

// ─── Panel principal ──────────────────────────────────────────────────────────

export function ReportPanel({
  clientId,
  currentYearMonth,
  initialRecord,
  history,
  isAdmin,
}: {
  clientId: string;
  currentYearMonth: string;
  initialRecord: ReportRecord | null;
  history: HistoryEntry[];
  isAdmin: boolean;
}) {
  const pdfUrl = `/clientes/${clientId}/reporte/pdf?mes=${currentYearMonth}`;
  const [isPending, startTransition] = useTransition();
  const [record, setRecord] = useState<ReportRecord | null>(initialRecord);
  const [error, setError] = useState<string | null>(null);

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const res = await actionGenerateMonthlyReport(clientId, currentYearMonth);
      if (res.ok) {
        setRecord(res.record);
      } else {
        setError(res.error);
      }
    });
  }

  const report = record?.content ?? null;

  return (
    <div className="space-y-8">

      {/* Trigger / estado */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          {record ? (
            <p className="font-mono text-[0.75rem] text-muted-foreground">
              Reporte {record.yearMonth} generado el{" "}
              {new Date(record.createdAt).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          ) : (
            <p className="font-mono text-[0.75rem] text-muted-foreground">
              Sin reporte para {currentYearMonth}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Descargar PDF — visible cuando hay reporte */}
          {record && (
            <a
              href={pdfUrl}
              download
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Download className="h-3 w-3" />
              PDF
            </a>
          )}
          {/* Generar / Regenerar — solo ADMIN */}
          {isAdmin && (
            <button
              onClick={handleGenerate}
              disabled={isPending}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? (
                <>
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Generando…
                </>
              ) : (
                <>
                  <FileText className="h-3 w-3" />
                  {record ? "Regenerar" : "Generar reporte"}
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-ds-red/30 bg-ds-red/5">
          <AlertCircle className="h-4 w-4 text-ds-red shrink-0" />
          <p className="text-xs text-ds-red">{error}</p>
        </div>
      )}

      {/* Loading skeleton */}
      {isPending && (
        <div className="space-y-4 animate-pulse">
          <div className="h-20 bg-muted rounded-xl" />
          <div className="grid grid-cols-2 gap-4">
            <div className="h-32 bg-muted rounded-xl" />
            <div className="h-32 bg-muted rounded-xl" />
          </div>
          <div className="h-48 bg-muted rounded-xl" />
        </div>
      )}

      {/* Contenido del reporte — render compartido */}
      {!isPending && report && <ReportContent report={report} />}

      {/* Zero state */}
      {!isPending && !report && !error && (
        <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center gap-4 text-center">
          <FileText className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="text-base font-medium text-foreground mb-1">Sin reporte generado</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              {isAdmin
                ? "Haz clic en Generar reporte para crear el reporte mensual de este período."
                : "El reporte de este período aún no ha sido generado."}
            </p>
          </div>
        </div>
      )}

      {/* Historial */}
      {history.length > 0 && (
        <section>
          <SectionHeader>Historial de reportes</SectionHeader>
          <div className="space-y-1">
            {history.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-border bg-card hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="font-mono text-xs text-foreground">{h.yearMonth}</span>
                </div>
                <span className="font-mono text-[0.7rem] text-muted-foreground">
                  {new Date(h.createdAt).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
