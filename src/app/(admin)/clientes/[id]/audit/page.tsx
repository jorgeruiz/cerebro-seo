export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Clock,
  Globe,
  FileSearch,
  BarChart3,
  RefreshCw,
  ExternalLink,
  Bot,
  ShieldCheck,
  ShieldAlert,
  MinusCircle,
} from "lucide-react";
import { SectionHeader, InfoTooltip, SectionIntro } from "@/components/ui-darkui";
import { AuditScoreChart } from "./AuditScoreChart";
import type { AuditHistoryPoint } from "./AuditScoreChart";
import { AuditIssueClipboardButton } from "./AuditIssueClipboardButton";

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getAuditData(clientId: string, auditId?: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      domain: true,
      sites: { take: 1, select: { id: true, url: true } },
      // Para historial: todos los audits completados, máximo 24
      audits: {
        where: { status: { in: ["completed", "failed", "running"] } },
        orderBy: { date: "desc" },
        take: 24,
        select: {
          id: true, date: true, type: true, status: true, error: true,
          startedAt: true, completedAt: true,
          scoreOverall: true, scoreTechnical: true, scorePerformance: true,
          scoreContent: true, seoScore: true, accessibilityScore: true, aeoScore: true,
          pagesCrawled: true, pagesIndexable: true, brokenPages: true, redirectPages: true,
          cwvData: true,
          // Issues solo del audit seleccionado (se incluyen abajo)
        },
      },
    },
  });

  if (!client) return null;

  // Audit seleccionado: por param o el más reciente
  const targetId = auditId ?? client.audits[0]?.id;
  const selectedAuditBase = client.audits.find((a) => a.id === targetId) ?? client.audits[0] ?? null;

  // Cargar issues del audit seleccionado por separado
  const auditWithIssues = selectedAuditBase
    ? await prisma.audit.findUnique({
        where: { id: selectedAuditBase.id },
        include: {
          auditIssues: {
            orderBy: [{ severity: "asc" }, { count: "desc" }],
          },
        },
      })
    : null;

  return { client, allAudits: client.audits, selectedAudit: auditWithIssues };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  critical: { label: "Crítico",    color: "text-destructive",    bg: "bg-destructive/10",   border: "border-destructive/30",   icon: XCircle },
  high:     { label: "Alto",       color: "text-ds-orange",      bg: "bg-ds-orange/10",     border: "border-ds-orange/30",     icon: AlertTriangle },
  medium:   { label: "Medio",      color: "text-ds-yellow",      bg: "bg-ds-yellow/10",     border: "border-ds-yellow/30",     icon: AlertTriangle },
  low:      { label: "Bajo",       color: "text-ds-blue",        bg: "bg-ds-blue/10",       border: "border-ds-blue/30",       icon: Info },
  info:     { label: "Info",       color: "text-muted-foreground", bg: "bg-muted",           border: "border-border",           icon: Info },
} as const;

const CATEGORY_LABEL: Record<string, string> = {
  technical:     "Técnico",
  performance:   "Performance",
  content:       "Contenido",
  seo:           "SEO",
  accessibility: "Accesibilidad",
  aeo:           "AEO",
};

function ScoreBadge({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const color =
    score >= 80 ? "text-ds-green bg-primary/10 border-ds-gd"
    : score >= 60 ? "text-ds-yellow bg-ds-yellow/10 border-ds-yellow/40"
    : "text-destructive bg-destructive/10 border-destructive/30";

  const sizeClass =
    size === "lg" ? "text-3xl font-bold px-4 py-2"
    : size === "sm" ? "text-xs font-semibold px-2 py-0.5"
    : "text-xl font-bold px-3 py-1";

  return (
    <span className={`inline-flex items-center rounded-lg border font-mono ${color} ${sizeClass}`}>
      {score}
    </span>
  );
}

function fmtDate(d: Date | string): string {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(d));
}

