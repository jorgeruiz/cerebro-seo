"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Sparkles, Loader2, RefreshCw, ArrowRight,
  AlertTriangle, TrendingUp, Wrench, Settings2,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { actionRegenerateNextSteps, type NextStepPlanRecord } from "./next-steps-actions";
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

interface Props {
  clientId: string;
  initialRecord: NextStepPlanRecord | null;
  isAdmin: boolean;
}

export function NextStepsPanel({ clientId, initialRecord, isAdmin }: Props) {
  const [current, setCurrent] = useState<NextStepPlanRecord | null>(initialRecord);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
