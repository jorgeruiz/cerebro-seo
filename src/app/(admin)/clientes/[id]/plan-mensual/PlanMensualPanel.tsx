"use client";

import { useState, useTransition, useCallback, useEffect } from "react";
import {
  CheckCircle2, XCircle, Clock, Loader2, User, Eye,
  ChevronDown, ChevronRight, ExternalLink, Copy, Ban,
  Bot, AlertTriangle,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  actionCompleteStep,
  actionIgnoreStep,
  getPlanExecutions,
  type PlanExecutionView,
  type StepExecutionView,
} from "./actions";

// ─── Status config ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string; terminal: boolean }> = {
  PENDING:    { icon: Clock,        color: "text-muted-foreground", label: "Pendiente",  terminal: false },
  QUEUED:     { icon: Clock,        color: "text-yellow-500",       label: "En cola",    terminal: false },
  RUNNING:    { icon: Loader2,      color: "text-blue-500",         label: "Ejecutando", terminal: false },
  APPLIED:    { icon: CheckCircle2, color: "text-green-500",        label: "Aplicado",   terminal: true },
  FAILED:     { icon: XCircle,      color: "text-destructive",      label: "Error",      terminal: true },
  HUMAN_TASK: { icon: User,         color: "text-orange-500",       label: "Manual",     terminal: false },
  IGNORED:    { icon: Ban,          color: "text-muted-foreground",  label: "Ignorado",   terminal: true },
};

type ExecType = "ia" | "hibrido" | "ht";

const KIND_CONFIG: Record<string, { label: string; execType: ExecType }> = {
  meta:                 { label: "Meta Tags",      execType: "ia" },
  "contenido-blog":     { label: "Blog",           execType: "hibrido" },
  "contenido-landing":  { label: "Landing",        execType: "hibrido" },
  "contenido-optimizar":{ label: "Optimizar",      execType: "ia" },
  schema:               { label: "Schema",         execType: "ia" },
  tecnico:              { label: "Técnico",        execType: "ia" },
  interlinking:         { label: "Links internos", execType: "ia" },
  setup:                { label: "Setup",          execType: "ht" },
  otro:                 { label: "Manual",         execType: "ht" },
};

const EXEC_TYPE_BADGE: Record<ExecType, { label: string; icon: React.ElementType; color: string }> = {
  ia:      { label: "IA",      icon: Bot,  color: "text-ds-blue bg-ds-blue/10 border-ds-blue/30" },
  hibrido: { label: "Híbrido", icon: User, color: "text-purple-500 bg-purple-500/10 border-purple-500/30" },
  ht:      { label: "HT",      icon: User, color: "text-orange-500 bg-orange-500/10 border-orange-500/30" },
};

function getExecType(kind: string): ExecType {
  return KIND_CONFIG[kind]?.execType ?? "ht";
}

type FilterType = "all" | "ia" | "hibrido" | "ht";

// ─── Progress bar ────────────────────────────────────────────────────────────

