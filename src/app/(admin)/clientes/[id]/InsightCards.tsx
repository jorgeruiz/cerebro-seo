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
  WARNING:     { icon: AlertCircle, bg: "bg-red-50",    border: "border-red-100",    iconColor: "text-red-500",    label: "Alerta" },
  OPPORTUNITY: { icon: TrendingUp,  bg: "bg-green-50",  border: "border-green-100",  iconColor: "text-green-500",  label: "Oportunidad" },
  WIN:         { icon: Trophy,      bg: "bg-yellow-50", border: "border-yellow-100", iconColor: "text-yellow-500", label: "Logro" },
  INFO:        { icon: Info,        bg: "bg-blue-50",   border: "border-blue-100",   iconColor: "text-blue-500",   label: "Info" },
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border border-red-200",
  high:     "bg-red-50 text-red-600 border border-red-100",
  medium:   "bg-amber-50 text-amber-700 border border-amber-200",
  low:      "bg-blue-50 text-blue-600 border border-blue-100",
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
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${severityClass}`}>
              {insight.severity.toUpperCase()}
            </span>
            <span className="text-[10px] text-gray-400 font-medium">{config.label}</span>
            <span className="text-[10px] text-gray-300 ml-auto">{relativeTime(insight.generatedAt)}</span>
          </div>
          <p className="text-sm font-medium text-gray-900 leading-snug">{insight.title}</p>
          <p className="text-xs text-gray-600 mt-1 leading-relaxed line-clamp-3">
            {insight.description}
          </p>
          {insight.suggestedAction && (
            <p className="text-xs font-medium text-gray-700 mt-2">
              → {insight.suggestedAction}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-black/5">
        <Link
          href={`/clientes/${clientId}/insights/${insight.id}`}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          Ver detalle <ArrowRight className="h-3 w-3" />
        </Link>
        <div className="flex-1" />
        <button
          onClick={handleResolve}
          disabled={loading !== null}
          className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 disabled:opacity-50 transition-colors"
        >
          <CheckCheck className="h-3 w-3" />
          {loading === "resolve" ? "..." : "Resuelto"}
        </button>
        <button
          onClick={handleIgnore}
          disabled={loading !== null}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors"
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
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-5 text-center">
        <p className="text-sm text-gray-500 font-medium">Insights proactivos en fase piloto</p>
        <p className="text-xs text-gray-400 mt-1">Disponibles próximamente para este cliente.</p>
      </div>
    );
  }

  if (insights.length === 0) {
    return (
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-5 text-center">
        <p className="text-sm text-gray-500 font-medium">Sin insights pendientes</p>
        <p className="text-xs text-gray-400 mt-1">El agente revisa diariamente a las 6 AM.</p>
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
