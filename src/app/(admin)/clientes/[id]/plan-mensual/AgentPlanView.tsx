"use client";

import { useState, useTransition } from "react";
import {
  Bot, User, CheckCircle2, XCircle, Clock, Ban, AlertTriangle,
  ExternalLink, ChevronDown, ChevronRight, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { actionAgentTaskStatus, type PlanFullView, type PlanTaskFullView } from "./actions";

// ─── Status config ──────────────────────────────────────────────────────────

const AGENT_STATUS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  READY:         { label: "Pendiente",        icon: Clock,          color: "text-muted-foreground" },
  PLANNING:      { label: "Pendiente",        icon: Clock,          color: "text-muted-foreground" },
  RUNNING:       { label: "En progreso",      icon: Loader2,        color: "text-ds-blue" },
  WAITING_HUMAN: { label: "Esperando aprobación", icon: AlertTriangle, color: "text-orange-500" },
  BLOCKED:       { label: "Bloqueada",        icon: XCircle,        color: "text-orange-500" },
  DONE:          { label: "Completada",       icon: CheckCircle2,   color: "text-emerald-500" },
  VOIDED:        { label: "Saltada",          icon: Ban,            color: "text-muted-foreground" },
  FAILED:        { label: "Error",            icon: XCircle,        color: "text-destructive" },
  NEEDS_DEFINITION: { label: "Pendiente",     icon: Clock,          color: "text-muted-foreground" },
  NEEDS_INPUT:   { label: "Pendiente",        icon: Clock,          color: "text-muted-foreground" },
};

// ─── Progress helpers ───────────────────────────────────────────────────────

function planProgress(tasks: PlanTaskFullView[]): number {
  if (tasks.length === 0) return 0;
  const closed = tasks.filter((t) => t.status === "DONE" || t.status === "VOIDED").length;
  return Math.round((closed / tasks.length) * 100);
}

// ─── Progress Bar ───────────────────────────────────────────────────────────

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="w-full bg-muted rounded-full overflow-hidden h-3">
      <div
        className="h-full bg-gradient-to-r from-[#6366f1] via-[#3b82f6] to-[#ec4899] transition-all duration-500 ease-out rounded-full"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

// ─── Action Row ─────────────────────────────────────────────────────────────

