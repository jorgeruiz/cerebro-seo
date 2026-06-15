"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCheck, EyeOff, ArrowRight, History } from "lucide-react";
import { resolveInsight, ignoreInsight } from "./actions";
import { ConclusionCard } from "@/components/ui-darkui";
import type { ConclusionVariant } from "@/components/ui-darkui";

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

const TYPE_VARIANT_MAP: Record<InsightType, ConclusionVariant> = {
  WARNING:     "error",
  OPPORTUNITY: "success",
  WIN:         "success",
  INFO:        "info",
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
    <ConclusionCard
      variant={TYPE_VARIANT_MAP[insight.type] ?? "info"}
      title={insight.title}
    >
      <p className="mb-1">{insight.description}</p>
      {insight.suggestedAction && (
        <p className="font-mono text-[0.78rem] mt-1">→ {insight.suggestedAction}</p>
      )}
      <div className="flex items-center gap-3 mt-3 pt-2 border-t border-border/20">
        <Link
          href={`/clientes/${clientId}/insights/${insight.id}`}
          className="flex items-center gap-1 font-mono text-[0.75rem] text-muted-foreground hover:text-foreground transition-colors"
        >
          Ver detalle <ArrowRight className="h-2.5 w-2.5" />
        </Link>
        <div className="flex-1" />
        <button
          onClick={handleResolve}
          disabled={loading !== null}
          className="flex items-center gap-1 font-mono text-[0.75rem] text-ds-green hover:text-primary disabled:opacity-50 transition-colors"
        >
          <CheckCheck className="h-3 w-3" />
          {loading === "resolve" ? "..." : "Resuelto"}
        </button>
        <button
          onClick={handleIgnore}
          disabled={loading !== null}
          className="flex items-center gap-1 font-mono text-[0.75rem] text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
        >
          <EyeOff className="h-3 w-3" />
          {loading === "ignore" ? "..." : "Ignorar"}
        </button>
      </div>
      <div className="font-mono text-[0.66rem] text-muted-foreground/50 mt-1">
        {relativeTime(insight.generatedAt)}
      </div>
    </ConclusionCard>
  );
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function InsightCards({ insights, clientId, isPilotClient }: InsightCardsProps) {
  const sorted = [...insights].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
  );

  if (!isPilotClient) {
    return (
      <div className="rounded-lg border border-border bg-muted/50 p-5 text-center">
        <p className="text-sm text-muted-foreground font-medium">Insights proactivos en fase piloto</p>
        <p className="font-mono text-[0.72rem] text-muted-foreground/60 mt-1">Disponibles próximamente para este cliente.</p>
      </div>
    );
  }

  if (insights.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/50 p-5 text-center">
        <p className="text-sm text-muted-foreground font-medium">Sin insights pendientes</p>
        <p className="font-mono text-[0.72rem] text-muted-foreground/60 mt-1">El agente revisa diariamente a las 6 AM.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sorted.map((insight) => (
          <InsightCard key={insight.id} insight={insight} clientId={clientId} />
        ))}
      </div>
      <div className="flex justify-end">
        <Link
          href={`/clientes/${clientId}/insights`}
          className="flex items-center gap-1.5 font-mono text-[0.72rem] text-muted-foreground hover:text-foreground transition-colors"
        >
          <History className="h-3 w-3" />
          Ver historial completo
        </Link>
      </div>
    </div>
  );
}
