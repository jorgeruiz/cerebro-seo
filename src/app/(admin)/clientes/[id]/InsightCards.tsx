"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, TrendingUp, Trophy, Info, CheckCheck, EyeOff, ArrowRight } from "lucide-react";
import { resolveInsight, ignoreInsight } from "./actions";

type InsightType = "OPPORTUNITY" | "WARNING" | "WIN" | "INFO";

interface Insight {
  id: string;
  type: InsightType;
  severity: string;
  title: string;
  description: string;
  suggestedAction?: string | null;
  generatedAt: Date;
}

interface InsightCardsProps {
  insights: Insight[];
  clientId: string;
  isPilotClient: boolean;
}

const TYPE_CONFIG: Record<
  InsightType,
  { icon: typeof AlertCircle; bg: string; border: string; iconColor: string; label: string }
> = {
  WARNING:     { icon: AlertCircle, bg: "bg-destructive/10", border: "border-destructive/20", iconColor: "text-destructive",  label: "Alerta" },
  OPPORTUNITY: { icon: TrendingUp,  bg: "bg-primary/10",     border: "border-ds-gd",          iconColor: "text-ds-green",     label: "Oportunidad" },
  WIN:         { icon: Trophy,      bg: "bg-ds-yellow/10",   border: "border-ds-yellow/20",   iconColor: "text-ds-yellow",    label: "Logro" },
  INFO:        { icon: Info,        bg: "bg-ds-blue/10",     border: "border-ds-blue/20",     iconColor: "text-ds-blue",      label: "Info" },
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-destructive/15 text-destructive border border-destructive/30",
  high:     "bg-destructive/10 text-destructive border border-destructive/20",
  medium:   "bg-ds-yellow/10 text-ds-yellow border border-ds-yellow/30",
  low:      "bg-ds-blue/10 text-ds-blue border border-ds-blue/20",
};

function relativeTime(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `hace ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} día${days !== 1 ? "s" : ""}`;
}

function InsightCard({ insight, clientId }: { insight: Insight; clientId: string }) {
  const [loading, setLoading] = useState<"resolve" | "ignore" | null>(null);
  const router = useRouter();
  const config = TYPE_CONFIG[insight.type] ?? TYPE_CONFIG.INFO;
  const Icon = config.icon;
  const severityClass = SEVERITY_BADGE[insight.severity.toLowerCase()] ?? SEVERITY_BADGE.low;

  async function handleResolve() {
    setLoading("resolve");
    await resolveInsight(insight.id);
    router.refresh();
  }

  async function handleIgnore() {
    setLoading("ignore");
    await ignoreInsight(insight.id);
    router.refresh();
  }

  return (
    <div className={`rounded-xl border ${config.border} ${config.bg} p-4 flex flex-col gap-3`}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.iconColor}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${severityClass}`}>
              {insight.severity}
            </span>
            <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wide">{config.label}</span>
            <span className="text-[10px] text-muted-foreground/60 ml-auto font-mono">{relativeTime(insight.generatedAt)}</span>
          </div>
          <p className="text-sm font-medium text-foreground leading-snug">{insight.title}</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-3">
            {insight.description}
          </p>
          {insight.suggestedAction && (
            <p className="text-xs font-medium text-ds-dim mt-2">
              → {insight.suggestedAction}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-border/50">
        <Link
          href={`/clientes/${clientId}/insights/${insight.id}`}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Ver detalle <ArrowRight className="h-3 w-3" />
        </Link>
        <div className="flex-1" />
        <button
          onClick={handleResolve}
          disabled={loading !== null}
          className="flex items-center gap-1 text-xs text-ds-green hover:text-primary disabled:opacity-50 transition-colors"
        >
          <CheckCheck className="h-3 w-3" />
          {loading === "resolve" ? "..." : "Resuelto"}
        </button>
        <button
          onClick={handleIgnore}
          disabled={loading !== null}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
        >
          <EyeOff className="h-3 w-3" />
          {loading === "ignore" ? "..." : "Ignorar"}
        </button>
      </div>
    </div>
  );
}

export function InsightCards({ insights, clientId, isPilotClient }: InsightCardsProps) {
  if (!isPilotClient) {
    return (
      <div className="rounded-xl border border-border bg-muted/50 p-5 text-center">
        <p className="text-sm text-muted-foreground font-medium">Insights proactivos en fase piloto</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Disponibles próximamente para este cliente.</p>
      </div>
    );
  }

  if (insights.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-muted/50 p-5 text-center">
        <p className="text-sm text-muted-foreground font-medium">Sin insights pendientes</p>
        <p className="text-xs text-muted-foreground/60 mt-1">El agente revisa diariamente a las 6 AM.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {insights.map((insight) => (
        <InsightCard key={insight.id} insight={insight} clientId={clientId} />
      ))}
    </div>
  );
}
