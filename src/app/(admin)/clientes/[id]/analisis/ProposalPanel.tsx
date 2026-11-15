"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Zap, Star, Shield } from "lucide-react";
import type { ComposedPlan } from "@/lib/plan/plan-composer";

const TYPE_CONFIG = {
  urgent: { label: "Urgente", icon: AlertTriangle, color: "text-red-500", bg: "bg-red-500/10" },
  easy_win: { label: "Easy Win", icon: Zap, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  strategic: { label: "Estratégica", icon: Star, color: "text-blue-500", bg: "bg-blue-500/10" },
} as const;

export function ProposalPanel({
  clientId,
  analysisId,
}: {
  clientId: string;
  analysisId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [proposal, setProposal] = useState<ComposedPlan | null>(null);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCompose = () => {
    startTransition(async () => {
      const { actionComposeProposal } = await import("./plan-actions");
      const res = await actionComposeProposal(clientId, analysisId);
      if (res.ok) {
        setProposal(res.proposal);
        setError(null);
      } else {
        setError(res.error);
      }
    });
  };

  const handleConfirm = () => {
    if (!proposal) return;
    const selectedIds = proposal.selected
      .filter((s) => !removedIds.has(s.id))
      .map((s) => s.id);
    startTransition(async () => {
      const { actionConfirmProposal } = await import("./plan-actions");
      const res = await actionConfirmProposal(clientId, analysisId, selectedIds);
      if (res.ok) {
        setConfirmed(true);
        setTimeout(() => window.location.reload(), 2000);
      } else {
        setError(res.error);
      }
    });
  };

  const toggleRemove = (id: string) => {
    setRemovedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (confirmed) {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
        <p className="text-sm text-emerald-600 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> Plan creado. Recargando...
        </p>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="space-y-3">
        <button
          onClick={handleCompose}
          disabled={isPending}
          className={cn(buttonVariants({ variant: "default" }), "text-sm")}
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Componer propuesta de plan
        </button>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    );
  }

  const activeSelected = proposal.selected.filter((s) => !removedIds.has(s.id));
  const activeMinutes = activeSelected.reduce((sum, s) => sum + s.humanMinutes, 0);

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Seleccionadas" value={`${activeSelected.length}/${proposal.stats.totalCandidates}`} />
        <StatCard label="Minutos humanos" value={`${activeMinutes}/${proposal.stats.humanMinutesCap}`}
          warn={activeMinutes > proposal.stats.humanMinutesCap} />
        <StatCard label="Urgentes" value={String(proposal.stats.urgentCount)} />
        <StatCard label="Excluidas" value={String(proposal.stats.excluded)} />
      </div>

      {/* Mix bars */}
      <div className="space-y-2">
        <MixBar label="Urgentes" current={proposal.stats.urgentCount} total={activeSelected.length} target={0.30} color="bg-red-500" />
        <MixBar label="Easy Wins" current={proposal.stats.easyWinCount} total={activeSelected.length} target={0.50} color="bg-emerald-500" />
        <MixBar label="Estratégicas" current={proposal.stats.strategicCount} total={activeSelected.length} target={0.25} color="bg-blue-500" />
      </div>

      {/* Selected candidates */}
      <div>
        <h3 className="font-mono text-xs font-semibold mb-2">Candidatas seleccionadas</h3>
        <div className="space-y-1.5">
          {proposal.selected.map((s) => {
            const removed = removedIds.has(s.id);
            const cfg = TYPE_CONFIG[s.type];
            const Icon = cfg.icon;
            return (
              <div key={s.id} className={cn(
                "flex items-start gap-2 py-1.5 px-2 rounded border transition-opacity",
                removed ? "opacity-40 border-dashed" : "border-border",
              )}>
                <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", cfg.color)} />
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs">{s.title}</p>
                  <p className="font-mono text-[0.6rem] text-muted-foreground">
                    {s.category} &middot; {s.actionType} &middot; {s.humanMinutes}min HM &middot; {s.selectionReason}
                  </p>
                </div>
                <button
                  onClick={() => toggleRemove(s.id)}
                  className="font-mono text-[0.55rem] text-muted-foreground hover:text-foreground shrink-0"
                >
                  {removed ? "Restaurar" : "Quitar"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Excluded */}
      {proposal.excluded.length > 0 && (
        <details className="group">
          <summary className="font-mono text-xs text-muted-foreground cursor-pointer">
            Excluidas ({proposal.excluded.length})
          </summary>
          <div className="mt-2 space-y-1">
            {proposal.excluded.map((e) => (
              <div key={e.id} className="flex items-start gap-2 py-1 px-2 text-muted-foreground">
                <XCircle className="h-3 w-3 mt-0.5 shrink-0 text-zinc-400" />
                <div className="min-w-0">
                  <p className="font-mono text-[0.6rem]">{e.title}</p>
                  <p className="font-mono text-[0.55rem] text-zinc-500">{e.exclusionReason}</p>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Blocked */}
      {proposal.blocked.length > 0 && (
        <div className="space-y-1">
          <h3 className="font-mono text-xs font-semibold text-amber-500">Bloqueadas</h3>
          {proposal.blocked.map((b) => (
            <div key={b.id} className="flex items-start gap-2 py-1 px-2 border border-amber-500/20 rounded">
              <Shield className="h-3 w-3 mt-0.5 shrink-0 text-amber-500" />
              <div>
                <p className="font-mono text-[0.6rem]">{b.title}</p>
                <p className="font-mono text-[0.55rem] text-amber-500">{b.reason} — {b.remedy}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirm */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={handleConfirm}
          disabled={isPending || activeSelected.length === 0}
          className={cn(buttonVariants({ variant: "default" }), "text-sm")}
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Confirmar plan ({activeSelected.length} tareas)
        </button>
        <button
          onClick={() => setProposal(null)}
          className={cn(buttonVariants({ variant: "outline" }), "text-sm")}
        >
          Recomponer
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

function StatCard({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={cn("border rounded-lg p-2", warn ? "border-red-500/30 bg-red-500/5" : "border-border")}>
      <p className="font-mono text-[0.55rem] text-muted-foreground">{label}</p>
      <p className={cn("font-mono text-sm font-semibold", warn && "text-red-500")}>{value}</p>
    </div>
  );
}

function MixBar({ label, current, total, target, color }: {
  label: string; current: number; total: number; target: number; color: string;
}) {
  const actual = total > 0 ? current / total : 0;
  const targetPct = (target * 100).toFixed(0);
  const actualPct = (actual * 100).toFixed(0);
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[0.55rem] text-muted-foreground w-20 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-muted rounded-full relative">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.min(actual * 100, 100)}%` }} />
        <div className="absolute top-0 h-full w-px bg-foreground/30" style={{ left: `${target * 100}%` }} />
      </div>
      <span className="font-mono text-[0.55rem] text-muted-foreground w-16 shrink-0 text-right">{actualPct}% / {targetPct}%</span>
    </div>
  );
}
