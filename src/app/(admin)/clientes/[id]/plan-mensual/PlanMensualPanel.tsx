"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import {
  Bot, User, Settings2, FileText, Code,
  ChevronDown, ChevronRight, Loader2,
  Play, CheckCircle2, XCircle,
  Clock, Ban, RotateCcw, Terminal,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getPlanData,
  actionExecuteTask,
  actionCompleteHumanStep,
  actionVoidTask,
  actionRetryFailedTask,
  actionActivatePlan,
  actionRunWatchdog,
  type PlanFullView,
  type PlanTaskFullView,
  type PlanStepView,
  type PlanMonthOption,
} from "./actions";

// ─── Constants ──────────────────────────────────────────────────────────────

const MODE_BADGE: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  AI:     { label: "IA",      icon: Bot,      color: "text-ds-blue bg-ds-blue/10 border-ds-blue/30" },
  HYBRID: { label: "Hibrido", icon: User,     color: "text-purple-500 bg-purple-500/10 border-purple-500/30" },
  HUMAN:  { label: "Manual",  icon: User,     color: "text-orange-500 bg-orange-500/10 border-orange-500/30" },
};

const KIND_ICON: Record<string, React.ElementType> = {
  CONTENT: FileText,
  CODE: Code,
  SETUP: Settings2,
};

const TASK_STATUS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  PLANNING:      { label: "Generando pasos...", icon: Loader2,        color: "text-yellow-500" },
  READY:         { label: "Listo",              icon: CheckCircle2,   color: "text-green-500" },
  RUNNING:       { label: "Ejecutando...",      icon: Loader2,        color: "text-ds-blue" },
  WAITING_HUMAN: { label: "Esperando humano",   icon: Clock,          color: "text-orange-500" },
  DONE:          { label: "Completado",         icon: CheckCircle2,   color: "text-emerald-500" },
  FAILED:        { label: "Error",              icon: XCircle,        color: "text-destructive" },
  VOIDED:        { label: "Anulado",            icon: Ban,            color: "text-muted-foreground" },
};

const STEP_STATUS: Record<string, { label: string; color: string }> = {
  PENDING:       { label: "Pendiente",     color: "text-muted-foreground" },
  RUNNING:       { label: "Ejecutando",    color: "text-ds-blue" },
  DONE:          { label: "Hecho",         color: "text-emerald-500" },
  FAILED:        { label: "Error",         color: "text-destructive" },
  WAITING_HUMAN: { label: "Pendiente",     color: "text-orange-500" },
  SKIPPED:       { label: "Omitido",       color: "text-muted-foreground" },
};

const EFFORT_LABEL: Record<string, string> = { LOW: "Bajo", MEDIUM: "Medio", HIGH: "Alto" };

// ─── Progress helpers ───────────────────────────────────────────────────────

function taskProgress(task: PlanTaskFullView): number {
  if (task.status === "DONE") return 100;
  if (task.status === "VOIDED") return 100;
  if (task.steps.length === 0) return 0;
  const done = task.steps.filter((s) => s.status === "DONE" || s.status === "SKIPPED").length;
  return Math.round((done / task.steps.length) * 100);
}

function planProgress(tasks: PlanTaskFullView[]): number {
  if (tasks.length === 0) return 0;
  const active = tasks.filter((t) => t.status !== "VOIDED");
  if (active.length === 0) return 100;
  const done = active.filter((t) => t.status === "DONE").length;
  return Math.round((done / active.length) * 100);
}

function hasActiveWork(tasks: PlanTaskFullView[]): boolean {
  return tasks.some((t) => t.status === "RUNNING" || t.status === "PLANNING");
}

// ─── Month Selector ─────────────────────────────────────────────────────────

