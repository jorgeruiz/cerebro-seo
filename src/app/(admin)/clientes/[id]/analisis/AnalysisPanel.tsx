"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles, Loader2, AlertTriangle, TrendingUp, ChevronDown, ChevronRight,
  ListChecks, Bot, User, CheckCircle2, Send,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  actionGenerateAnalysis,
  actionGeneratePlanMensual,
  actionSendTasksToPlan,
  type AnalysisRecord,
  type PlanMensualRecord,
} from "./actions";
import type { AnalysisOpportunity, AnalysisRisk } from "@/lib/claude-analysis";
import type { PlanTask } from "@/lib/claude-plan-mensual";

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
    day: "2-digit", month: "short", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

const EXEC_TYPE_BADGE: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  ia:      { label: "IA",      icon: Bot,  color: "text-ds-blue bg-ds-blue/10 border-ds-blue/30" },
  hibrido: { label: "Híbrido", icon: User, color: "text-purple-500 bg-purple-500/10 border-purple-500/30" },
  ht:      { label: "HT",      icon: User, color: "text-orange-500 bg-orange-500/10 border-orange-500/30" },
};

// ─── Opportunity Card (análisis general) ─────────────────────────────────────

function OpportunityCard({ opp }: { opp: AnalysisOpportunity }) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-ds-green shrink-0 mt-0.5" />
          <p className="text-sm font-semibold text-foreground">{opp.titulo}</p>
        </div>
        <span className={`shrink-0 font-mono text-[0.7rem] uppercase tracking-wide px-1.5 py-0.5 rounded border ${impactoColor(opp.impacto)}`}>
          {opp.impacto}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{opp.descripcion}</p>
      {opp.accion && (
        <div className="border-t border-border pt-3">
          <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground mb-1">Acción concreta</p>
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
        <span className={`shrink-0 font-mono text-[0.7rem] uppercase tracking-wide px-1.5 py-0.5 rounded border ${urgenciaColor(risk.urgencia)}`}>
          {risk.urgencia}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{risk.descripcion}</p>
    </div>
  );
}

// ─── Plan Task Card (plan mensual) ───────────────────────────────────────────

