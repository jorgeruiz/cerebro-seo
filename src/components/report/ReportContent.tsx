/**
 * ReportContent — render puro del reporte mensual.
 *
 * Componente server-compatible (sin "use client") que renderiza el contenido
 * completo de un MonthlyReportResult. Usado por:
 *   - ReportPanel.tsx (vista admin con sesión)
 *   - /api/reportes/[id]/embed (vista embebida sin sesión)
 */

import {
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { SectionHeader, KpiCard } from "@/components/ui-darkui";
import type { MonthlyReportResult } from "@/lib/monthly-report";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function impactoBadge(impacto: string) {
  if (impacto === "alto") return "text-ds-red bg-ds-red/10 border-ds-red/40";
  if (impacto === "medio") return "text-ds-yellow bg-ds-yellow/10 border-ds-yellow/40";
  return "text-muted-foreground bg-muted border-border";
}

// ─── Subcomponentes de sección ────────────────────────────────────────────────

export function LogrosDesafios({ report }: { report: MonthlyReportResult }) {
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

export function MetricasKeywords({ report }: { report: MonthlyReportResult }) {
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
                  <p className="font-mono text-[0.75rem] text-foreground truncate max-w-[60%]">{`"${m.term}"`}</p>
                  <span className="font-mono text-[0.7rem] text-ds-green">
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
                  <p className="font-mono text-[0.75rem] text-foreground truncate max-w-[60%]">{`"${m.term}"`}</p>
                  <span className="font-mono text-[0.7rem] text-ds-red">
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

export function OportunidadesSection({ report }: { report: MonthlyReportResult }) {
  if (!report.oportunidades?.length) return null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {report.oportunidades.map((op, i) => (
        <div key={i} className="bg-card rounded-xl border border-border p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold text-foreground">{op.titulo}</p>
            <span className={`shrink-0 font-mono text-[0.65rem] uppercase tracking-wide px-1.5 py-0.5 rounded border ${impactoBadge(op.impacto)}`}>
              {op.impacto}
            </span>
          </div>
          <p className="font-mono text-[0.75rem] text-muted-foreground leading-relaxed">{op.descripcion}</p>
          <div className="border-t border-border pt-3">
            <p className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground mb-1">Acción</p>
            <p className="text-xs text-foreground leading-relaxed">{op.accion}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function PlanProximoMes({ report }: { report: MonthlyReportResult }) {
  return (
    <div className="bg-card rounded-xl border border-ds-blue/20 p-5 space-y-3">
      <p className="text-xs font-semibold text-ds-blue uppercase tracking-wider">Plan del próximo mes</p>
      <ol className="space-y-2">
        {report.planProximoMes.map((accion, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="font-mono text-[0.7rem] text-ds-blue bg-ds-blue/10 border border-ds-blue/30 rounded px-1.5 py-0.5 shrink-0 mt-0.5">
              {i + 1}
            </span>
            <p className="text-xs text-foreground leading-relaxed">{accion}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function ReportContent({ report }: { report: MonthlyReportResult }) {
  return (
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
  );
}
