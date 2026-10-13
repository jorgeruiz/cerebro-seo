"use client";

import { useState, useTransition } from "react";
import { ClipboardList, Check, Loader2, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { actionAddToPlan, type AddToPlanInput } from "./add-to-plan-action";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  clientId: string;
  /** Pre-filled values for the modal */
  defaults: {
    title: string;
    objective: string;
    kind: "CONTENT" | "CODE" | "SETUP";
    mode: "AI" | "HYBRID" | "HUMAN";
    priority: number;
    effort: "LOW" | "MEDIUM" | "HIGH";
    category: string;
  };
  sourceRef: AddToPlanInput["sourceRef"];
  /** If already in plan, show "En el plan" */
  existingTask?: { id: string; title: string; status: string } | null;
  /** Compact mode: just an icon button */
  compact?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AddToPlanButton({ clientId, defaults, sourceRef, existingTask, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaults.title);
  const [objective, setObjective] = useState(defaults.objective);
  const [mode, setMode] = useState(defaults.mode);
  const [kind, setKind] = useState(defaults.kind);
  const [priority, setPriority] = useState(defaults.priority);
  const [effort, setEffort] = useState(defaults.effort);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; taskId?: string; isDuplicate?: boolean; error?: string } | null>(null);

  // Already in plan
  if (existingTask) {
    return (
      <a
        href={`/clientes/${clientId}/plan-mensual`}
        className={cn(
          buttonVariants({ variant: "outline-mono", size: compact ? "sm" : "sm" }),
          "gap-1 text-emerald-500 border-emerald-500/30",
          compact && "h-6 px-1.5"
        )}
        title={`En el plan: ${existingTask.title}`}
      >
        <Check className="h-3 w-3" />
        {!compact && <span className="text-[0.6rem]">En el plan</span>}
      </a>
    );
  }

  function handleSubmit() {
    startTransition(async () => {
      const res = await actionAddToPlan({
        clientId,
        title,
        objective,
        kind,
        mode,
        priority,
        effort,
        category: defaults.category,
        sourceRef,
      });
      setResult(res);
      if (res.ok) {
        setTimeout(() => setOpen(false), 1500);
      }
    });
  }

  return (
    <>
      <button
        onClick={() => { setResult(null); setOpen(true); }}
        className={cn(
          buttonVariants({ variant: "outline-mono", size: "sm" }),
          "gap-1",
          compact && "h-6 px-1.5"
        )}
        title="Agregar al plan mensual"
      >
        <ClipboardList className="h-3 w-3" />
        {!compact && <span className="text-[0.6rem]">Al plan</span>}
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
          <div
            className="bg-card border border-border rounded-xl w-full max-w-lg mx-4 p-5 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-primary" />
                Agregar al Plan Mensual
              </h3>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Source badge */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[0.6rem] bg-muted rounded px-1.5 py-0.5 text-muted-foreground">
                {sourceRef.module}
              </span>
              {sourceRef.itemId && (
                <span className="font-mono text-[0.6rem] text-muted-foreground/60">
                  #{sourceRef.itemId.slice(0, 8)}
                </span>
              )}
            </div>

            {/* Title */}
            <div>
              <label className="font-mono text-[0.6rem] text-muted-foreground uppercase">Título</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full mt-0.5 bg-muted/30 border border-border rounded px-2 py-1.5 text-xs text-foreground"
              />
            </div>

            {/* Objective */}
            <div>
              <label className="font-mono text-[0.6rem] text-muted-foreground uppercase">Objetivo</label>
              <textarea
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                rows={3}
                className="w-full mt-0.5 bg-muted/30 border border-border rounded px-2 py-1.5 text-xs text-foreground resize-none"
              />
            </div>

            {/* Mode + Kind + Priority + Effort */}
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="font-mono text-[0.6rem] text-muted-foreground uppercase">Modo</label>
                <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}
                  className="w-full mt-0.5 bg-muted/30 border border-border rounded px-1 py-1 text-[0.65rem] text-foreground">
                  <option value="AI">IA</option>
                  <option value="HYBRID">Híbrido</option>
                  <option value="HUMAN">Manual</option>
                </select>
              </div>
              <div>
                <label className="font-mono text-[0.6rem] text-muted-foreground uppercase">Tipo</label>
                <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}
                  className="w-full mt-0.5 bg-muted/30 border border-border rounded px-1 py-1 text-[0.65rem] text-foreground">
                  <option value="CODE">Código</option>
                  <option value="CONTENT">Contenido</option>
                  <option value="SETUP">Setup</option>
                </select>
              </div>
              <div>
                <label className="font-mono text-[0.6rem] text-muted-foreground uppercase">Prioridad</label>
                <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}
                  className="w-full mt-0.5 bg-muted/30 border border-border rounded px-1 py-1 text-[0.65rem] text-foreground">
                  {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>P{p}</option>)}
                </select>
              </div>
              <div>
                <label className="font-mono text-[0.6rem] text-muted-foreground uppercase">Esfuerzo</label>
                <select value={effort} onChange={(e) => setEffort(e.target.value as typeof effort)}
                  className="w-full mt-0.5 bg-muted/30 border border-border rounded px-1 py-1 text-[0.65rem] text-foreground">
                  <option value="LOW">Bajo</option>
                  <option value="MEDIUM">Medio</option>
                  <option value="HIGH">Alto</option>
                </select>
              </div>
            </div>

            {/* Snapshot preview */}
            <details className="group">
              <summary className="font-mono text-[0.55rem] text-muted-foreground/60 cursor-pointer hover:text-muted-foreground">
                Datos de contexto (snapshot)
              </summary>
              <pre className="mt-1 font-mono text-[0.5rem] text-muted-foreground/50 bg-muted/10 rounded p-2 max-h-24 overflow-auto">
                {JSON.stringify(sourceRef.snapshot, null, 2)}
              </pre>
            </details>

            {/* Result */}
            {result && (
              <div className={cn("rounded px-3 py-2 text-xs", result.ok ? "bg-emerald-500/10 text-emerald-500" : "bg-destructive/10 text-destructive")}>
                {result.ok
                  ? result.isDuplicate
                    ? "Ya existe en el plan."
                    : "Tarea agregada al plan. Se están generando los pasos..."
                  : result.error}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }))}>
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={isPending || !title.trim() || !objective.trim()}
                className={cn(buttonVariants({ variant: "default", size: "sm" }), "gap-1")}
              >
                {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ClipboardList className="h-3 w-3" />}
                Agregar al plan
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
