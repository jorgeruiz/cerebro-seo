"use client";

import { useState, useTransition } from "react";
import {
  FlaskConical,
  Lightbulb,
  Brain,
  Loader2,
  DollarSign,
  TrendingUp,
  Users,
  FileText,
  Sparkles,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { actionRunResearch, actionGetResearchEstimate } from "./actions";
import type { ResearchData, ResearchEstimate } from "@/server/research/types";

// ── Types ───────────────────────────────────────────────────────────────────

type TabId = "oportunidades" | "keyword-ideas" | "aeo-research";

interface Props {
  clientId: string;
  domain: string;
  latestReport: {
    id: string;
    data: ResearchData;
    apiCost: number;
    claudeCost: number;
    createdAt: Date;
  } | null;
  historyCount: number;
  isAdmin: boolean;
}

// ── Tab navigation ──────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string; icon: typeof FlaskConical }[] = [
  { id: "oportunidades", label: "Oportunidades", icon: FlaskConical },
  { id: "keyword-ideas", label: "Keyword Ideas", icon: Lightbulb },
  { id: "aeo-research", label: "AEO Research", icon: Brain },
];

// ── Component ───────────────────────────────────────────────────────────────

export function ResearchTabs({ clientId, domain, latestReport, historyCount, isAdmin }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("oportunidades");
  const [report, setReport] = useState(latestReport);
  const [isPending, startTransition] = useTransition();
  const [estimate, setEstimate] = useState<ResearchEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const est = await actionGetResearchEstimate();
      setEstimate(est);
    });
  }

  function confirmGenerate() {
    setError(null);
    setEstimate(null);
    startTransition(async () => {
      const result = await actionRunResearch(clientId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Reload page to pick up fresh data
      window.location.reload();
    });
  }

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                if (tab.id === "keyword-ideas") {
                  window.location.href = `/clientes/${clientId}/keyword-ideas`;
                  return;
                }
                if (tab.id === "aeo-research") {
                  window.location.href = `/clientes/${clientId}/aeo-research`;
                  return;
                }
                setActiveTab(tab.id);
              }}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 font-mono text-[0.75rem] border-b-2 transition-colors -mb-px",
                isActive
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "oportunidades" && (
        <div className="space-y-6">
          {/* Generate button */}
          {isAdmin && (
            <div className="flex items-center gap-3 flex-wrap">
              {!estimate && !isPending && (
                <button
                  onClick={handleGenerate}
                  className={cn(
                    "inline-flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-xs",
                    "bg-foreground text-background hover:bg-foreground/90 transition-colors"
                  )}
                >
                  <FlaskConical className="h-3.5 w-3.5" />
                  Generar análisis
                </button>
              )}

              {estimate && !isPending && (
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="font-mono text-xs text-muted-foreground border border-border rounded-lg px-3 py-2">
                    <DollarSign className="h-3 w-3 inline mr-1" />
                    Costo estimado: <strong className="text-foreground">${estimate.estimatedCost.toFixed(2)} USD</strong>
                    <span className="text-muted-foreground/60 ml-2">
                      ({estimate.breakdown.strikingDistance} + {estimate.breakdown.competitors} + {estimate.breakdown.competitorPages} + {estimate.breakdown.suggestions})
                    </span>
                  </div>
                  <button
                    onClick={confirmGenerate}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-xs bg-ds-green text-white hover:bg-ds-green/90 transition-colors"
                  >
                    Confirmar y ejecutar
                  </button>
                  <button
                    onClick={() => setEstimate(null)}
                    className="font-mono text-xs text-muted-foreground hover:text-foreground"
                  >
                    Cancelar
                  </button>
                </div>
              )}

              {isPending && (
                <div className="inline-flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Generando análisis... esto puede tardar 30-60 segundos
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="font-mono text-xs text-ds-red bg-ds-red/10 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Report content */}
          {report ? (
            <ResearchReportView data={report.data} createdAt={report.createdAt} cost={report.apiCost + report.claudeCost} />
          ) : (
            <div className="text-center py-16 text-muted-foreground">
              <FlaskConical className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-mono text-sm">Sin análisis de oportunidades</p>
              <p className="font-mono text-xs mt-1">
                Genera un análisis para ver keywords en striking distance, competidores orgánicos y sugerencias.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Report view ─────────────────────────────────────────────────────────────

function ResearchReportView({
  data,
  createdAt,
  cost,
}: {
  data: ResearchData;
  createdAt: Date;
  cost: number;
}) {
  return (
    <div className="space-y-8">
      {/* Metadata */}
      <div className="flex items-center gap-4 font-mono text-[0.7rem] text-muted-foreground">
        <span>
          {new Date(createdAt).toLocaleDateString("es-MX", {
            day: "2-digit",
            month: "short",
            year: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span>${cost.toFixed(4)} USD</span>
        <span>{data.domain}</span>
      </div>

      {/* Striking distance */}
      <CollapsibleSection
        title="Keywords en Striking Distance"
        icon={TrendingUp}
        count={data.strikingDistance.length}
        defaultOpen
      >
        {data.strikingDistance.length > 0 ? (
          <div className="rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-xs min-w-[600px]">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">Keyword</th>
                  <th className="text-right px-4 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">Pos</th>
                  <th className="text-right px-4 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">Vol</th>
                  <th className="text-center px-4 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">KD</th>
                  <th className="text-left px-4 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground hidden lg:table-cell">URL</th>
                </tr>
              </thead>
              <tbody>
                {data.strikingDistance.map((kw, i) => (
                  <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-mono text-[0.8rem]">{kw.keyword}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[0.75rem]">#{kw.position}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[0.75rem]">{fmtVol(kw.searchVolume)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={cn("font-mono text-[0.7rem] px-1.5 py-0.5 rounded border", kdBadge(kw.keywordDifficulty))}>
                        {kw.keywordDifficulty ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[0.7rem] text-muted-foreground truncate max-w-[200px] hidden lg:table-cell">
                      {kw.url ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="font-mono text-xs text-muted-foreground py-4">Sin keywords en striking distance.</p>
        )}
      </CollapsibleSection>

      {/* Competitors */}
      <CollapsibleSection
        title="Competidores Orgánicos"
        icon={Users}
        count={data.competitors.length}
        defaultOpen
      >
        <div className="space-y-4">
          {data.competitors.map((comp, i) => (
            <div key={i} className="border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-muted/30 flex items-center justify-between">
                <div>
                  <span className="font-mono text-sm font-semibold">{comp.domain}</span>
                  <span className="font-mono text-[0.7rem] text-muted-foreground ml-3">
                    {comp.intersections} keywords comunes · tráfico est. {fmtVol(comp.estimatedTraffic)}
                  </span>
                </div>
              </div>
              {comp.topPages.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[500px]">
                    <thead>
                      <tr className="border-t border-border bg-muted/20">
                        <th className="text-left px-4 py-2 font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">URL</th>
                        <th className="text-left px-4 py-2 font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">Keyword principal</th>
                        <th className="text-right px-4 py-2 font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">Tráfico</th>
                        <th className="text-right px-4 py-2 font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">Keywords</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comp.topPages.map((page, j) => (
                        <tr key={j} className="border-t border-border hover:bg-muted/10">
                          <td className="px-4 py-2 font-mono text-[0.7rem] text-muted-foreground truncate max-w-[250px]">{page.url}</td>
                          <td className="px-4 py-2 font-mono text-[0.75rem]">{page.mainKeyword ?? "—"}</td>
                          <td className="px-4 py-2 text-right font-mono text-[0.75rem]">{fmtVol(page.estimatedTraffic)}</td>
                          <td className="px-4 py-2 text-right font-mono text-[0.75rem]">{page.keywordCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Suggestions */}
      {data.suggestions && data.suggestions.length > 0 && (
        <CollapsibleSection
          title="Sugerencias"
          icon={Sparkles}
          count={data.suggestions.length}
          defaultOpen
        >
          <div className="space-y-3">
            {data.suggestions.map((s, i) => (
              <div key={i} className="border border-border rounded-xl px-4 py-3 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "font-mono text-[0.65rem] px-1.5 py-0.5 rounded border uppercase tracking-wider",
                      s.tipo === "quick-win" ? "text-ds-green bg-ds-green/10 border-ds-green/30"
                        : s.tipo === "contenido-nuevo" ? "text-ds-yellow bg-ds-yellow/10 border-ds-yellow/30"
                        : "text-blue-400 bg-blue-400/10 border-blue-400/30"
                    )}>
                      {s.tipo}
                    </span>
                    <span className="font-mono text-sm font-semibold">{s.titulo}</span>
                  </div>
                  <span className="font-mono text-[0.65rem] text-muted-foreground shrink-0">P{s.prioridad}</span>
                </div>
                <p className="font-mono text-[0.75rem] text-muted-foreground">{s.descripcion}</p>
                {s.targetUrl && (
                  <p className="font-mono text-[0.7rem] text-foreground/60">
                    URL: <span className="text-foreground">{s.targetUrl}</span>
                  </p>
                )}
                {s.keywords.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {s.keywords.map((kw, j) => (
                      <span key={j} className="font-mono text-[0.65rem] bg-muted px-1.5 py-0.5 rounded">{kw}</span>
                    ))}
                  </div>
                )}
                <p className="font-mono text-[0.65rem] text-muted-foreground italic">{s.razon}</p>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  icon: Icon,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: typeof TrendingUp;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full text-left group"
      >
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <Icon className="h-4 w-4 text-ds-yellow" />
        <span className="font-display font-bold text-base">{title}</span>
        <span className="font-mono text-[0.7rem] text-muted-foreground">({count})</span>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  );
}

function fmtVol(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString("es-MX");
}

function kdBadge(kd: number | null) {
  if (kd == null) return "text-muted-foreground bg-muted border-border";
  if (kd <= 30) return "text-ds-green bg-ds-green/10 border-ds-green/30";
  if (kd <= 60) return "text-ds-yellow bg-ds-yellow/10 border-ds-yellow/30";
  return "text-ds-red bg-ds-red/10 border-ds-red/30";
}
