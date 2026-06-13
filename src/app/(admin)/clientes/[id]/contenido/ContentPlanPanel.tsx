"use client";

import { useState, useTransition } from "react";
import {
  Lightbulb, Loader2, ChevronDown, ChevronRight,
  FileText, Globe, BookOpen, Layers,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { actionGenerateContentPlan, type ContentPlanRecord } from "./actions";
import type { ContentIdea, ContentType, ContentPriority } from "@/lib/claude-content-plan";

// ─── Helpers ───────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<ContentType, { label: string; icon: React.ElementType; color: string }> = {
  blog:    { label: "Blog",    icon: FileText, color: "text-ds-blue bg-ds-blue/10 border-ds-blue/40" },
  landing: { label: "Landing", icon: Globe,    color: "text-ds-green bg-primary/10 border-ds-gd" },
  pilar:   { label: "Pilar",   icon: Layers,   color: "text-primary bg-primary/10 border-primary/30" },
  soporte: { label: "Soporte", icon: BookOpen,  color: "text-muted-foreground bg-muted border-border" },
};

const PRIORITY_CONFIG: Record<ContentPriority, { label: string; color: string }> = {
  alta:  { label: "Alta",  color: "text-ds-green bg-primary/10 border-ds-gd" },
  media: { label: "Media", color: "text-ds-yellow bg-ds-yellow/10 border-ds-yellow/40" },
  baja:  { label: "Baja",  color: "text-muted-foreground bg-muted border-border" },
};

function formatDate(d: Date) {
  return new Date(d).toLocaleDateString("es-MX", {
    day: "2-digit", month: "short", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── IdeaCard ─────────────────────────────────────────────────────────────

function IdeaCard({ idea, index }: { idea: ContentIdea; index: number }) {
  const type = TYPE_CONFIG[idea.tipo] ?? TYPE_CONFIG.blog;
  const prio = PRIORITY_CONFIG[idea.prioridad] ?? PRIORITY_CONFIG.media;
  const Icon = type.icon;

  return (
    <div className="bg-card rounded-xl border border-border p-5 space-y-3 hover:border-border/80 transition-colors">
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="shrink-0 font-mono text-[0.65rem] bg-muted text-muted-foreground border border-border rounded px-1.5 py-0.5 mt-0.5">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground leading-snug">{idea.titulo}</p>
          {idea.urlSugerida && (
            <p className="font-mono text-[0.6rem] text-muted-foreground/60 mt-0.5 truncate">
              {idea.urlSugerida}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`font-mono text-[0.6rem] uppercase tracking-wide px-1.5 py-0.5 rounded border ${type.color}`}>
            <Icon className="h-2.5 w-2.5 inline mr-0.5" />
            {type.label}
          </span>
          <span className={`font-mono text-[0.6rem] uppercase tracking-wide px-1.5 py-0.5 rounded border ${prio.color}`}>
            {prio.label}
          </span>
        </div>
      </div>

      {/* Keywords */}
      {idea.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {idea.keywords.map((kw, i) => (
            <span key={i} className="font-mono text-[0.6rem] px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border">
              {kw}
            </span>
          ))}
        </div>
      )}

      {/* Ángulo */}
      <p className="text-xs text-foreground leading-relaxed">{idea.angulo}</p>

      {/* Razón / justificación con datos */}
      <div className="border-t border-border pt-3">
        <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground mb-1">
          Justificación
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">{idea.razon}</p>
      </div>
    </div>
  );
}

// ─── PlanView ─────────────────────────────────────────────────────────────

function PlanView({ record }: { record: ContentPlanRecord }) {
  const { plan } = record;
  const ideas = Array.isArray(plan.ideas) ? plan.ideas : [];

  return (
    <div className="space-y-6">
      {/* Meta */}
      <div className="flex items-center gap-3 text-muted-foreground flex-wrap">
        <span className="font-mono text-[0.6rem]">Generado: {formatDate(record.createdAt)}</span>
        {record.triggeredBy && (
          <span className="font-mono text-[0.6rem]">por {record.triggeredBy}</span>
        )}
        <span className="font-mono text-[0.6rem]">${record.cost.toFixed(4)} USD</span>
        <span className="font-mono text-[0.6rem]">{record.month}</span>
      </div>

      {/* Resumen */}
      <div className="bg-card rounded-xl border border-border p-6">
        <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground mb-3">
          Visión general del plan
        </p>
        <p className="text-sm text-foreground leading-relaxed">{plan.resumen}</p>
      </div>

      {/* Ideas */}
      {ideas.length > 0 && (
        <section>
          <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground mb-3">
            Ideas de contenido ({ideas.length}) — ordenadas por prioridad
          </p>
          <div className="space-y-4">
            {ideas.map((idea, i) => (
              <IdeaCard key={i} idea={idea} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* Nota estratégica */}
      {plan.notaEstrategica && (
        <div className="bg-muted/30 rounded-xl border border-border p-6">
          <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground mb-3">
            Alineación con ciclo actual
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">{plan.notaEstrategica}</p>
        </div>
      )}
    </div>
  );
}

// ─── ContentPlanPanel ─────────────────────────────────────────────────────

interface Props {
  clientId: string;
  initialRecord: ContentPlanRecord | null;
  history: ContentPlanRecord[];
}

export function ContentPlanPanel({ clientId, initialRecord, history }: Props) {
  const [current, setCurrent] = useState<ContentPlanRecord | null>(initialRecord);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const result = await actionGenerateContentPlan(clientId);
      if (result.ok) {
        setCurrent(result.record);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Generar */}
      <div className="flex items-center gap-4 flex-wrap">
        <button
          onClick={handleGenerate}
          disabled={isPending}
          className={buttonVariants({ variant: "default", size: "sm" }) + " gap-2"}
        >
          {isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Generando plan... (15–30s)
            </>
          ) : (
            <>
              <Lightbulb className="h-3.5 w-3.5" />
              {current ? "Nuevo plan" : "Generar plan de contenido"}
            </>
          )}
        </button>

        {current && !isPending && (
          <p className="font-mono text-[0.6rem] text-muted-foreground">
            Plan actual del {formatDate(current.createdAt)}
          </p>
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
          <div className="bg-card rounded-xl border border-border p-6 h-24" />
          <div className="bg-card rounded-xl border border-border p-5 h-40" />
          <div className="bg-card rounded-xl border border-border p-5 h-40" />
          <div className="bg-card rounded-xl border border-border p-5 h-40" />
        </div>
      )}

      {/* Plan actual */}
      {!isPending && current && <PlanView record={current} />}

      {/* Empty state */}
      {!isPending && !current && !error && (
        <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center gap-4 text-center">
          <Lightbulb className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="text-base font-medium text-foreground mb-1">Sin plan generado aún</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              Genera un plan de contenido que cruzará los keyword gaps, oportunidades GSC
              y la estrategia del ciclo actual para proponer ideas accionables.
            </p>
          </div>
        </div>
      )}

      {/* Historial */}
      {history.length > 1 && (
        <section>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1.5 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            {showHistory ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Historial ({history.length - 1} planes anteriores)
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
                    {formatDate(rec.createdAt)} · {rec.month}
                  </span>
                  <span className="font-mono text-[0.6rem] text-muted-foreground">
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
