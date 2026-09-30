"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Sparkles, Loader2, RefreshCw, ArrowRight,
  AlertTriangle, TrendingUp, Wrench, Settings2,
  Play, CheckCircle2, XCircle, Clock, User,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  actionRegenerateNextSteps,
  actionApprovePlan,
  type NextStepPlanRecord,
  type PlanExecutionStatus,
} from "./next-steps-actions";
import type { NextStep, NextStepCategoria } from "@/lib/seo-advisor/types";
import { cn } from "@/lib/utils";

// ─── Config de categorías ──────────────────────────────────────────────────

const CATEGORIA_CONFIG: Record<
  NextStepCategoria,
  { label: string; icon: React.ElementType; color: string; borderColor: string }
> = {
  setup: {
    label: "Setup",
    icon: Settings2,
    color: "text-primary bg-primary/10 border-primary/30",
    borderColor: "border-l-primary/50",
  },
  urgente: {
    label: "Urgente",
    icon: AlertTriangle,
    color: "text-destructive bg-destructive/10 border-destructive/40",
    borderColor: "border-l-destructive/60",
  },
  oportunidad: {
    label: "Oportunidad",
    icon: TrendingUp,
    color: "text-ds-green bg-primary/10 border-ds-gd",
    borderColor: "border-l-ds-green/60",
  },
  mejora: {
    label: "Mejora",
    icon: Wrench,
    color: "text-ds-blue bg-ds-blue/10 border-ds-blue/40",
    borderColor: "border-l-ds-blue/60",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatDate(d: Date) {
  return new Date(d).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── StepCard ─────────────────────────────────────────────────────────────

function StepCard({
  step,
  index,
  clientId,
}: {
  step: NextStep;
  index: number;
  clientId: string;
}) {
  const cat = CATEGORIA_CONFIG[step.categoria] ?? CATEGORIA_CONFIG.mejora;
  const CatIcon = cat.icon;

  return (
    <div
      className={cn(
        "bg-card rounded-xl border border-border border-l-4 p-5 space-y-3",
        cat.borderColor
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="shrink-0 font-mono text-[0.75rem] bg-muted text-muted-foreground border border-border rounded px-1.5 py-0.5 mt-0.5">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground leading-snug">{step.titulo}</p>
        </div>
        <span
          className={cn(
            "shrink-0 font-mono text-[0.7rem] uppercase tracking-wide px-1.5 py-0.5 rounded border flex items-center gap-1",
            cat.color
          )}
        >
          <CatIcon className="h-2.5 w-2.5" />
          {cat.label}
        </span>
      </div>

      {/* Descripción */}
      <p className="text-xs text-foreground leading-relaxed">{step.descripcion}</p>

      {/* Evidencia + CTA */}
      <div className="flex items-end justify-between gap-3 border-t border-border pt-3">
        <div>
          <p className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground mb-0.5">
            Evidencia
          </p>
          <p className="font-mono text-[0.7rem] text-muted-foreground/80">{step.evidencia}</p>
        </div>
        {step.seccionDestino && (
          <Link
            href={`/clientes/${clientId}/${step.seccionDestino}`}
            className={cn(
              buttonVariants({ variant: "outline-mono", size: "sm" }),
              "gap-1.5 shrink-0 text-[0.7rem]"
            )}
          >
            Ir a sección
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    </div>
  );
}

// ─── NextStepsPanel ───────────────────────────────────────────────────────

// ─── Step status indicator ────────────────────────────────────────────────

const STEP_STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  PENDING: { icon: Clock, color: "text-muted-foreground", label: "Pendiente" },
  QUEUED: { icon: Clock, color: "text-yellow-500", label: "En cola" },
  RUNNING: { icon: Loader2, color: "text-blue-500", label: "Ejecutando" },
  APPLIED: { icon: CheckCircle2, color: "text-green-500", label: "Aplicado" },
  FAILED: { icon: XCircle, color: "text-destructive", label: "Error" },
  HUMAN_TASK: { icon: User, color: "text-orange-500", label: "Manual" },
};

function ExecutionStatusBar({ execution }: { execution: PlanExecutionStatus }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center gap-2 font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.1em]">
        <Play className="h-3 w-3" />
        <span>Ejecución en curso</span>
        <span className="text-muted-foreground/50 normal-case tracking-normal">
          · {execution.status}
        </span>
      </div>
      <div className="space-y-1.5">
        {execution.steps.map((s) => {
          const cfg = STEP_STATUS_CONFIG[s.status] ?? STEP_STATUS_CONFIG.PENDING;
          const Icon = cfg.icon;
          return (
            <div key={s.stepIndex} className="flex items-center gap-2 text-xs">
              <Icon className={cn("h-3.5 w-3.5 shrink-0", cfg.color, s.status === "RUNNING" && "animate-spin")} />
              <span className="font-mono text-[0.68rem] text-muted-foreground w-6">{String(s.stepIndex + 1).padStart(2, "0")}</span>
              <span className="flex-1 truncate text-foreground">{s.title}</span>
              <span className={cn("font-mono text-[0.65rem] shrink-0", cfg.color)}>{cfg.label}</span>
              {s.reviewUrl && (
                <a href={s.reviewUrl} target="_blank" rel="noopener noreferrer" className="text-primary text-[0.65rem] underline shrink-0">
                  Review
                </a>
              )}
            </div>
          );
        })}
      </div>
      {execution.steps.some((s) => s.error) && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 mt-2">
          {execution.steps.filter((s) => s.error).map((s) => (
            <p key={s.stepIndex} className="text-xs text-destructive">
              Step {s.stepIndex + 1}: {s.error}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  clientId: string;
  initialRecord: NextStepPlanRecord | null;
  initialExecution?: PlanExecutionStatus | null;
  isAdmin: boolean;
}

export function NextStepsPanel({ clientId, initialRecord, initialExecution, isAdmin }: Props) {
  const [current, setCurrent] = useState<NextStepPlanRecord | null>(initialRecord);
  const [execution, setExecution] = useState<PlanExecutionStatus | null>(initialExecution ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isApproving, startApproveTransition] = useTransition();

  function handleRegenerate() {
    setError(null);
    startTransition(async () => {
      const result = await actionRegenerateNextSteps(clientId);
      if (result.ok) {
        setCurrent(result.record);
      } else {
        setError(result.error);
      }
    });
  }

  function handleApprovePlan() {
    setError(null);
    startApproveTransition(async () => {
      const result = await actionApprovePlan(clientId);
      if (result.ok) {
        // Refresh execution status — set a basic representation
        setExecution({
          id: result.summary.executionId,
          status: result.summary.autoSteps > 0 ? "IN_PROGRESS" : "COMPLETED",
          steps: (current?.steps ?? []).map((step, i) => ({
            stepIndex: i,
            title: step.titulo,
            kind: step.kind ?? "otro",
            status: (!step.kind || step.kind === "otro") ? "HUMAN_TASK" : "QUEUED",
            error: null,
            reviewUrl: null,
          })),
          createdAt: new Date(),
        });
      } else {
        setError(result.error);
      }
    });
  }

  const steps = current?.steps ?? [];

  return (
    <div className="space-y-5">
      {/* Controls bar */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2.5 font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.1em]">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span>Próximos pasos sugeridos</span>
          {current && !isPending && (
            <span className="text-muted-foreground/50 normal-case tracking-normal">
              · {formatDate(current.generatedAt)}
            </span>
          )}
        </div>
        <span className="flex-1 h-px bg-border" />
        {isAdmin && (
          <div className="flex items-center gap-2">
            {current && steps.length > 0 && (
              <button
                onClick={handleApprovePlan}
                disabled={isApproving || isPending || (execution?.status === "IN_PROGRESS")}
                className={cn(
                  buttonVariants({ variant: "default", size: "sm" }),
                  "gap-1.5"
                )}
              >
                {isApproving ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Encolando...
                  </>
                ) : (
                  <>
                    <Play className="h-3 w-3" />
                    Ejecutar Plan
                  </>
                )}
              </button>
            )}
            <button
              onClick={handleRegenerate}
              disabled={isPending}
              className={cn(
                buttonVariants({ variant: "outline-mono", size: "sm" }),
                "gap-1.5"
              )}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Analizando... (15–30s)
                </>
              ) : (
                <>
                  <RefreshCw className="h-3 w-3" />
                  Regenerar
                </>
              )}
            </button>
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
        <div className="space-y-3 animate-pulse">
          {[80, 100, 72].map((h, i) => (
            <div
              key={i}
              className="bg-card rounded-xl border border-border border-l-4 border-l-muted"
              style={{ height: `${h}px` }}
            />
          ))}
        </div>
      )}

      {/* Execution status */}
      {execution && <ExecutionStatusBar execution={execution} />}

      {/* Steps grid */}
      {!isPending && steps.length > 0 && (
        <div className="space-y-3">
          {steps.map((step, i) => (
            <StepCard key={i} step={step} index={i} clientId={clientId} />
          ))}
        </div>
      )}

      {/* Meta */}
      {!isPending && current && steps.length > 0 && (
        <p className="font-mono text-[0.68rem] text-muted-foreground/50">
          {current.model === "deterministic" ? "Generado sin IA" : `Modelo: ${current.model}`}
          {current.cost > 0 ? ` · $${current.cost.toFixed(4)} USD` : ""}
          {current.triggeredBy ? ` · por ${current.triggeredBy}` : ""}
        </p>
      )}

      {/* Empty state */}
      {!isPending && !current && !error && (
        <div className="bg-card rounded-xl border border-border p-10 flex flex-col items-center gap-3 text-center">
          <Sparkles className="h-8 w-8 text-muted-foreground/30" />
          <div>
            <p className="text-sm font-medium text-foreground mb-1">
              Sin plan generado todavía
            </p>
            <p className="text-xs text-muted-foreground max-w-sm">
              El SeoAdvisor genera un plan diario a las 7 AM con los próximos pasos
              priorizados para este cliente. También puedes generarlo manualmente.
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={handleRegenerate}
              disabled={isPending}
              className={buttonVariants({ variant: "default", size: "sm" }) + " gap-2 mt-1"}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Generar ahora
            </button>
          )}
        </div>
      )}
    </div>
  );
}