function PlanTaskCard({
  task,
  index,
  selected,
  onToggle,
}: {
  task: PlanTask;
  index: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const badge = EXEC_TYPE_BADGE[task.execType] ?? EXEC_TYPE_BADGE.ht;
  const BadgeIcon = badge.icon;

  return (
    <div
      className={cn(
        "bg-card rounded-xl border p-5 space-y-3 cursor-pointer transition-colors",
        selected ? "border-primary/50 bg-primary/5" : "border-border hover:border-border/80"
      )}
      onClick={onToggle}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <div className={cn(
          "h-5 w-5 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-colors",
          selected ? "bg-primary border-primary text-white" : "border-border"
        )}>
          {selected && <CheckCircle2 className="h-3 w-3" />}
        </div>

        <span className="shrink-0 font-mono text-[0.75rem] bg-muted text-muted-foreground border border-border rounded px-1.5 py-0.5 mt-0.5">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground leading-snug">{task.titulo}</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{task.descripcion}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Exec type badge */}
          <span className={cn(
            "font-mono text-[0.65rem] uppercase tracking-wide px-1.5 py-0.5 rounded border flex items-center gap-1",
            badge.color
          )}>
            <BadgeIcon className="h-2.5 w-2.5" />
            {badge.label}
          </span>
          {/* Urgencia */}
          <span className={cn(
            "font-mono text-[0.65rem] uppercase tracking-wide px-1.5 py-0.5 rounded border",
            urgenciaColor(task.urgencia)
          )}>
            {task.urgencia}
          </span>
          {/* Impacto */}
          <span className={cn(
            "font-mono text-[0.65rem] uppercase tracking-wide px-1.5 py-0.5 rounded border",
            impactoColor(task.impacto)
          )}>
            {task.impacto}
          </span>
        </div>
      </div>
      {/* Evidencia */}
      <div className="ml-14">
        <p className="font-mono text-[0.68rem] text-muted-foreground/70">{task.evidencia}</p>
      </div>
    </div>
  );
}

// ─── Analysis View (general) ─────────────────────────────────────────────────

function AnalysisView({ record, clientId: _clientId }: { record: AnalysisRecord; clientId: string }) {
  const { analysis } = record;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 text-muted-foreground">
        <span className="font-mono text-[0.7rem]">Generado: {formatDate(record.createdAt)}</span>
        {record.triggeredBy && <span className="font-mono text-[0.7rem]">por {record.triggeredBy}</span>}
        <span className="font-mono text-[0.7rem]">${record.cost.toFixed(4)} USD</span>
      </div>
      <div className="bg-card rounded-xl border border-border p-6">
        <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground mb-3">Resumen ejecutivo</p>
        <p className="text-sm text-foreground leading-relaxed">{analysis.resumenEjecutivo}</p>
      </div>
      {analysis.oportunidades?.length > 0 && (
        <section>
          <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground mb-3">
            Oportunidades identificadas ({analysis.oportunidades.length})
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {analysis.oportunidades.map((opp, i) => <OpportunityCard key={i} opp={opp} />)}
          </div>
        </section>
      )}
      {analysis.riesgos?.length > 0 && (
        <section>
          <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground mb-3">
            Riesgos a vigilar ({analysis.riesgos.length})
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {analysis.riesgos.map((risk, i) => <RiskCard key={i} risk={risk} />)}
          </div>
        </section>
      )}
      {analysis.recomendaciones?.length > 0 && (
        <section>
          <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground mb-3">Recomendaciones para el ciclo</p>
          <div className="bg-card rounded-xl border border-border p-5">
            <ol className="space-y-3">
              {analysis.recomendaciones.map((rec, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="shrink-0 font-mono text-[0.75rem] bg-primary/10 text-ds-green border border-ds-gd rounded px-1.5 py-0.5 mt-0.5">{i + 1}</span>
                  <p className="text-xs text-foreground leading-relaxed">{rec}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}
      {analysis.conclusionEstrategica && (
        <div className="bg-muted/30 rounded-xl border border-border p-6">
          <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground mb-3">Contexto estratégico</p>
          <p className="text-sm text-muted-foreground leading-relaxed">{analysis.conclusionEstrategica}</p>
        </div>
      )}
    </div>
  );
}

// ─── Plan Mensual View ───────────────────────────────────────────────────────

function PlanMensualView({
  record,
  clientId,
}: {
  record: PlanMensualRecord;
  clientId: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isSending, startSendTransition] = useTransition();
  const [sendError, setSendError] = useState<string | null>(null);

  const tasks = record.result.tareas;

  function toggleTask(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(tasks.map((_, i) => i)));
  }

  function selectByType(type: string) {
    setSelected(new Set(tasks.map((t, i) => ({ t, i })).filter(({ t }) => t.execType === type).map(({ i }) => i)));
  }

  function handleSendToPlan() {
    const selectedTasks = tasks.filter((_, i) => selected.has(i));
    setSendError(null);
    startSendTransition(async () => {
      const result = await actionSendTasksToPlan(clientId, selectedTasks);
      if (result.ok) {
        router.push(`/clientes/${clientId}/plan-mensual`);
      } else {
        setSendError(result.error);
      }
    });
  }

  const iaCount = tasks.filter((t) => t.execType === "ia").length;
  const hibridoCount = tasks.filter((t) => t.execType === "hibrido").length;
  const htCount = tasks.filter((t) => t.execType === "ht").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 text-muted-foreground">
        <span className="font-mono text-[0.7rem]">Generado: {formatDate(record.createdAt)}</span>
        {record.triggeredBy && <span className="font-mono text-[0.7rem]">por {record.triggeredBy}</span>}
        <span className="font-mono text-[0.7rem]">${record.cost.toFixed(4)} USD</span>
      </div>

      {/* Resumen */}
      <div className="bg-card rounded-xl border border-border p-6">
        <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground mb-3">Resumen del plan</p>
        <p className="text-sm text-foreground leading-relaxed">{record.result.resumen}</p>
      </div>

      {/* Selection controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-wide mr-2">
          Seleccionar:
        </span>
        <button onClick={selectAll} className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "text-[0.7rem]")}>
          Todas ({tasks.length})
        </button>
        <button onClick={() => selectByType("ia")} className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "text-[0.7rem] gap-1")}>
          <Bot className="h-3 w-3" /> IA ({iaCount})
        </button>
        <button onClick={() => selectByType("hibrido")} className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "text-[0.7rem] gap-1")}>
          Híbrido ({hibridoCount})
        </button>
        <button onClick={() => selectByType("ht")} className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "text-[0.7rem] gap-1")}>
          HT ({htCount})
        </button>
        <button onClick={() => setSelected(new Set())} className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "text-[0.7rem]")}>
          Ninguna
        </button>

        <span className="flex-1" />

        {selected.size > 0 && (
          <button
            onClick={handleSendToPlan}
            disabled={isSending}
            className={cn(buttonVariants({ variant: "default" }), "gap-2")}
          >
            {isSending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
                Enviar {selected.size} al Plan Mensual
              </>
            )}
          </button>
        )}
      </div>

      {sendError && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
          <p className="text-sm text-destructive">Error: {sendError}</p>
        </div>
      )}

      {/* Tasks */}
      <div className="space-y-3">
        {tasks.map((task, i) => (
          <PlanTaskCard
            key={i}
            task={task}
            index={i}
            selected={selected.has(i)}
            onToggle={() => toggleTask(i)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

export function AnalysisPanel({ clientId, initialRecord, history }: Props) {
  const [current, setCurrent] = useState<AnalysisRecord | null>(initialRecord);
  const [planMensual, setPlanMensual] = useState<PlanMensualRecord | null>(null);
  const [activeTab, setActiveTab] = useState<"general" | "plan">("general");
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleGenerateGeneral() {
    setError(null);
    startTransition(async () => {
      const result = await actionGenerateAnalysis(clientId);
      if (result.ok) {
        setCurrent(result.record);
        setActiveTab("general");
      } else {
        setError(result.error);
      }
    });
  }

  function handleGeneratePlan() {
    setError(null);
    startTransition(async () => {
      const result = await actionGeneratePlanMensual(clientId);
      if (result.ok) {
        setPlanMensual(result.record);
        setActiveTab("plan");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Buttons */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleGenerateGeneral}
          disabled={isPending}
          className={cn(buttonVariants({ variant: activeTab === "general" ? "default" : "outline-mono", size: "sm" }), "gap-2")}
        >
          {isPending && activeTab === "general" ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analizando... (15–30s)</>
          ) : (
            <><Sparkles className="h-3.5 w-3.5" /> Análisis General</>
          )}
        </button>
        <button
          onClick={handleGeneratePlan}
          disabled={isPending}
          className={cn(buttonVariants({ variant: activeTab === "plan" ? "default" : "outline-mono", size: "sm" }), "gap-2")}
        >
          {isPending && activeTab === "plan" ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generando plan... (15–30s)</>
          ) : (
            <><ListChecks className="h-3.5 w-3.5" /> Plan Mensual</>
          )}
        </button>

        {current && activeTab === "general" && !isPending && (
          <p className="font-mono text-[0.7rem] text-muted-foreground">
            Análisis del {formatDate(current.createdAt)}
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

      {/* General analysis */}
      {!isPending && activeTab === "general" && current && (
        <AnalysisView record={current} clientId={clientId} />
      )}

      {/* Plan mensual */}
      {!isPending && activeTab === "plan" && planMensual && (
        <PlanMensualView record={planMensual} clientId={clientId} />
      )}

      {/* Empty state */}
      {!isPending && !current && !planMensual && !error && (
        <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center gap-4 text-center">
          <Sparkles className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="text-base font-medium text-foreground mb-1">Sin análisis generado aún</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              <strong>Análisis General:</strong> resumen ejecutivo con oportunidades y riesgos.
              <br />
              <strong>Plan Mensual:</strong> tareas accionables clasificadas por IA/Híbrido/HT para enviar a Constructor.
            </p>
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 1 && (
        <section>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1.5 font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            {showHistory ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Historial ({history.length - 1} análisis anteriores)
          </button>
          {showHistory && (
            <div className="mt-3 space-y-2">
              {history.slice(1).map((rec) => (
                <button
                  key={rec.id}
                  onClick={() => { setCurrent(rec); setActiveTab("general"); }}
                  className="w-full text-left flex items-center justify-between px-4 py-2.5 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors"
                >
                  <span className="font-mono text-xs text-foreground">{formatDate(rec.createdAt)}</span>
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
