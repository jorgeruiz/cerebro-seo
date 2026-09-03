"use client";

import { useState, useTransition } from "react";
import { Sparkles, Loader2, AlertTriangle, TrendingUp, ChevronDown, ChevronRight, Send, Check, Merge, AlertCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { actionGenerateAnalysis, type AnalysisRecord } from "./actions";
import { actionDecomposeAndSendToOrchestrator } from "../orchestrator-actions";
import type { AnalysisOpportunity, AnalysisRisk } from "@/lib/claude-analysis";

interface Props {
  clientId: string;
  initialRecord: AnalysisRecord | null;
  history: AnalysisRecord[];
}

function impactoColor(impacto: string) {
  if (impacto === "alto") return "text-ds-green bg-primary/10 border-ds-gd";
  if (impacto === "medio") return "text-ds-yellow bg-ds-yellow/10 border-ds-yellow/40";
  return "text-muted-foreground bg-muted border-border";
}

function urgenciaColor(urgencia: string) {
  if (urgencia === "alta") return "text-ds-red bg-ds-red/10 border-ds-red/40";
  if (urgencia === "media") return "text-ds-yellow bg-ds-yellow/10 border-ds-yellow/40";
  return "text-muted-foreground bg-muted border-border";
}

function formatDate(d: Date) {
  return new Date(d).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function OpportunityCard({
  opp,
  clientId,
  analysisId,
  oppIndex,
}: {
  opp: AnalysisOpportunity;
  clientId: string;
  analysisId: string;
  oppIndex: number;
}) {
  const [orchState, setOrchState] = useState<"idle" | "sending" | "sent" | "merged" | "error">("idle");
  const [orchError, setOrchError] = useState<string | null>(null);
  const [subtareasCount, setSubtareasCount] = useState(0);

  async function handleSendToOrchestrator(e: React.MouseEvent) {
    e.stopPropagation();
    setOrchState("sending");
    const result = await actionDecomposeAndSendToOrchestrator({
      clientId,
      analysisId,
      oppIndex,
      titulo: opp.titulo,
      descripcion: opp.descripcion,
      accion: opp.accion,
      impacto: opp.impacto,
    });
    if (result.ok) {
      setSubtareasCount(result.subtareasCount);
      setOrchState(result.merged ? "merged" : "sent");
    } else {
      console.error("[orchestrator]", result.error);
      setOrchError(result.error);
      setOrchState("error");
      setTimeout(() => { setOrchState("idle"); setOrchError(null); }, 6000);
    }
  }

  return (
    <div className="bg-card rounded-xl border border-border p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-ds-green shrink-0 mt-0.5" />
          <p className="text-sm font-semibold text-foreground">{opp.titulo}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`font-mono text-[0.7rem] uppercase tracking-wide px-1.5 py-0.5 rounded border ${impactoColor(opp.impacto)}`}
          >
            {opp.impacto}
          </span>
          <button
            onClick={handleSendToOrchestrator}
            disabled={orchState === "sending" || orchState === "sent" || orchState === "merged"}
            title={
              orchState === "sent" ? `Enviada (${subtareasCount} sub-tarea${subtareasCount !== 1 ? "s" : ""})`
              : orchState === "merged" ? `Enviada — merged (${subtareasCount} sub-tarea${subtareasCount !== 1 ? "s" : ""})`
              : orchState === "sending" ? "Descomponiendo y enviando..."
              : orchState === "error" ? (orchError ?? "Error — reintentar")
              : "Enviar al Orquestador"
            }
            className={cn(
              "h-6 w-6 rounded border flex items-center justify-center transition-colors",
              orchState === "merged"
                ? "bg-ds-blue/10 border-ds-blue/30 text-ds-blue"
                : orchState === "sent"
                  ? "bg-ds-green/10 border-ds-green/30 text-ds-green"
                  : orchState === "error"
                    ? "bg-destructive/10 border-destructive/30 text-destructive"
                    : orchState === "sending"
                      ? "bg-muted border-border text-muted-foreground cursor-wait"
                      : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground"
            )}
          >
            {orchState === "sending" ? <Loader2 className="h-3 w-3 animate-spin" />
              : orchState === "merged" ? <Merge className="h-3 w-3" />
              : orchState === "sent" ? <Check className="h-3 w-3" />
              : orchState === "error" ? <AlertCircle className="h-3 w-3" />
              : <Send className="h-3 w-3" />}
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{opp.descripcion}</p>
      {opp.accion && (
        <div className="border-t border-border pt-3">
          <div className="flex items-center justify-between mb-1">
            <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
              Acción concreta
            </p>
            {(orchState === "sent" || orchState === "merged") && (
              <span className="font-mono text-[0.65rem] text-ds-green">
                {subtareasCount} sub-tarea{subtareasCount !== 1 ? "s" : ""} enviada{subtareasCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-xs text-foreground leading-relaxed">{opp.accion}</p>
        </div>
      )}
    </div>
  );
}

function RiskCard({ risk }: { risk: AnalysisRisk }) {
  return (
    <div className="bg-card rounded-xl border border-ds-red/20 p-5 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-ds-red shrink-0 mt-0.5" />
          <p className="text-sm font-semibold text-foreground">{risk.titulo}</p>
        </div>
        <span
          className={`shrink-0 font-mono text-[0.7rem] uppercase tracking-wide px-1.5 py-0.5 rounded border ${urgenciaColor(risk.urgencia)}`}
        >
          {risk.urgencia}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{risk.descripcion}</p>
    </div>
  );
}

function AnalysisView({ record, clientId }: { record: AnalysisRecord; clientId: string }) {
  const { analysis } = record;
  return (
    <div className="space-y-6">
      {/* Meta */}
      <div className="flex items-center gap-3 text-muted-foreground">
        <span className="font-mono text-[0.7rem]">
          Generado: {formatDate(record.createdAt)}
        </span>
        {record.triggeredBy && (
          <span className="font-mono text-[0.7rem]">por {record.triggeredBy}</span>
        )}
        <span className="font-mono text-[0.7rem]">
          ${record.cost.toFixed(4)} USD
        </span>
      </div>

      {/* Resumen ejecutivo */}
      <div className="bg-card rounded-xl border border-border p-6">
        <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground mb-3">
          Resumen ejecutivo
        </p>
        <p className="text-sm text-foreground leading-relaxed">{analysis.resumenEjecutivo}</p>
      </div>

      {/* Oportunidades */}
      {analysis.oportunidades?.length > 0 && (
        <section>
          <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground mb-3">
            Oportunidades identificadas ({analysis.oportunidades.length})
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {analysis.oportunidades.map((opp, i) => (
              <OpportunityCard key={i} opp={opp} clientId={clientId} analysisId={record.id} oppIndex={i} />
            ))}
          </div>
        </section>
      )}

      {/* Riesgos */}
      {analysis.riesgos?.length > 0 && (
        <section>
          <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground mb-3">
            Riesgos a vigilar ({analysis.riesgos.length})
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {analysis.riesgos.map((risk, i) => (
              <RiskCard key={i} risk={risk} />
            ))}
          </div>
        </section>
      )}

      {/* Recomendaciones */}
      {analysis.recomendaciones?.length > 0 && (
        <section>
          <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground mb-3">
            Recomendaciones para el ciclo
          </p>
          <div className="bg-card rounded-xl border border-border p-5">
            <ol className="space-y-3">
              {analysis.recomendaciones.map((rec, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="shrink-0 font-mono text-[0.75rem] bg-primary/10 text-ds-green border border-ds-gd rounded px-1.5 py-0.5 mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-xs text-foreground leading-relaxed">{rec}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {/* Conclusión estratégica */}
      {analysis.conclusionEstrategica && (
        <div className="bg-muted/30 rounded-xl border border-border p-6">
          <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground mb-3">
            Contexto estratégico
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {analysis.conclusionEstrategica}
          </p>
        </div>
      )}
    </div>
  );
}

export function AnalysisPanel({ clientId, initialRecord, history }: Props) {
  const [current, setCurrent] = useState<AnalysisRecord | null>(initialRecord);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const result = await actionGenerateAnalysis(clientId);
      if (result.ok) {
        setCurrent(result.record);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Botón de generación */}
      <div className="flex items-center gap-4 flex-wrap">
        <button
          onClick={handleGenerate}
          disabled={isPending}
          className={buttonVariants({ variant: "default", size: "sm" }) + " gap-2"}
        >
          {isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Analizando... (15–30s)
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              {current ? "Nuevo análisis" : "Generar análisis"}
            </>
          )}
        </button>

        {current && !isPending && (
          <p className="font-mono text-[0.7rem] text-muted-foreground">
            Análisis actual del {formatDate(current.createdAt)}
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
          <p className="text-sm text-destructive">Error: {error}</p>
        </div>
      )}

      {/* Loading skeleton */}
      {isPending && (
        <div className="space-y-4 animate-pulse">
          <div className="bg-card rounded-xl border border-border p-6 h-28" />
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-card rounded-xl border border-border p-5 h-40" />
            <div className="bg-card rounded-xl border border-border p-5 h-40" />
          </div>
        </div>
      )}

      {/* Análisis actual */}
      {!isPending && current && <AnalysisView record={current} clientId={clientId} />}

      {/* Empty state */}
      {!isPending && !current && !error && (
        <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center gap-4 text-center">
          <Sparkles className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="text-base font-medium text-foreground mb-1">Sin análisis generado aún</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              Genera un análisis on-demand que cruzará todos los datos SEO del cliente
              con la estrategia del ciclo actual.
            </p>
          </div>
        </div>
      )}

      {/* Historial */}
      {history.length > 1 && (
        <section>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1.5 font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            {showHistory ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Historial ({history.length - 1} análisis anteriores)
          </button>

          {showHistory && (
            <div className="mt-3 space-y-2">
              {history.slice(1).map((rec) => (
                <button
                  key={rec.id}
                  onClick={() => setCurrent(rec)}
                  className="w-full text-left flex items-center justify-between px-4 py-2.5 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors"
                >
                  <span className="font-mono text-xs text-foreground">
                    {formatDate(rec.createdAt)}
                  </span>
                  <span className="font-mono text-[0.7rem] text-muted-foreground">
                    ${rec.cost.toFixed(4)} · {rec.triggeredBy ?? "sistema"}
  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