function ActionRow({
  task,
  onStatusChange,
  isActing,
}: {
  task: PlanTaskFullView;
  onStatusChange: (taskId: string, status: "done" | "blocked" | "skipped", note: string) => void;
  isActing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isClosed = task.status === "DONE" || task.status === "VOIDED";
  const statusInfo = AGENT_STATUS[task.status] ?? AGENT_STATUS.READY;
  const StatusIcon = statusInfo.icon;
  const isFelix = task.assignee === "felix";

  return (
    <div className={cn(
      "border rounded-lg transition-colors",
      isClosed ? "bg-muted/30 border-border/50" : "bg-card border-border",
    )}>
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button onClick={() => setExpanded(!expanded)} className="shrink-0 text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>

        {/* Priority */}
        <span className={cn(
          "shrink-0 font-mono text-[0.6rem] font-bold px-1.5 py-0.5 rounded",
          task.priority <= 3 ? "bg-red-100 text-red-700" :
          task.priority <= 6 ? "bg-amber-100 text-amber-700" :
          "bg-green-100 text-green-700"
        )}>
          P{task.priority}
        </span>

        {/* Assignee badge */}
        <span className={cn(
          "shrink-0 font-mono text-[0.55rem] px-1.5 py-0.5 rounded border",
          isFelix
            ? "bg-purple-500/10 text-purple-600 border-purple-500/30"
            : "bg-ds-blue/10 text-ds-blue border-ds-blue/30"
        )}>
          {isFelix ? <User className="h-2.5 w-2.5 inline mr-0.5" /> : <Bot className="h-2.5 w-2.5 inline mr-0.5" />}
          {isFelix ? "Felix" : "Ejecutor"}
        </span>

        {/* Status */}
        <span className={cn("shrink-0 flex items-center gap-1 font-mono text-[0.6rem]", statusInfo.color)}>
          <StatusIcon className={cn("h-3 w-3", task.status === "RUNNING" && "animate-spin")} />
          {statusInfo.label}
        </span>

        {/* Title */}
        <span className={cn(
          "text-sm truncate flex-1",
          isClosed ? "text-muted-foreground line-through" : "text-foreground"
        )}>
          {task.title}
        </span>

        {/* Action type badge */}
        {task.actionType && (
          <span className="shrink-0 font-mono text-[0.5rem] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {task.actionType}
          </span>
        )}

        {/* Result URLs */}
        {task.resultUrls.length > 0 && (
          <a
            href={task.resultUrls[task.resultUrls.length - 1]}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-blue-500 hover:text-blue-400"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 pt-0 space-y-2 border-t border-border/50">
          {/* Agent steps */}
          {Array.isArray(task.agentSteps) && task.agentSteps.length > 0 && (
            <div className="mt-2">
              <p className="font-mono text-[0.55rem] text-muted-foreground mb-0.5">Pasos</p>
              <ol className="list-decimal list-inside space-y-0.5 text-xs text-foreground/80 bg-muted/50 rounded p-2">
                {(task.agentSteps as string[]).map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>
          )}

          {/* Description */}
          {task.objective && !Array.isArray(task.agentSteps) && (
            <div className="mt-2">
              <p className="font-mono text-[0.55rem] text-muted-foreground mb-0.5">Descripción</p>
              <pre className="whitespace-pre-wrap text-xs text-foreground/80 leading-relaxed bg-muted/50 rounded p-2 font-sans">
                {task.objective}
              </pre>
            </div>
          )}

          {/* Data source */}
          {task.dataSource && (
            <div>
              <p className="font-mono text-[0.55rem] text-muted-foreground mb-0.5">Fuente</p>
              <p className="text-xs text-foreground/70">{task.dataSource}</p>
            </div>
          )}

          {/* Target keyword */}
          {task.targetKeyword && (
            <div>
              <p className="font-mono text-[0.55rem] text-muted-foreground mb-0.5">Keyword objetivo</p>
              <p className="text-xs font-medium">{task.targetKeyword}</p>
            </div>
          )}

          {/* Note */}
          {(task.statusNote || task.blockedReason || task.voidReason) && (
            <div>
              <p className="font-mono text-[0.55rem] text-muted-foreground mb-0.5">Nota</p>
              <p className="text-xs text-foreground/70 italic">{task.statusNote || task.blockedReason || task.voidReason}</p>
              {task.statusChangedBy && (
                <p className="font-mono text-[0.5rem] text-muted-foreground mt-0.5">
                  — {task.statusChangedBy}, {task.statusChangedAt ? new Date(task.statusChangedAt).toLocaleDateString("es-MX") : ""}
                </p>
              )}
            </div>
          )}

          {/* Action buttons — only for open tasks */}
          {!isClosed && (
            <div className="flex items-center gap-2 pt-1">
              {/* Done button (available for felix tasks from UI) */}
              {isFelix && task.status !== "RUNNING" && (
                <button
                  disabled={isActing}
                  onClick={() => onStatusChange(task.id, "done", "")}
                  className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "gap-1 text-emerald-600")}
                >
                  <CheckCircle2 className="h-3 w-3" /> Hecho
                </button>
              )}
              {isFelix && task.status !== "BLOCKED" && (
                <button
                  disabled={isActing}
                  onClick={() => {
                    const note = prompt("Motivo del bloqueo:");
                    if (note) onStatusChange(task.id, "blocked", note);
                  }}
                  className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "gap-1 text-orange-500")}
                >
                  <XCircle className="h-3 w-3" /> Bloqueada
                </button>
              )}
              {/* Skip button — available for ALL tasks */}
              <button
                disabled={isActing}
                onClick={() => {
                  const note = prompt("Motivo para saltar esta acción (obligatorio):");
                  if (note) onStatusChange(task.id, "skipped", note);
                }}
                className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "gap-1 text-muted-foreground")}
              >
                <Ban className="h-3 w-3" /> Saltar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function AgentPlanView({
  plan,
  onRefresh,
}: {
  plan: PlanFullView;
  onRefresh: () => void;
}) {
  const [isActing, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const progress = planProgress(plan.tasks);
  const total = plan.tasks.length;
  const done = plan.tasks.filter((t) => t.status === "DONE").length;
  const skipped = plan.tasks.filter((t) => t.status === "VOIDED").length;
  const blocked = plan.tasks.filter((t) => t.status === "BLOCKED").length;
  const waitingApproval = plan.tasks.filter((t) => t.status === "WAITING_HUMAN").length;
  const humanWork = plan.tasks.filter((t) => t.assignee === "felix").length;

  function handleStatusChange(taskId: string, status: "done" | "blocked" | "skipped", note: string) {
    setError(null);
    startTransition(async () => {
      const result = await actionAgentTaskStatus(taskId, status, note);
      if (!result.ok) {
        setError(result.error ?? "Error");
      }
      onRefresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Agent badge + plan meta */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-mono text-[0.6rem] px-2 py-1 rounded-full bg-indigo-500/10 text-indigo-500 border border-indigo-500/30 font-semibold uppercase tracking-wider">
          Plan de Agente
        </span>
        {plan.focus && (
          <span className="font-mono text-[0.55rem] text-muted-foreground">
            Enfoque: {plan.focus === "all" ? "Completo" : "Solo técnico"}
          </span>
        )}
        {plan.createdAt && (
          <span className="font-mono text-[0.55rem] text-muted-foreground">
            Creado: {new Date(plan.createdAt).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}
          </span>
        )}
      </div>

      {/* Summary */}
      {plan.summary && (
        <div className="bg-muted/50 rounded-lg p-3">
          <p className="font-mono text-[0.55rem] text-muted-foreground mb-1 uppercase">Resumen del agente</p>
          <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{plan.summary}</p>
        </div>
      )}

      {/* Progress */}
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
        <div className="flex items-center gap-4 font-mono text-[0.6rem] text-muted-foreground flex-wrap">
          <span>{total} acciones</span>
          <span className="text-emerald-500">{done} completadas</span>
          {skipped > 0 && <span>{skipped} saltadas</span>}
          {blocked > 0 && <span className="text-orange-500">{blocked} bloqueadas</span>}
          {waitingApproval > 0 && <span className="text-amber-500">{waitingApproval} esperan aprobación</span>}
          <span className="text-purple-500">{humanWork} trabajo Felix</span>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {/* Actions list */}
      <div className="space-y-2">
        {plan.tasks.map((task) => (
          <ActionRow
            key={task.id}
            task={task}
            onStatusChange={handleStatusChange}
            isActing={isActing}
          />
        ))}
      </div>
    </div>
  );
}
