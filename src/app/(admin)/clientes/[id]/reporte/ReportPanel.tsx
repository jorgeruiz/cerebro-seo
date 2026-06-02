"use client";

import { useTransition, useState } from "react";
import {
  FileText,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { SectionHeader, KpiCard } from "@/components/ui-darkui";
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function impactoBadge(impacto: string) {
  if (impacto === "alto") return "text-ds-red bg-ds-red/10 border-ds-red/40";
  if (impacto === "medio") return "text-ds-yellow bg-ds-yellow/10 border-ds-yellow/40";
  return "text-muted-foreground bg-muted border-border";
}

// ─── Componentes de sección ───────────────────────────────────────────────────

function LogrosDesafios({ report }: { report: MonthlyReportResult }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Logros */}
      <div className="bg-card rounded-xl border border-ds-green/20 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-ds-green shrink-0" />
          <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Logros del mes</p>
        </div>
        <ul className="space-y-2">
          {report.logros.map((logro, i) => (
            <li key={i} className="flex items-start gap-2">
              <ChevronRight className="h-3 w-3 text-ds-green mt-0.5 shrink-0" />
              <p className="text-xs text-foreground leading-relaxed">{logro}</p>
            </li>
          ))}
        </ul>
      </div>

      {/* Desafíos */}
      <div className="bg-card rounded-xl border border-ds-yellow/20 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-ds-yellow shrink-0" />
          <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Desafíos</p>
        </div>
        <ul className="space-y-2">
          {report.desafios.map((desafio, i) => (
            <li key={i} className="flex items-start gap-2">
              <ChevronRight className="h-3 w-3 text-ds-yellow mt-0.5 shrink-0" />
              <p className="text-xs text-foreground leading-relaxed">{desafio}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MetricasKeywords({ report }: { report: MonthlyReportResult }) {
  const kw = report.metricas.keywords;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total keywords" value={String(kw.total)} />
        <KpiCard label="Mejoraron" value={String(kw.mejoraron)} valueColor="green" />
        <KpiCard label="Cayeron" value={String(kw.cayeron)} valueColor={kw.cayeron > 0 ? "red" : "green"} />
        <KpiCard label="Sin cambio" value={String(kw.sinCambio)} />
      </div>

      {(kw.topMejoras.length > 0 || kw.topCaidas.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {kw.topMejoras.length > 0 && (
            <div className="bg-card rounded-xl border border-ds-green/20 p-4 space-y-2">
              <p className="text-xs font-semibold text-ds-green uppercase tracking-wider flex items-center gap-1.5">
                <TrendingUp className="h-3 w-3" /> Top mejoras
              </p>
              {kw.topMejoras.map((m, i) => (
                <div key={i} className="flex items-center justify-between">
                  <p className="font-mono text-[0.65rem] text-foreground truncate max-w-[60%]">{`"${m.term}"`}</p>
                  <span className="font-mono text-[0.6rem] text-ds-green">
                    #{m.posicionAnterior} → #{m.posicionActual} (+{m.delta})
                  </span>
                </div>
              ))}
            </div>
          )}
          {kw.topCaidas.length > 0 && (
            <div className="bg-card rounded-xl border border-ds-red/20 p-4 space-y-2">
              <p className="text-xs font-semibold text-ds-red uppercase tracking-wider flex items-center gap-1.5">
                <TrendingDown className="h-3 w-3" /> Top caídas
              </p>
              {kw.topCaidas.map((m, i) => (
                <div key={i} className="flex items-center justify-between">
                  <p className="font-mono text-[0.65rem] text-foreground truncate max-w-[60%]">{`"${m.term}"`}</p>
                  <span className="font-mono text-[0.6rem] text-ds-red">
                    #{m.posicionAnterior} → #{m.posicionActual} ({m.delta})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OportunidadesSection({ report }: { report: MonthlyReportResult }) {
  if (!report.oportunidades?.length) return null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {report.oportunidades.map((op, i) => (
        <div key={i} className="bg-card rounded-xl border border-border p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold text-foreground">{op.titulo}</p>
            <span className={`shrink-0 font-mono text-[0.55rem] uppercase tracking-wide px-1.5 py-0.5 rounded border ${impactoBadge(op.impacto)}`}>
              {op.impacto}
            </span>
          </div>
          <p className="font-mono text-[0.65rem] text-muted-foreground leading-relaxed">{op.descripcion}</p>
          <div className="border-t border-border pt-3">
            <p className="font-mono text-[0.55rem] uppercase tracking-wider text-muted-foreground mb-1">Acción</p>
            <p className="text-xs text-foreground leading-relaxed">{op.accion}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function PlanProximoMes({ report }: { report: MonthlyReportResult }) {
  return (
    <div className="bg-card rounded-xl border border-ds-blue/20 p-5 space-y-3">
      <p className="text-xs font-semibold text-ds-blue uppercase tracking-wider">Plan del próximo mes</p>
      <ol className="space-y-2">
        {report.planProximoMes.map((accion, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="font-mono text-[0.6rem] text-ds-blue bg-ds-blue/10 border border-ds-blue/30 rounded px-1.5 py-0.5 shrink-0 mt-0.5">
              {i + 1}
            </span>
            <p className="text-xs text-foreground leading-relaxed">{accion}</p>
          </li>
        ))}
      </ol>
    </div>
  );
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
      <div className="flex items-center justify-between gap-4">
        <div>
          {record ? (
            <p className="font-mono text-[0.65rem] text-muted-foreground">
              Reporte {record.yearMonth} generado el{" "}
              {new Date(record.createdAt).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          ) : (
            <p className="font-mono text-[0.65rem] text-muted-foreground">
              Sin reporte para {currentYearMonth}
            </p>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={handleGenerate}
            disabled={isPending}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
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

      {/* Contenido del reporte */}
      {!isPending && report && (
        <>
          {/* Resumen ejecutivo */}
          <section>
            <SectionHeader>Resumen ejecutivo — {report.periodo}</SectionHeader>
            <div className="bg-card rounded-xl border border-border p-5">
              <p className="text-sm text-foreground leading-relaxed">{report.resumenEjecutivo}</p>
            </div>
          </section>

          {/* Logros + Desafíos */}
          <section>
            <SectionHeader>Balance del mes</SectionHeader>
            <LogrosDesafios report={report} />
          </section>

          {/* Métricas keywords */}
          <section>
            <SectionHeader>Rankings</SectionHeader>
            <MetricasKeywords report={report} />
          </section>

          {/* Métricas adicionales */}
          {(report.metricas.backlinks || report.metricas.aiSearch || report.metricas.ciclo) && (
            <section>
              <SectionHeader>Otras métricas</SectionHeader>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {report.metricas.backlinks && (
                  <>
                    <KpiCard label="Backlinks totales" value={String(report.metricas.backlinks.total)} />
                    <KpiCard label="Dominios únicos" value={String(report.metricas.backlinks.dominiosUnicos)} />
                  </>
                )}
                {report.metricas.aiSearch && (
                  <KpiCard
                    label="Mención en Claude"
                    value={`${report.metricas.aiSearch.tasaMencion}%`}
                    valueColor={report.metricas.aiSearch.tasaMencion >= 50 ? "green" : "default"}
                  />
                )}
                {report.metricas.ciclo && (
                  <KpiCard
                    label="Tareas completadas"
                    value={`${report.metricas.ciclo.tareasCompletadas}/${report.metricas.ciclo.tareasTotal}`}
                    valueColor={report.metricas.ciclo.tareasCompletadas === report.metricas.ciclo.tareasTotal ? "green" : "default"}
                  />
                )}
              </div>
            </section>
          )}

          {/* Oportunidades */}
          {report.oportunidades?.length > 0 && (
            <section>
              <SectionHeader>Oportunidades identificadas</SectionHeader>
              <OportunidadesSection report={report} />
            </section>
          )}

          {/* Plan próximo mes */}
          {report.planProximoMes?.length > 0 && (
            <section>
              <SectionHeader>Plan próximo mes</SectionHeader>
              <PlanProximoMes report={report} />
            </section>
          )}

          {/* Conclusión */}
          {report.conclusionEjecutiva && (
            <section>
              <SectionHeader>Conclusión estratégica</SectionHeader>
              <div className="bg-card rounded-xl border border-border p-5">
                <p className="text-sm text-foreground leading-relaxed">{report.conclusionEjecutiva}</p>
              </div>
            </section>
          )}
        </>
      )}

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
                <span className="font-mono text-[0.6rem] text-muted-foreground">
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