function fmtShort(d: Date | string): string {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(new Date(d));
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { auditId?: string };
}) {
  await getSession(); // auth check — redirect handled by middleware

  const data = await getAuditData(params.id, searchParams.auditId);
  if (!data) notFound();

  const { client, allAudits, selectedAudit } = data;
  const site = client.sites[0];

  // Score history para la gráfica (cronológico)
  const completedAudits = [...allAudits]
    .filter((a) => a.status === "completed")
    .reverse();

  const chartData: AuditHistoryPoint[] = completedAudits.map((a) => ({
    date: fmtShort(a.date),
    overall: a.scoreOverall,
    technical: a.scoreTechnical,
    performance: a.scorePerformance,
    content: a.scoreContent,
  }));

  // Issues del audit seleccionado
  const issuesBySeverity = selectedAudit?.auditIssues.reduce(
    (acc, issue) => {
      const sev = issue.severity as keyof typeof SEVERITY_CONFIG;
      if (!acc[sev]) acc[sev] = [];
      acc[sev].push(issue);
      return acc;
    },
    {} as Record<string, typeof selectedAudit.auditIssues>
  ) ?? {};

  const totalIssues = selectedAudit?.auditIssues.length ?? 0;
  const criticalCount = issuesBySeverity["critical"]?.length ?? 0;
  const highCount = issuesBySeverity["high"]?.length ?? 0;

  const cwvData = selectedAudit?.cwvData as {
    mobile?: { lcp?: number; fcp?: number; cls?: number; tbt?: number };
  } | null;

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-border bg-background px-8 py-5">
        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/clientes/${client.id}`}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {client.name}
          </Link>
          <span className="text-border">/</span>
          <div className="flex items-center gap-2">
            <FileSearch className="h-3.5 w-3.5 text-destructive" />
            <span className="text-foreground/70">Site Audit</span>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 lg:p-8 space-y-8">

        <SectionIntro>
          Análisis técnico del sitio basado en crawl automático semanal. Los issues críticos y altos son los que más impactan el posicionamiento.
          Los Core Web Vitals (LCP, CLS) son factores de ranking directo de Google — prioriza los que estén en rojo.
        </SectionIntro>

        {/* Sin audits */}
        {allAudits.length === 0 && (
          <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center gap-4 text-center">
            <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center">
              <FileSearch className="h-7 w-7 text-muted-foreground/40" />
            </div>
            <div>
              <p className="text-base font-semibold text-foreground">Sin auditorías todavía</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                El primer audit rápido corre automáticamente el próximo miércoles a las 2 AM.
                El audit completo corre el 1ro de cada mes.
              </p>
              <p className="text-xs text-muted-foreground/60 mt-3 font-mono">
                Para disparar manualmente:{" "}
                <code className="bg-muted px-1.5 py-0.5 rounded">tsx scripts/trigger-audit.ts {client.id}</code>
              </p>
            </div>
          </div>
        )}

        {/* Historial de scores — solo si hay 2+ audits completados */}
        {chartData.length >= 2 && (
          <section>
            <SectionHeader>Evolución de scores</SectionHeader>
            <div className="bg-card rounded-xl border border-border p-5">
              <AuditScoreChart data={chartData} />
            </div>
          </section>
        )}

        {/* Selector de audits */}
        {allAudits.length > 0 && (
          <section>
            <SectionHeader>Historial de auditorías</SectionHeader>
            <div className="flex flex-wrap gap-2">
              {allAudits.map((a) => {
                const isSelected = a.id === selectedAudit?.id;
                const statusDot =
                  a.status === "completed" ? "bg-ds-green"
                  : a.status === "running" ? "bg-ds-blue animate-pulse"
                  : "bg-destructive";
                return (
                  <Link
                    key={a.id}
                    href={`/clientes/${client.id}/audit?auditId=${a.id}`}
                    className={[
                      "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-mono transition-all",
                      isSelected
                        ? "bg-primary/10 border-primary/40 text-foreground"
                        : "bg-card border-border text-muted-foreground hover:border-primary/30 hover:text-foreground",
                    ].join(" ")}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusDot}`} />
                    <span>{fmtShort(a.date)}</span>
                    <span className="text-muted-foreground/50 uppercase tracking-wide text-[9px]">
                      {a.type === "quick" ? "rápido" : "completo"}
                    </span>
                    {a.status === "completed" && (
                      <span className={[
                        "font-bold tabular-nums",
                        a.scoreOverall >= 80 ? "text-ds-green"
                        : a.scoreOverall >= 60 ? "text-ds-yellow"
                        : "text-destructive",
                      ].join(" ")}>
                        {a.scoreOverall}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* Audit running */}
        {selectedAudit?.status === "running" && (
          <div className="bg-ds-blue/10 border border-ds-blue/30 rounded-xl p-5 flex items-center gap-3">
            <RefreshCw className="h-5 w-5 text-ds-blue animate-spin" />
            <div>
              <p className="text-sm font-medium text-foreground">Auditoría en progreso...</p>
              <p className="text-xs text-muted-foreground">
                Iniciada el {fmtDate(selectedAudit.startedAt)}. Recarga en unos minutos.
              </p>
            </div>
          </div>
        )}

        {/* Audit failed */}
        {selectedAudit?.status === "failed" && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-5">
            <p className="text-sm font-medium text-destructive">La auditoría falló</p>
            {selectedAudit.error && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">{selectedAudit.error}</p>
            )}
            <p className="text-xs text-muted-foreground/60 mt-2">Se reintentará en el próximo ciclo.</p>
          </div>
        )}

        {/* Audit completado */}
        {selectedAudit?.status === "completed" && (
          <>
            {/* Scores */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <SectionHeader>Puntuación</SectionHeader>
                <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {selectedAudit.type === "quick" ? "Rápido" : "Completo"} ·{" "}
                  {fmtDate(selectedAudit.completedAt ?? selectedAudit.date)}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: "Overall",       score: selectedAudit.scoreOverall,     highlight: true },
                  { label: "Técnico",       score: selectedAudit.scoreTechnical },
                  { label: "Performance",   score: selectedAudit.scorePerformance },
                  { label: "Contenido",     score: selectedAudit.scoreContent },
                  { label: "SEO",           score: selectedAudit.seoScore ?? 0 },
                  { label: "Accesibilidad", score: selectedAudit.accessibilityScore ?? 0 },
                ].map(({ label, score, highlight }) => (
                  <div
                    key={label}
                    className={`bg-card rounded-xl border p-4 flex flex-col items-center gap-2 ${
                      highlight ? "border-primary/40 ring-1 ring-primary/10" : "border-border"
                    }`}
                  >
                    <ScoreBadge score={score} size={highlight ? "lg" : "md"} />
                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">{label}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Stats del crawl */}
            <section>
              <SectionHeader>Estadísticas del sitio</SectionHeader>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Páginas analizadas", value: selectedAudit.pagesCrawled, icon: Globe, bad: false },
                  { label: "Indexables",          value: selectedAudit.pagesIndexable, icon: CheckCircle2, good: true },
                  { label: "Con error (4xx/5xx)", value: selectedAudit.brokenPages, icon: XCircle, bad: selectedAudit.brokenPages > 0 },
                  { label: "Redirecciones",       value: selectedAudit.redirectPages, icon: RefreshCw, bad: false },
                ].map(({ label, value, icon: Icon, good, bad }) => (
                  <div key={label} className="bg-card rounded-xl border border-border p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`h-4 w-4 ${good ? "text-ds-green" : bad && value > 0 ? "text-destructive" : "text-muted-foreground"}`} />
                      <span className="text-xs text-muted-foreground">{label}</span>
                    </div>
                    <p className={`text-2xl font-bold font-mono ${bad && value > 0 ? "text-destructive" : "text-foreground"}`}>
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {/* CWV */}
            {cwvData?.mobile && (
              <section>
                <SectionHeader>Core Web Vitals · Mobile</SectionHeader>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "LCP", value: cwvData.mobile.lcp, unit: "ms", good: 2500, poor: 4000, tooltip: "Largest Contentful Paint: tiempo que tarda en renderizarse el elemento visual más grande. Bueno: < 2.5s, Necesita mejora: 2.5–4s, Pobre: > 4s." },
                    { label: "FCP", value: cwvData.mobile.fcp, unit: "ms", good: 1800, poor: 3000, tooltip: "First Contentful Paint: tiempo hasta que el primer contenido aparece en pantalla. Bueno: < 1.8s." },
                    { label: "CLS", value: cwvData.mobile.cls, unit: "",   good: 0.1,  poor: 0.25, decimals: 3, tooltip: "Cumulative Layout Shift: cuánto 'salta' el contenido mientras carga. Bueno: < 0.1, Pobre: > 0.25. Afecta la experiencia del usuario." },
                    { label: "TBT", value: cwvData.mobile.tbt, unit: "ms", good: 200,  poor: 600,  tooltip: "Total Blocking Time: tiempo total en que el hilo principal estuvo bloqueado durante la carga. Bueno: < 200ms." },
                  ]
                    .filter((m) => m.value !== undefined)
                    .map(({ label, value, unit, good, poor, decimals, tooltip }) => {
                      const v = value ?? 0;
                      const status = v <= good ? "good" : v <= poor ? "needs" : "poor";
                      const colors = {
                        good:  "text-ds-green  bg-primary/10  border-ds-gd",
                        needs: "text-ds-yellow bg-ds-yellow/10 border-ds-yellow/40",
                        poor:  "text-destructive bg-destructive/10 border-destructive/30",
                      }[status];
                      return (
                        <div key={label} className={`rounded-xl border p-4 ${colors}`}>
                          <p className="text-[10px] font-mono uppercase tracking-wide mb-1 flex items-center gap-1">
                            {label}
                            <InfoTooltip>{tooltip}</InfoTooltip>
                          </p>
                          <p className="text-xl font-bold font-mono">
                            {decimals ? v.toFixed(decimals) : v.toLocaleString("es-MX")}
                            {unit && <span className="text-sm font-normal ml-1">{unit}</span>}
                          </p>
                        </div>
                      );
                    })}
                </div>
              </section>
            )}

            {/* AEO Readiness */}
            {(() => {
              const aeoScore = selectedAudit.aeoScore;
              const aeoIssues = selectedAudit.auditIssues.filter((i) => i.category === "aeo");

              if (aeoScore === null || aeoScore === undefined) {
                return (
                  <section>
                    <SectionHeader>Legibilidad para IA (AEO)</SectionHeader>
                    <div className="bg-card rounded-xl border border-border p-6 flex items-center gap-3">
                      <Bot className="h-5 w-5 text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground">
                        Disponible tras la próxima auditoría completa.
                      </p>
                    </div>
                  </section>
                );
              }

              const AEO_STATUS_ICONS = {
                pass: { icon: CheckCircle2, color: "text-ds-green" },
                fail: { icon: XCircle, color: "text-destructive" },
                warn: { icon: AlertTriangle, color: "text-ds-yellow" },
                skipped: { icon: MinusCircle, color: "text-muted-foreground" },
              } as const;

              const scoreColor =
                aeoScore >= 80 ? "text-ds-green bg-primary/10 border-ds-gd"
                : aeoScore >= 60 ? "text-ds-yellow bg-ds-yellow/10 border-ds-yellow/40"
                : "text-destructive bg-destructive/10 border-destructive/30";

              const scoreIcon = aeoScore >= 80 ? ShieldCheck : ShieldAlert;
              const ScoreIcon = scoreIcon;

              return (
                <section>
                  <SectionHeader>Legibilidad para IA (AEO)</SectionHeader>
                  <div className="space-y-3">
                    {/* Score card */}
                    <div className={`rounded-xl border p-5 flex items-center gap-4 ${scoreColor}`}>
                      <ScoreIcon className="h-8 w-8 shrink-0" />
                      <div>
                        <p className="text-2xl font-bold font-mono">{aeoScore}<span className="text-sm font-normal ml-1">/100</span></p>
                        <p className="text-xs mt-0.5 opacity-80">
                          {aeoScore >= 80
                            ? "El sitio es legible por crawlers de IA."
                            : aeoScore >= 60
                              ? "Legibilidad parcial — hay oportunidades de mejora."
                              : "El sitio tiene problemas serios de legibilidad para IA."}
                        </p>
                      </div>
                    </div>

                    {/* Check list */}
                    {aeoIssues.length > 0 && (
                      <div className="bg-card rounded-xl border border-border p-4 space-y-2">
                        {aeoIssues.map((issue) => {
                          const issueData = issue.data as { checkId?: string; fix?: string } | null;
                          const checkStatus = issue.severity === "critical" || issue.severity === "high" ? "fail" : "warn";
                          const statusCfg = AEO_STATUS_ICONS[checkStatus];
                          const StatusIcon = statusCfg.icon;

                          return (
                            <div key={issue.id} className="flex items-start gap-3 p-2">
                              <StatusIcon className={`h-4 w-4 mt-0.5 shrink-0 ${statusCfg.color}`} />
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground">{issue.title}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">{issue.description}</p>
                                {issueData?.fix && (
                                  <p className="text-xs text-muted-foreground/70 mt-1 italic">{issueData.fix}</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {aeoIssues.length === 0 && aeoScore >= 80 && (
                      <div className="bg-primary/10 border border-ds-gd rounded-xl p-5 flex items-center gap-3">
                        <CheckCircle2 className="h-5 w-5 text-ds-green" />
                        <p className="text-sm text-foreground">Todos los checks AEO pasaron correctamente.</p>
                      </div>
                    )}
                  </div>
                </section>
              );
            })()}

            {/* Issues */}
            {totalIssues > 0 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <SectionHeader>Problemas detectados ({totalIssues})</SectionHeader>
                  <div className="flex items-center gap-2">
                    {criticalCount > 0 && (
                      <span className="text-[10px] font-mono bg-destructive/10 text-destructive border border-destructive/30 px-2 py-0.5 rounded-full">
                        {criticalCount} críticos
                      </span>
                    )}
                    {highCount > 0 && (
                      <span className="text-[10px] font-mono bg-ds-orange/10 text-ds-orange border border-ds-orange/30 px-2 py-0.5 rounded-full">
                        {highCount} altos
                      </span>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  {(["critical", "high", "medium", "low", "info"] as const).map((sev) => {
                    const issues = issuesBySeverity[sev];
                    if (!issues || issues.length === 0) return null;
                    const cfg = SEVERITY_CONFIG[sev];
                    const SevIcon = cfg.icon;

                    return (
                      <div key={sev} className={`rounded-xl border ${cfg.border} ${cfg.bg} p-4`}>
                        <div className="flex items-center gap-2 mb-3">
                          <SevIcon className={`h-3.5 w-3.5 ${cfg.color}`} />
                          <span className={`text-[10px] font-mono uppercase tracking-[0.1em] ${cfg.color}`}>
                            {cfg.label} · {issues.length} problema{issues.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {issues.map((issue) => (
                            <div key={issue.id} className="bg-card/60 rounded-lg p-3 border border-border/40">
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-foreground">{issue.title}</p>
                                  {issue.description && (
                                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{issue.description}</p>
                                  )}
                                  <div className="flex items-center gap-3 mt-1.5">
                                    <span className="text-[9px] font-mono text-muted-foreground bg-muted border border-border px-1.5 py-0.5 rounded uppercase tracking-wide">
                                      {CATEGORY_LABEL[issue.category] ?? issue.category}
                                    </span>
                                    {issue.affectedUrl && (
                                      <a
                                        href={issue.affectedUrl.startsWith("http") ? issue.affectedUrl : `https://${issue.affectedUrl}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-primary transition-colors truncate max-w-xs"
                                      >
                                        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                                        {issue.affectedUrl.replace(/^https?:\/\//, "")}
                                      </a>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <AuditIssueClipboardButton
                                    clientId={params.id}
                                    title={issue.title}
                                    description={issue.description}
                                    severity={issue.severity}
                                    category={issue.category}
                                    affectedUrl={issue.affectedUrl}
                                    count={issue.count}
                                    data={issue.data as Record<string, unknown> | null}
                                  />
                                  {issue.count > 1 && (
                                    <span className="text-xs font-mono font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full border border-border">
                                      ×{issue.count}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {totalIssues === 0 && (
              <div className="bg-primary/10 border border-ds-gd rounded-xl p-8 flex flex-col items-center gap-3 text-center">
                <CheckCircle2 className="h-10 w-10 text-ds-green" />
                <div>
                  <p className="text-base font-semibold text-foreground">Sin problemas detectados</p>
                  <p className="text-sm text-muted-foreground mt-1">El sitio está en excelente estado técnico.</p>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground/50 pt-2">
              <span className="flex items-center gap-1.5">
                <BarChart3 className="h-3 w-3" />
                {selectedAudit.type === "quick" ? "Audit rápido (PageSpeed)" : "Audit completo (Crawler + PageSpeed)"}
              </span>
              {site?.url && (
                <a
                  href={site.url.startsWith("http") ? site.url : `https://${site.url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 hover:text-primary transition-colors"
                >
                  <Globe className="h-3 w-3" />
                  {site.url}
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