function ProgressBar({ steps }: { steps: StepExecutionView[] }) {
  const total = steps.length;
  if (total === 0) return null;

  const completed = steps.filter((s) =>
    s.status === "APPLIED" || s.status === "IGNORED"
  ).length;
  const pct = Math.round((completed / total) * 100);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[0.7rem] text-muted-foreground">
          {completed}/{total} tareas completadas
        </span>
        <span className="font-mono text-sm font-bold text-foreground">{pct}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-[#6366f1] via-[#3b82f6] to-[#ec4899] transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Step detail ─────────────────────────────────────────────────────────────

function StepDetail({
  step,
  onComplete,
  onIgnore,
}: {
  step: StepExecutionView;
  onComplete: (id: string) => void;
  onIgnore: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const cfg = STATUS_CONFIG[step.status] ?? STATUS_CONFIG.PENDING;
  const Icon = cfg.icon;
  const execType = getExecType(step.kind);
  const execBadge = EXEC_TYPE_BADGE[execType];
  const ExecIcon = execBadge.icon;
  const _kindLabel = KIND_CONFIG[step.kind]?.label ?? step.kind;

  function handleCopyPrompt() {
    if (step.prompt) {
      navigator.clipboard.writeText(step.prompt);
    }
  }

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors"
      >
        <Icon className={cn("h-4 w-4 shrink-0", cfg.color, step.status === "RUNNING" && "animate-spin")} />
        <span className="font-mono text-[0.7rem] text-muted-foreground w-6 shrink-0">
          {String(step.stepIndex + 1).padStart(2, "0")}
        </span>
        <span className="flex-1 text-sm text-foreground truncate">{step.title}</span>
        <div className="flex items-center gap-2 shrink-0">
          {/* Exec type badge */}
          <span className={cn(
            "font-mono text-[0.65rem] uppercase tracking-wide px-1.5 py-0.5 rounded border flex items-center gap-1",
            execBadge.color
          )}>
            <ExecIcon className="h-2.5 w-2.5" />
            {execBadge.label}
          </span>
          <span className={cn("font-mono text-[0.65rem] shrink-0", cfg.color)}>{cfg.label}</span>
          {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{step.description}</p>

          {/* Result URL */}
          {step.resultUrl ? (
            <div className="flex items-center gap-2">
              <ExternalLink className="h-3 w-3 text-ds-green shrink-0" />
              <a href={step.resultUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline truncate">
                {step.resultUrl}
              </a>
            </div>
          ) : null}

          {/* Review URL */}
          {step.reviewUrl ? (
            <div className="flex items-center gap-2">
              <Eye className="h-3 w-3 text-muted-foreground shrink-0" />
              <a href={step.reviewUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground underline truncate">
                Ver en Constructor
              </a>
            </div>
          ) : null}

          {/* Error */}
          {step.error ? (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{step.error}</p>
            </div>
          ) : null}

          {/* Detailed steps for HT */}
          {step.detailedSteps && Array.isArray(step.detailedSteps) ? (
            <div>
              <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground mb-2">
                Pasos a seguir
              </p>
              <ol className="space-y-1.5">
                {(step.detailedSteps as string[]).map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                    <span className="font-mono text-muted-foreground shrink-0">{i + 1}.</span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {/* Prompt (for failed steps or HT) */}
          {step.prompt ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
                  Prompt para Code
                </p>
                <button
                  onClick={handleCopyPrompt}
                  className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "gap-1 text-[0.65rem] h-6")}
                >
                  <Copy className="h-2.5 w-2.5" />
                  Copiar
                </button>
              </div>
              <pre className="text-[0.7rem] text-muted-foreground bg-muted/50 rounded-lg p-3 overflow-x-auto max-h-40 whitespace-pre-wrap">
                {step.prompt.slice(0, 500)}{step.prompt.length > 500 ? "..." : ""}
              </pre>
            </div>
          ) : null}

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1">
            {step.status === "HUMAN_TASK" && (
              <button
                onClick={() => onComplete(step.id)}
                className={cn(buttonVariants({ variant: "default", size: "sm" }), "gap-1.5")}
              >
                <CheckCircle2 className="h-3 w-3" />
                Completar
              </button>
            )}
            {/* Anular: disponible para FAILED, HUMAN_TASK y PENDING */}
            {(step.status === "FAILED" || step.status === "HUMAN_TASK" || step.status === "PENDING") && (
              <button
                onClick={() => onIgnore(step.id)}
                className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "gap-1.5")}
              >
                <Ban className="h-3 w-3" />
                Anular
              </button>
            )}
          </div>

          {/* Hybrid reminder */}
          {step.status === "APPLIED" && execType === "hibrido" && (
            <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-3 flex items-start gap-2">
              <Eye className="h-3.5 w-3.5 text-purple-500 shrink-0 mt-0.5" />
              <p className="text-xs text-purple-400">
                Revisar en producción: verificar contenido publicado y agregar imagen de portada si aplica.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

interface Props {
  clientId: string;
  initialExecutions: PlanExecutionView[];
  availableMonths: string[];
  currentMonth: string;
}

export function PlanMensualPanel({
  clientId,
  initialExecutions,
  availableMonths,
  currentMonth,
}: Props) {
  const [executions, setExecutions] = useState(initialExecutions);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [filter, setFilter] = useState<FilterType>("all");
  const [isPending, startTransition] = useTransition();

  // Polling: refresh every 15s if there are active executions
  const hasActiveExecution = executions.some((e) =>
    e.status === "PENDING" || e.status === "IN_PROGRESS"
  );

  const refreshExecutions = useCallback(() => {
    startTransition(async () => {
      const fresh = await getPlanExecutions(clientId, selectedMonth);
      setExecutions(fresh);
    });
  }, [clientId, selectedMonth, startTransition]);

  useEffect(() => {
    if (!hasActiveExecution) return;
    const interval = setInterval(refreshExecutions, 15_000);
    return () => clearInterval(interval);
  }, [hasActiveExecution, refreshExecutions]);

  function handleMonthChange(month: string) {
    setSelectedMonth(month);
    startTransition(async () => {
      const fresh = await getPlanExecutions(clientId, month);
      setExecutions(fresh);
    });
  }

  function handleComplete(stepId: string) {
    startTransition(async () => {
      const result = await actionCompleteStep(stepId);
      if (result.ok) {
        const fresh = await getPlanExecutions(clientId, selectedMonth);
        setExecutions(fresh);
      }
    });
  }

  function handleIgnore(stepId: string) {
    startTransition(async () => {
      const result = await actionIgnoreStep(stepId);
      if (result.ok) {
        const fresh = await getPlanExecutions(clientId, selectedMonth);
        setExecutions(fresh);
      }
    });
  }

  const execution = executions[0]; // Most recent for selected month
  const monthLabel = selectedMonth
    ? new Date(selectedMonth + "-01").toLocaleDateString("es-MX", { month: "long", year: "numeric" })
    : "";

  return (
    <div className="space-y-6">
      {/* Month filter */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          {availableMonths.length > 0 ? (
            <select
              value={selectedMonth}
              onChange={(e) => handleMonthChange(e.target.value)}
              className="font-mono text-[0.8rem] bg-card border border-border rounded-lg px-3 py-1.5 text-foreground"
            >
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {new Date(m + "-01").toLocaleDateString("es-MX", { month: "long", year: "numeric" })}
                </option>
              ))}
            </select>
          ) : (
            <span className="font-mono text-[0.8rem] text-muted-foreground">{monthLabel || "Sin ejecuciones"}</span>
          )}
        </div>
        {hasActiveExecution && (
          <span className="flex items-center gap-1.5 font-mono text-[0.7rem] text-ds-blue">
            <Loader2 className="h-3 w-3 animate-spin" />
            Ejecutando en Constructor...
          </span>
        )}
        {isPending && !hasActiveExecution && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Execution content */}
      {execution ? (
        <div className="space-y-5">
          {/* Progress bar */}
          <ProgressBar steps={execution.steps} />

          {/* Meta info */}
          <div className="flex items-center gap-3 font-mono text-[0.7rem] text-muted-foreground">
            <span>Estado: <strong className="text-foreground">{execution.status}</strong></span>
            {execution.triggeredBy && <span>· por {execution.triggeredBy}</span>}
            <span>
              · {new Date(execution.createdAt).toLocaleDateString("es-MX", {
                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
              })}
            </span>
          </div>

          {/* Type filters */}
          <div className="flex items-center gap-2">
            {(["all", "ia", "hibrido", "ht"] as const).map((f) => {
              const labels: Record<FilterType, string> = { all: "Todos", ia: "IA", hibrido: "Híbrido", ht: "HT" };
              const count = f === "all"
                ? execution.steps.length
                : execution.steps.filter((s) => getExecType(s.kind) === f).length;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "font-mono text-[0.7rem] px-2.5 py-1 rounded-lg border transition-colors",
                    filter === f
                      ? "bg-foreground text-background border-foreground"
                      : "bg-card text-muted-foreground border-border hover:border-muted-foreground"
                  )}
                >
                  {labels[f]} ({count})
                </button>
              );
            })}
          </div>

          {/* Steps list (filtered) */}
          <div className="space-y-2">
            {execution.steps
              .filter((s) => filter === "all" || getExecType(s.kind) === filter)
              .map((step) => (
                <StepDetail
                  key={step.id}
                  step={step}
                  onComplete={handleComplete}
                  onIgnore={handleIgnore}
                />
              ))}
          </div>

          {/* 100% — Capturar estrategia mensual */}
          {(() => {
            const total = execution.steps.length;
            const done = execution.steps.filter((s) =>
              s.status === "APPLIED" || s.status === "IGNORED"
            ).length;
            if (total > 0 && done === total) {
              return (
                <div className="bg-gradient-to-r from-[#6366f1]/10 via-[#3b82f6]/10 to-[#ec4899]/10 border border-primary/30 rounded-xl p-6 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Plan mensual completado al 100%</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Captura la estrategia ejecutada en Notion para el registro del mes.
                    </p>
                  </div>
                  <button
                    className={cn(buttonVariants({ variant: "default" }), "gap-2")}
                    onClick={() => {
                      // TODO: llamar a Cerebro para capturar estrategia mensual en Notion
                      alert("Captura de estrategia mensual — pendiente integración con Cerebro/Notion");
                    }}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Capturar estrategia mensual
                  </button>
                </div>
              );
            }
            return null;
          })()}
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center gap-4 text-center">
          <Clock className="h-10 w-10 text-muted-foreground/30" />
          <div>
            <p className="text-base font-medium text-foreground mb-1">
              Sin ejecuciones este mes
            </p>
            <p className="text-sm text-muted-foreground max-w-sm">
              Genera un plan desde la vista general del cliente y da clic en &ldquo;Ejecutar Plan&rdquo;
              para enviar las tareas a Constructor.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
