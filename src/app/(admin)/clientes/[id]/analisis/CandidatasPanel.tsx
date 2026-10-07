"use client";

import { useState, useTransition } from "react";
import {
  Send, Loader2, CheckCircle2, Bot, User,
  FileText, Code, Settings2, AlertTriangle, ChevronDown, ChevronRight,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AnalysisCandidate } from "@/lib/analysis-candidates";
import {
  actionSendToPlan,
  checkEligibility,
  type PlanTaskView,
  getPlanTasks,
} from "./plan-actions";
import { canSendCandidate, type EligibilityResult } from "@/lib/plan-eligibility";

// ─── Config ──────────────────────────────────────────────────────────────────

const MODE_BADGE: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  AI:     { label: "IA",      icon: Bot,     color: "text-ds-blue bg-ds-blue/10 border-ds-blue/30" },
  HYBRID: { label: "Híbrido", icon: User,    color: "text-purple-500 bg-purple-500/10 border-purple-500/30" },
  HUMAN:  { label: "Manual",  icon: User,    color: "text-orange-500 bg-orange-500/10 border-orange-500/30" },
};

const KIND_ICON: Record<string, React.ElementType> = {
  CONTENT: FileText,
  CODE: Code,
  SETUP: Settings2,
};

const EFFORT_LABEL: Record<string, string> = { LOW: "Bajo", MEDIUM: "Medio", HIGH: "Alto" };

const TASK_STATUS_ICON: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  PLANNING: { icon: Loader2, color: "text-yellow-500", label: "Generando pasos..." },
  READY:    { icon: CheckCircle2, color: "text-green-500", label: "Listo" },
  FAILED:   { icon: AlertTriangle, color: "text-destructive", label: "Error" },
};

// ─── Candidate Card ──────────────────────────────────────────────────────────

function CandidateCard({
  candidate,
  selected,
  onToggle,
  disabled,
  disabledReason,
  alreadySent,
}: {
  candidate: AnalysisCandidate;
  selected: boolean;
  onToggle: () => void;
  disabled: boolean;
  disabledReason?: string;
  alreadySent: boolean;
}) {
  const badge = MODE_BADGE[candidate.mode] ?? MODE_BADGE.HUMAN;
  const BadgeIcon = badge.icon;
  const KindIcon = KIND_ICON[candidate.kind] ?? Code;

  return (
    <div
      className={cn(
        "bg-card rounded-xl border p-4 space-y-2 transition-colors",
        alreadySent ? "border-green-500/30 bg-green-500/5 opacity-70" :
        selected ? "border-primary/50 bg-primary/5 cursor-pointer" :
        disabled ? "opacity-50 cursor-not-allowed" :
        "border-border hover:border-border/80 cursor-pointer"
      )}
      onClick={() => !disabled && !alreadySent && onToggle()}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        {!alreadySent ? (
          <div className={cn(
            "h-5 w-5 rounded border flex items-center justify-center shrink-0 mt-0.5",
            disabled ? "border-muted" :
            selected ? "bg-primary border-primary text-white" : "border-border"
          )}>
            {selected && <CheckCircle2 className="h-3 w-3" />}
          </div>
        ) : (
          <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
        )}

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground leading-snug">{candidate.titulo}</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{candidate.descripcion.slice(0, 200)}</p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="font-mono text-[0.65rem] text-muted-foreground border border-border rounded px-1.5 py-0.5 flex items-center gap-1">
            <KindIcon className="h-2.5 w-2.5" />
            {candidate.kind}
          </span>
          <span className={cn("font-mono text-[0.65rem] uppercase px-1.5 py-0.5 rounded border flex items-center gap-1", badge.color)}>
            <BadgeIcon className="h-2.5 w-2.5" />
            {badge.label}
          </span>
          <span className="font-mono text-[0.65rem] text-muted-foreground border border-border rounded px-1.5 py-0.5">
            P{candidate.priority}
          </span>
          <span className="font-mono text-[0.65rem] text-muted-foreground border border-border rounded px-1.5 py-0.5">
            {EFFORT_LABEL[candidate.effort] ?? candidate.effort}
          </span>
        </div>
      </div>

      <div className="ml-8">
        <p className="font-mono text-[0.65rem] text-muted-foreground/70">
          {candidate.justificacion}
        </p>
        {disabledReason && (
          <p className="font-mono text-[0.65rem] text-destructive mt-1">{disabledReason}</p>
        )}
        {alreadySent && (
          <p className="font-mono text-[0.65rem] text-green-600 mt-1">Ya enviada al plan</p>
        )}
      </div>
    </div>
  );
}

// ─── Task Status (post-send view) ────────────────────────────────────────────

