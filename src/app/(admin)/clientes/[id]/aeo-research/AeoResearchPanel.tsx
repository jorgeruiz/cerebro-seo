"use client";

import { useState, useTransition } from "react";
import {
  Brain, Loader2, ChevronDown, ChevronRight,
  MessageSquare, Cpu, Mic, CheckCircle2, XCircle,
  Plus, Check,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { actionGenerateAeoResearch, type AeoResearchRecord } from "./actions";
import type { AeoCluster, AeoResearchResult } from "@/lib/aeo-classify";
import { useClipboard } from "../ClipboardContext";
import { cn } from "@/lib/utils";

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatDate(d: Date) {
  return new Date(d).toLocaleDateString("es-MX", {
    day: "2-digit", month: "short", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── KPI bar ──────────────────────────────────────────────────────────────

function KpiBar({ result, questionCount }: { result: AeoResearchResult; questionCount: number }) {
  const clusters = Array.isArray(result.clusters) ? result.clusters : [];
  const aeoCount = clusters.filter((c) => c.aeoCandidate).length;
  const geoCount = clusters.filter((c) => c.geoCandidate).length;
  const bothCount = clusters.filter((c) => c.aeoCandidate && c.geoCandidate).length;

  const kpis = [
    { label: "Preguntas analizadas", value: String(questionCount), color: "text-foreground" },
    { label: "Clusters totales",     value: String(clusters.length), color: "text-foreground" },
    { label: "AEO candidates",       value: String(aeoCount), color: "text-ds-blue" },
    { label: "GEO candidates",       value: String(geoCount), color: "text-ds-yellow" },
    { label: "AEO + GEO (doble)",    value: String(bothCount), color: "text-ds-green" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {kpis.map(({ label, value, color }) => (
        <div key={label} className="bg-card rounded-xl border border-border p-4">
          <p className={`text-xl font-display font-extrabold ${color}`}>{value}</p>
          <p className="font-mono text-[0.7rem] text-muted-foreground mt-1 uppercase tracking-wide">{label}</p>
        </div>
      ))}
    </div>
  );
}

// ─── ClusterCard ──────────────────────────────────────────────────────────

function ClusterCard({ cluster, index }: { cluster: AeoCluster; index: number }) {
  const [open, setOpen] = useState(false);
  const { toggleItem, hasItem } = useClipboard();

  const added = hasItem(cluster.tema, "aeo_cluster");

  function buildPayload(): string {
    const lines: string[] = [
      `### ${cluster.tema}`,
      `Intención: ${cluster.intencion} | AEO: ${cluster.aeoCandidate ? "Sí" : "No"} | GEO: ${cluster.geoCandidate ? "Sí" : "No"}`,
      "",
      "**Preguntas:**",
      ...cluster.preguntas.map((q) => `- ${q}`),
      "",
      `**Recomendación:** ${cluster.recomendacion}`,
    ];
    return lines.join("\n");
  }

  function handleClipboard(e: React.MouseEvent) {
    e.stopPropagation(); // no abrir/cerrar el acordeón
    toggleItem({
      type: "aeo_cluster",
      label: cluster.tema,
      payload: buildPayload(),
    });
  }

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left flex items-start gap-3 p-5 hover:bg-muted/20 transition-colors"
      >
        <span className="shrink-0 font-mono text-[0.75rem] bg-muted text-muted-foreground border border-border rounded px-1.5 py-0.5 mt-0.5">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground leading-snug">{cluster.tema}</p>
          <p className="font-mono text-[0.7rem] text-muted-foreground mt-0.5">
            {cluster.preguntas.length} preguntas · {cluster.intencion}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {cluster.aeoCandidate && (
            <span className="font-mono text-[0.7rem] uppercase tracking-wide px-1.5 py-0.5 rounded border text-ds-blue bg-ds-blue/10 border-ds-blue/30 flex items-center gap-1">
              <Mic className="h-2.5 w-2.5" />
              AEO
            </span>
          )}
          {cluster.geoCandidate && (
            <span className="font-mono text-[0.7rem] uppercase tracking-wide px-1.5 py-0.5 rounded border text-ds-yellow bg-ds-yellow/10 border-ds-yellow/30 flex items-center gap-1">
              <Cpu className="h-2.5 w-2.5" />
              GEO
            </span>
          )}
          {/* Botón portapapeles — stopPropagation para no toggle el acordeón */}
          <button
            onClick={handleClipboard}
            title={added ? "Quitar del portapapeles" : "Añadir al portapapeles"}
            className={cn(
              "h-6 w-6 rounded border flex items-center justify-center transition-colors ml-1",
              added
                ? "bg-ds-green/10 border-ds-green/30 text-ds-green"
                : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground"
            )}
          >
            {added ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          </button>
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expandido */}
      {open && (
        <div className="border-t border-border px-5 pb-5 pt-4 space-y-4">
          {/* Candidatos */}
          <div className="flex gap-4">
            <div className="flex items-center gap-1.5">
              {cluster.aeoCandidate ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-ds-blue" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-muted-foreground/40" />
              )}
              <span className="font-mono text-[0.7rem] text-muted-foreground uppercase">
                Featured Snippet / PAA / Voz
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {cluster.geoCandidate ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-ds-yellow" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-muted-foreground/40" />
              )}
              <span className="font-mono text-[0.7rem] text-muted-foreground uppercase">
                ChatGPT / Gemini / Perplexity
              </span>
            </div>
          </div>

          {/* Preguntas */}
          <div>
            <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground mb-2">
              Preguntas del cluster
            </p>
            <ul className="space-y-1">
              {cluster.preguntas.map((q, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                  <span className="text-muted-foreground/40 font-mono shrink-0 mt-0.5">·</span>
                  {q}
                </li>
              ))}
            </ul>
          </div>

          {/* Recomendación */}
          <div className="border-t border-border pt-3">
            <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground mb-1.5">
              Recomendación de contenido
            </p>
            <p className="text-xs text-foreground leading-relaxed">{cluster.recomendacion}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ResearchView ─────────────────────────────────────────────────────────

function ResearchView({ record }: { record: AeoResearchRecord }) {
  const { result } = record;
  const clusters = Array.isArray(result.clusters) ? result.clusters : [];

  return (
    <div className="space-y-6">
      {/* Meta */}
      <div className="flex items-center gap-3 text-muted-foreground flex-wrap">
        <span className="font-mono text-[0.7rem]">Generado: {formatDate(record.createdAt)}</span>
        {record.triggeredBy && (
          <span className="font-mono text-[0.7rem]">por {record.triggeredBy}</span>
        )}
        <span className="font-mono text-[0.7rem]">${record.cost.toFixed(4)} USD</span>
        <span className="font-mono text-[0.7rem]">Seeds: {record.seeds.join(", ")}</span>
      </div>

      {/* KPIs */}
      <KpiBar result={result} questionCount={record.questionCount} />

      {/* Resumen */}
      <div className="bg-card rounded-xl border border-border p-6">
        <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground mb-3">
          Perfil AEO/GEO del cliente
        </p>
        <p className="text-sm text-foreground leading-relaxed">{result.resumen}</p>
      </div>

      {/* Clusters */}
      {clusters.length > 0 && (
        <section>
          <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground mb-3">
            Clusters temáticos ({clusters.length}) — haz clic para expandir
          </p>
          <div className="space-y-3">
            {clusters.map((cluster, i) => (
              <ClusterCard key={i} cluster={cluster} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* Nota estratégica */}
      {result.notaEstrategica && (
        <div className="bg-muted/30 rounded-xl border border-border p-6">
          <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground mb-3">
            Priorización estratégica
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">{result.notaEstrategica}</p>
        </div>
      )}
    </div>
  );
}

// ─── AeoResearchPanel ─────────────────────────────────────────────────────

interface Props {
  clientId: string;
  initialRecord: AeoResearchRecord | null;
  history: AeoResearchRecord[];
  seeds: string[];
}

export function AeoResearchPanel({ clientId, initialRecord, history, seeds }: Props) {
  const [current, setCurrent] = useState<AeoResearchRecord | null>(initialRecord);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const result = await actionGenerateAeoResearch(clientId);
      if (result.ok) {
        setCurrent(result.record);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Seeds info + Generate button */}
      <div className="flex items-center gap-4 flex-wrap">
        <button
          onClick={handleGenerate}
          disabled={isPending}
          className={buttonVariants({ variant: "default", size: "sm" }) + " gap-2"}
        >
          {isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Analizando preguntas... (20–40s)
            </>
          ) : (
            <>
              <Brain className="h-3.5 w-3.5" />
              {current ? "Nuevo análisis AEO/GEO" : "Generar análisis AEO/GEO"}
            </>
          )}
        </button>

        {seeds.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-wide">Seeds:</span>
            {seeds.map((s) => (
              <span key={s} className="font-mono text-[0.7rem] px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
          <p className="text-sm text-destructive">Error: {error}</p>
        </div>
      )}

      {/* Skeleton */}
      {isPending && (
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-card rounded-xl border border-border p-4 h-20" />
            ))}
          </div>
          <div className="bg-card rounded-xl border border-border p-6 h-24" />
          <div className="bg-card rounded-xl border border-border p-5 h-16" />
          <div className="bg-card rounded-xl border border-border p-5 h-16" />
          <div className="bg-card rounded-xl border border-border p-5 h-16" />
        </div>
      )}

      {/* Resultado actual */}
      {!isPending && current && <ResearchView record={current} />}

      {/* Empty state */}
      {!isPending && !current && !error && (
        <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center gap-4 text-center">
          <MessageSquare className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="text-base font-medium text-foreground mb-1">Sin análisis AEO/GEO generado</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              Recopila preguntas de búsqueda relacionadas con las keywords del cliente,
              las agrupa en clusters y clasifica el potencial para featured snippets y
              citación por IAs como ChatGPT, Gemini y Perplexity.
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
                    {formatDate(rec.createdAt)} · {rec.seeds.slice(0, 2).join(", ")}
                  </span>
                  <span className="font-mono text-[0.7rem] text-muted-foreground">
                    {rec.questionCount} preguntas · ${rec.cost.toFixed(4)} · {rec.triggeredBy ?? "sistema"}
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