function MonthSelector({
  months,
  selected,
  onSelect,
}: {
  months: PlanMonthOption[];
  selected: string;
  onSelect: (m: string) => void;
}) {
  if (months.length <= 1) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[0.65rem] text-muted-foreground uppercase">Mes:</span>
      <select
        value={selected}
        onChange={(e) => onSelect(e.target.value)}
        className="font-mono text-xs bg-card border border-border rounded px-2 py-1 text-foreground"
      >
        {months.map((m) => (
          <option key={m.month} value={m.month}>
            {m.month} ({m.taskCount} tareas)
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Progress Bar ───────────────────────────────────────────────────────────

function ProgressBar({ percent, size = "lg" }: { percent: number; size?: "sm" | "lg" }) {
  return (
    <div className={cn("w-full bg-muted rounded-full overflow-hidden", size === "lg" ? "h-3" : "h-1.5")}>
      <div
        className="h-full bg-gradient-to-r from-[#6366f1] via-[#3b82f6] to-[#ec4899] transition-all duration-500 ease-out rounded-full"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

// ─── Step Row ───────────────────────────────────────────────────────────────

function StepRow({
  step,
  onComplete,
  isCompleting,
}: {
  step: PlanStepView;
  onComplete: (stepId: string) => void;
  isCompleting: boolean;
}) {
  const statusCfg = STEP_STATUS[step.status] ?? STEP_STATUS.PENDING;
  const isHumanPending = step.type === "HUMAN" && (step.status === "PENDING" || step.status === "WAITING_HUMAN");

  return (
    <div className="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-muted/30 group">
      <span className="font-mono text-[0.65rem] text-muted-foreground w-5 shrink-0 pt-0.5 text-right">
        {step.order}.
      </span>

      <span
        className={cn(
          "font-mono text-[0.6rem] px-1 py-0.5 rounded shrink-0 mt-0.5",
          step.type === "AI"
            ? "bg-ds-blue/10 text-ds-blue"
            : "bg-orange-500/10 text-orange-500"
        )}
      >
        {step.type === "AI" ? "IA" : "HT"}
      </span>

      <div className="flex-1 min-w-0">
        <p className="text-xs text-foreground leading-snug">{step.title}</p>
        {step.acceptanceCriteria.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {step.acceptanceCriteria.map((c, i) => (
              <li key={i} className="font-mono text-[0.6rem] text-muted-foreground/70 pl-2 border-l border-border">
                {c}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <span className={cn("font-mono text-[0.6rem]", statusCfg.color)}>
          {statusCfg.label}
        </span>

        {isHumanPending && (
          <button
            onClick={() => onComplete(step.id)}
            disabled={isCompleting}
            className={cn(
              buttonVariants({ variant: "default", size: "sm" }),
              "h-6 text-[0.6rem] px-2 gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
            )}
          >
            {isCompleting ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <><CheckCircle2 className="h-2.5 w-2.5" /> Completar</>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Task Card ──────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onExecute,
  onVoid,
  onRetry,
  onCompleteStep,
  isActing,
}: {
  task: PlanTaskFullView;
  onExecute: (taskId: string) => void;
  onVoid: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  onCompleteStep: (stepId: string) => void;
  isActing: boolean;
}) {
  const [open, setOpen] = useState(
    task.status === "RUNNING" || task.status === "WAITING_HUMAN"
  );
  const statusCfg = TASK_STATUS[task.status] ?? TASK_STATUS.PLANNING;
  const StatusIcon = statusCfg.icon;
  const badge = MODE_BADGE[task.mode] ?? MODE_BADGE.HUMAN;
  const BadgeIcon = badge.icon;
  const KindIcon = KIND_ICON[task.kind] ?? Code;
  const progress = taskProgress(task);
  const isTerminal = task.status === "DONE" || task.status === "VOIDED";

  return (
    <div
      className={cn(
        "bg-card rounded-xl border overflow-hidden transition-colors",
        task.status === "RUNNING" ? "border-ds-blue/40" :
        task.status === "DONE" ? "border-emerald-500/30" :
        task.status === "FAILED" ? "border-destructive/30" :
        task.status === "VOIDED" ? "border-border opacity-60" :
        "border-border"
      )}
    >
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left flex items-center gap-3 p-4 hover:bg-muted/20 transition-colors"
      >
        <StatusIcon
          className={cn(
            "h-4 w-4 shrink-0",
            statusCfg.color,
            (task.status === "PLANNING" || task.status === "RUNNING") && "animate-spin"
          )}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate">
              {task.title}
            </span>
            <span className={cn("font-mono text-[0.6rem] uppercase px-1.5 py-0.5 rounded border flex items-center gap-0.5", badge.color)}>
              <BadgeIcon className="h-2.5 w-2.5" />
              {badge.label}
            </span>
            <span className="font-mono text-[0.6rem] text-muted-foreground border border-border rounded px-1.5 py-0.5 flex items-center gap-0.5">
              <KindIcon className="h-2.5 w-2.5" />
              {task.kind}
            </span>
            <span className="font-mono text-[0.6rem] text-muted-foreground">
              P{task.priority} · {EFFORT_LABEL[task.effort] ?? task.effort}
            </span>
          </div>
          {task.steps.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <ProgressBar percent={progress} size="sm" />
              <span className="font-mono text-[0.6rem] text-muted-foreground shrink-0">
                {progress}%
              </span>
            </div>
          )}
        </div>

        <span className={cn("font-mono text-[0.65rem] shrink-0", statusCfg.color)}>
          {statusCfg.label}
        </span>

        {task.steps.length > 0 && (
          open
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      {open && (
        <div className="border-t border-border">
          {/* Objective */}
          <div className="px-4 py-3 bg-muted/10">
            <p className="font-mono text-[0.65rem] text-muted-foreground leading-relaxed">
              {task.objective}
            </p>
          </div>

          {/* Steps */}
          {task.steps.length > 0 && (
            <div className="px-2 py-2 space-y-0.5">
              <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60 px-2 pb-1">
                Pasos ({task.steps.filter((s) => s.status === "DONE").length}/{task.steps.length})
              </p>
              {task.steps.map((step) => (
                <StepRow
                  key={step.id}
                  step={step}
                  onComplete={onCompleteStep}
                  isCompleting={isActing}
                />
              ))}
            </div>
          )}

          {/* Failure reason */}
          {task.failureReason && (
            <div className="px-4 py-2 bg-destructive/5 border-t border-destructive/20">
              <p className="font-mono text-[0.65rem] text-destructive">
                Error: {task.failureReason}
              </p>
            </div>
          )}

          {/* Void reason */}
          {task.voidReason && (
            <div className="px-4 py-2 bg-muted/10 border-t border-border">
              <p className="font-mono text-[0.65rem] text-muted-foreground">
                Anulado: {task.voidReason}
              </p>
            </div>
          )}

          {/* Last run info */}
          {task.runs.length > 0 && (
            <div className="px-4 py-2 bg-muted/5 border-t border-border">
              {task.runs.slice(0, 1).map((run) => (
                <div key={run.id} className="flex items-center gap-3 font-mono text-[0.6rem] text-muted-foreground">
                  <span>Run: {run.status}</span>
                  {run.costUsd != null && <span>${run.costUsd.toFixed(4)}</span>}
                  {run.buildPassed != null && (
                    <span className={run.buildPassed ? "text-emerald-500" : "text-destructive"}>
                      Build: {run.buildPassed ? "OK" : "FAIL"}
                    </span>
                  )}
                  {run.changedRoutes.length > 0 && (
                    <span>Rutas: {run.changedRoutes.join(", ")}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          {!isTerminal && (
            <div className="px-4 py-3 border-t border-border flex items-center gap-2">
              {task.status === "READY" && task.mode !== "HUMAN" && (
                <button
                  onClick={() => onExecute(task.id)}
                  disabled={isActing}
                  className={cn(buttonVariants({ variant: "default", size: "sm" }), "gap-1.5")}
                >
                  {isActing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <><Play className="h-3 w-3" /> Ejecutar</>
                  )}
                </button>
              )}

              {(task.status === "FAILED" || task.status === "PLANNING") && (
                <button
                  onClick={() => onRetry(task.id)}
                  disabled={isActing}
                  className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "gap-1.5")}
                >
                  <RotateCcw className="h-3 w-3" /> Reintentar
                </button>
              )}

              {task.status !== "RUNNING" && task.status !== "PLANNING" && (
                <button
                  onClick={() => onVoid(task.id)}
                  disabled={isActing}
                  className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "gap-1.5 text-muted-foreground")}
                >
                  <Ban className="h-3 w-3" /> Anular
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Task Group ─────────────────────────────────────────────────────────────

function TaskGroup({
  mode,
  tasks,
  onExecute,
  onVoid,
  onRetry,
  onCompleteStep,
  isActing,
}: {
  mode: string;
  tasks: PlanTaskFullView[];
  onExecute: (taskId: string) => void;
  onVoid: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  onCompleteStep: (stepId: string) => void;
  isActing: boolean;
}) {
  const badge = MODE_BADGE[mode] ?? MODE_BADGE.HUMAN;
  const done = tasks.filter((t) => t.status === "DONE").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className={cn("font-mono text-[0.7rem] uppercase tracking-wider px-2 py-0.5 rounded border", badge.color)}>
          {badge.label}
        </span>
        <span className="font-mono text-[0.65rem] text-muted-foreground">
          {done}/{tasks.length} completadas
        </span>
      </div>
      <div className="space-y-2">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onExecute={onExecute}
            onVoid={onVoid}
            onRetry={onRetry}
            onCompleteStep={onCompleteStep}
            isActing={isActing}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Plan Status Banner ─────────────────────────────────────────────────────

function PlanStatusBanner({
  plan,
  onActivate,
  onWatchdog,
  isActing,
}: {
  plan: PlanFullView;
  onActivate: () => void;
  onWatchdog: () => void;
  isActing: boolean;
}) {
  if (plan.status === "PLANNING") {
    const allReady = plan.tasks.every((t) => t.status !== "PLANNING");
    const hasFailed = plan.tasks.some((t) => t.status === "FAILED");
    const planningCount = plan.tasks.filter((t) => t.status === "PLANNING").length;
    return (
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Plan en preparacion</p>
          <p className="font-mono text-[0.65rem] text-muted-foreground mt-0.5">
            {allReady && !hasFailed
              ? "Todas las tareas tienen pasos generados. Activa el plan para comenzar a ejecutar."
              : hasFailed
              ? "Algunas tareas fallaron al generar pasos. Reintenta o anula las fallidas."
              : `${planningCount} tarea(s) generando pasos. Espera o ejecuta el watchdog si llevan mas de 10 min.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {planningCount > 0 && (
            <button
              onClick={onWatchdog}
              disabled={isActing}
              className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "gap-1.5")}
            >
              <RotateCcw className="h-3 w-3" /> Watchdog
            </button>
          )}
          {allReady && !hasFailed && (
            <button
              onClick={onActivate}
              disabled={isActing}
              className={cn(buttonVariants({ variant: "default", size: "sm" }), "gap-1.5")}
            >
              {isActing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              Activar plan
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}

// ─── Empty State ────────────────────────────────────────────────────────────

function EmptyState({ clientId }: { clientId: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
        <Terminal className="h-8 w-8 text-muted-foreground/40" />
      </div>
      <p className="text-sm font-semibold text-foreground mb-1">Sin plan mensual</p>
      <p className="font-mono text-[0.65rem] text-muted-foreground max-w-sm">
        Ejecuta un Analisis Claude para generar candidatas y enviarlas al plan del mes.
      </p>
      <a
        href={`/clientes/${clientId}/analisis`}
        className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "mt-4")}
      >
        Ir a Analisis Claude
      </a>
    </div>
  );
}

// ─── Main Panel ─────────────────────────────────────────────────────────────

interface Props {
  clientId: string;
  initialPlan: PlanFullView | null;
  initialMonths: PlanMonthOption[];
}

export function PlanMensualPanel({ clientId, initialPlan, initialMonths }: Props) {
  const [plan, setPlan] = useState<PlanFullView | null>(initialPlan);
  const [months, setMonths] = useState<PlanMonthOption[]>(initialMonths);
  const [selectedMonth, setSelectedMonth] = useState(initialPlan?.month ?? initialMonths[0]?.month ?? "");
  const [isActing, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Refresh data
  const refresh = useCallback(async (month?: string) => {
    const data = await getPlanData(clientId, month ?? selectedMonth);
    setPlan(data.plan);
    setMonths(data.months);
  }, [clientId, selectedMonth]);

  // Polling every 15s when there's active work
  useEffect(() => {
    if (!plan || !hasActiveWork(plan.tasks)) return;
    const interval = setInterval(() => refresh(), 15_000);
    return () => clearInterval(interval);
  }, [plan, refresh]);

  function handleMonthChange(month: string) {
    setSelectedMonth(month);
    startTransition(async () => {
      await refresh(month);
    });
  }

  function handleAction(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok && "error" in result) {
        setError(result.error ?? "Error desconocido");
      }
      await refresh();
    });
  }

  function handleExecute(taskId: string) {
    handleAction(() => actionExecuteTask(taskId));
  }

  function handleVoid(taskId: string) {
    const reason = prompt("Razon para anular esta tarea:");
    if (!reason) return;
    handleAction(() => actionVoidTask(taskId, reason));
  }

  function handleRetry(taskId: string) {
    handleAction(() => actionRetryFailedTask(taskId));
  }

  function handleCompleteStep(stepId: string) {
    handleAction(() => actionCompleteHumanStep(stepId));
  }

  function handleActivate() {
    if (!plan) return;
    handleAction(() => actionActivatePlan(plan.id));
  }

  function handleWatchdog() {
    if (!plan) return;
    handleAction(() => actionRunWatchdog(plan.id));
  }

  // Group tasks by mode
  const grouped = plan
    ? (["AI", "HYBRID", "HUMAN"] as const)
        .map((mode) => ({
          mode,
          tasks: plan.tasks.filter((t) => t.mode === mode),
        }))
        .filter((g) => g.tasks.length > 0)
    : [];

  const progress = plan ? planProgress(plan.tasks) : 0;

  return (
    <div className="flex gap-6">
      {/* Left column — main content */}
      <div className="flex-1 min-w-0 space-y-6">
        {/* Controls */}
        <div className="flex items-center justify-between gap-4">
          <MonthSelector
            months={months}
            selected={selectedMonth}
            onSelect={handleMonthChange}
          />
          {plan && hasActiveWork(plan.tasks) && (
            <div className="flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin text-ds-blue" />
              <span className="font-mono text-[0.6rem] text-ds-blue">En vivo</span>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}

        {!plan ? (
          <EmptyState clientId={clientId} />
        ) : (
          <>
            {/* Overall progress */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-wider">
                  Progreso del plan
                </span>
                <span className="font-mono text-sm font-bold text-foreground">
                  {progress}%
                </span>
              </div>
              <ProgressBar percent={progress} />
              <div className="flex items-center gap-4 font-mono text-[0.6rem] text-muted-foreground">
                <span>{plan.tasks.length} tareas</span>
                <span>{plan.tasks.filter((t) => t.status === "DONE").length} completadas</span>
                <span>{plan.tasks.filter((t) => t.status === "FAILED").length} fallidas</span>
                <span>{plan.tasks.filter((t) => t.status === "VOIDED").length} anuladas</span>
              </div>
            </div>

            {/* Plan status banner */}
            <PlanStatusBanner plan={plan} onActivate={handleActivate} onWatchdog={handleWatchdog} isActing={isActing} />

            {/* Task groups */}
            <div className="space-y-8">
              {grouped.map((g) => (
                <TaskGroup
                  key={g.mode}
                  mode={g.mode}
                  tasks={g.tasks}
                  onExecute={handleExecute}
                  onVoid={handleVoid}
                  onRetry={handleRetry}
                  onCompleteStep={handleCompleteStep}
                  isActing={isActing}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Right column — terminal placeholder (S4) */}
      <div className="hidden xl:flex w-80 shrink-0 flex-col">
        <div className="sticky top-8 bg-card rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground/60" />
            <span className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
              Terminal
            </span>
          </div>
          <div className="bg-zinc-950 rounded-lg p-4 min-h-[200px] flex items-center justify-center">
            <p className="font-mono text-[0.6rem] text-zinc-500 text-center">
              Log de ejecucion en tiempo real
              <br />
              <span className="text-zinc-600">Disponible en S4</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