function TaskRow({ task }: { task: PlanTaskView }) {
  const statusCfg = TASK_STATUS_ICON[task.status] ?? TASK_STATUS_ICON.PLANNING;
  const StatusIcon = statusCfg.icon;
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-muted/20"
      >
        <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", statusCfg.color, task.status === "PLANNING" && "animate-spin")} />
        <span className="text-sm text-foreground flex-1 truncate">{task.title}</span>
        <span className={cn("font-mono text-[0.65rem] shrink-0", statusCfg.color)}>{statusCfg.label}</span>
        {task.steps.length > 0 && (
          open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
      </button>
      {open && task.steps.length > 0 && (
        <div className="border-t border-border px-3 py-2 space-y-1">
          {task.steps.map((step) => (
            <div key={step.id} className="flex items-center gap-2 text-xs">
              <span className="font-mono text-muted-foreground w-5">{step.order}.</span>
              <span className={cn(
                "font-mono text-[0.6rem] px-1 rounded",
                step.type === "AI" ? "bg-ds-blue/10 text-ds-blue" : "bg-orange-500/10 text-orange-500"
              )}>{step.type}</span>
              <span className="text-foreground flex-1 truncate">{step.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskStatusView({ tasks }: { tasks: PlanTaskView[] }) {
  if (tasks.length === 0) return null;

  return (
    <div className="space-y-2 mt-4">
      <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
        Tareas en el plan ({tasks.length})
      </p>
      {tasks.map((task) => <TaskRow key={task.id} task={task} />)}
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

interface Props {
  clientId: string;
  analysisId: string;
  candidates: AnalysisCandidate[];
}

export function CandidatasPanel({ clientId, analysisId, candidates }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [planTasks, setPlanTasks] = useState<PlanTaskView[]>([]);
  const [isSending, startSendTransition] = useTransition();
  const [isLoading, startLoadTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<{ created: number; duplicated: number } | null>(null);

  // Load eligibility and existing plan tasks on mount
  if (eligibility === null && !isLoading) {
    startLoadTransition(async () => {
      const [elig, tasks] = await Promise.all([
        checkEligibility(clientId),
        getPlanTasks(clientId),
      ]);
      setEligibility(elig);
      setPlanTasks(tasks);
    });
  }

  const sentCandidateIds = new Set(
    planTasks.map((t) => t.sourceCandidateId).filter(Boolean)
  );

  function toggleCandidate(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSend() {
    const selectedCandidates = candidates.filter((c) => selected.has(c.id));
    setError(null);
    setSendResult(null);

    startSendTransition(async () => {
      const result = await actionSendToPlan(clientId, analysisId, selectedCandidates);
      if (result.ok) {
        setSendResult({ created: result.result.tasksCreated, duplicated: result.result.tasksDuplicated });
        setSelected(new Set());
        // Refresh plan tasks
        const tasks = await getPlanTasks(clientId);
        setPlanTasks(tasks);
      } else {
        setError(result.error);
      }
    });
  }

  if (candidates.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
          Candidatas para el Plan mensual ({candidates.length})
        </p>

        {selected.size > 0 && (
          <button
            onClick={handleSend}
            disabled={isSending}
            className={cn(buttonVariants({ variant: "default", size: "sm" }), "gap-2")}
          >
            {isSending ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Enviando...</>
            ) : (
              <><Send className="h-3.5 w-3.5" /> Mandar {selected.size} al plan</>
            )}
          </button>
        )}
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {sendResult && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
          <p className="text-xs text-green-600">
            ✓ {sendResult.created} tarea{sendResult.created !== 1 ? "s" : ""} enviada{sendResult.created !== 1 ? "s" : ""} al plan.
            {sendResult.duplicated > 0 && ` ${sendResult.duplicated} ya existía${sendResult.duplicated !== 1 ? "n" : ""}.`}
            {" "}Los pasos se están generando en segundo plano.
          </p>
        </div>
      )}

      {eligibility?.reason && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
          <p className="text-xs text-yellow-600">
            ⚠ {eligibility.reason} Las tareas SETUP y HUMAN se pueden enviar de todas formas.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {candidates.map((c) => {
          const alreadySent = sentCandidateIds.has(c.id);
          const sendable = eligibility ? canSendCandidate(c, eligibility) : { allowed: true };

          return (
            <CandidateCard
              key={c.id}
              candidate={c}
              selected={selected.has(c.id)}
              onToggle={() => toggleCandidate(c.id)}
              disabled={!sendable.allowed}
              disabledReason={sendable.reason}
              alreadySent={alreadySent}
            />
          );
        })}
      </div>

      <TaskStatusView tasks={planTasks} />
    </div>
  );
}
