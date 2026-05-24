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
} from "lucide-react";

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getAuditData(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      domain: true,
      brandColor: true,
      sites: { take: 1, select: { id: true, url: true } },
      audits: {
        orderBy: { date: "desc" },
        take: 1,
        include: {
          auditIssues: {
            orderBy: [{ severity: "asc" }, { count: "desc" }],
          },
        },
      },
    },
  });
  return client;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  critical: { label: "Crítico", color: "text-red-700", bg: "bg-red-50", border: "border-red-200", icon: XCircle },
  high:     { label: "Alto",    color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-200", icon: AlertTriangle },
  medium:   { label: "Medio",   color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", icon: AlertTriangle },
  low:      { label: "Bajo",    color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200", icon: Info },
  info:     { label: "Info",    color: "text-gray-600", bg: "bg-gray-50", border: "border-gray-200", icon: Info },
} as const;

const CATEGORY_LABEL: Record<string, string> = {
  technical: "Técnico",
  performance: "Performance",
  content: "Contenido",
  seo: "SEO",
  accessibility: "Accesibilidad",
};

function ScoreBadge({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const color =
    score >= 80 ? "text-green-700 bg-green-50 border-green-200"
    : score >= 60 ? "text-amber-700 bg-amber-50 border-amber-200"
    : "text-red-700 bg-red-50 border-red-200";

  const sizeClass =
    size === "lg" ? "text-3xl font-bold px-4 py-2"
    : size === "sm" ? "text-sm font-semibold px-2 py-0.5"
    : "text-xl font-bold px-3 py-1";

  return (
    <span className={`inline-flex items-center rounded-lg border ${color} ${sizeClass}`}>
      {score}
    </span>
  );
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AuditPage({
  params,
}: {
  params: { id: string };
}) {
  const [client] = await Promise.all([
    getAuditData(params.id),
    getSession(),
  ]);

  if (!client) notFound();

  const audit = client.audits[0] ?? null;
  const site = client.sites[0];

  // Agrupar issues por severidad
  const issuesBySeverity = audit?.auditIssues.reduce(
    (acc, issue) => {
      const sev = issue.severity as keyof typeof SEVERITY_CONFIG;
      if (!acc[sev]) acc[sev] = [];
      acc[sev].push(issue);
      return acc;
    },
    {} as Record<string, typeof audit.auditIssues>
  ) ?? {};

  const totalIssues = audit?.auditIssues.length ?? 0;
  const criticalCount = issuesBySeverity["critical"]?.length ?? 0;
  const highCount = issuesBySeverity["high"]?.length ?? 0;

  const cwvData = audit?.cwvData as {
    mobile?: { lcp?: number; fcp?: number; cls?: number; tbt?: number };
    mobileScores?: { performance: number; seo: number; accessibility: number; bestPractices: number };
  } | null;

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-gray-100 bg-white px-8 py-5">
        <div className="flex items-center gap-3">
          <Link
            href={`/clientes/${client.id}`}
            className="text-gray-400 hover:text-gray-700 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-2">
            <FileSearch className="h-5 w-5 text-red-500" />
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Site Audit</h1>
              <p className="text-xs text-gray-400">{client.name} · {client.domain}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-8 space-y-8">

        {/* Sin audit todavía */}
        {!audit && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 flex flex-col items-center gap-4 text-center">
            <div className="h-14 w-14 rounded-2xl bg-red-50 flex items-center justify-center">
              <FileSearch className="h-7 w-7 text-red-400" />
            </div>
            <div>
              <p className="text-base font-semibold text-gray-800">Sin auditorías todavía</p>
              <p className="text-sm text-gray-400 mt-1 max-w-sm">
                El primer audit rápido corre automáticamente el próximo miércoles a las 2 AM.
                El audit completo corre el 1ro de cada mes.
              </p>
              <p className="text-xs text-gray-400 mt-3">
                Para disparar manualmente: <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">tsx scripts/trigger-audit.ts {client.id}</code>
              </p>
            </div>
          </div>
        )}

        {/* Audit running */}
        {audit?.status === "running" && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 flex items-center gap-3">
            <RefreshCw className="h-5 w-5 text-blue-500 animate-spin" />
            <div>
              <p className="text-sm font-medium text-blue-800">Auditoría en progreso...</p>
              <p className="text-xs text-blue-600">Iniciada el {formatDate(audit.startedAt)}. Recarga la página en unos minutos.</p>
            </div>
          </div>
        )}

        {/* Audit failed */}
        {audit?.status === "failed" && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5">
            <p className="text-sm font-medium text-red-800">La última auditoría falló</p>
            {audit.error && <p className="text-xs text-red-600 mt-1 font-mono">{audit.error}</p>}
            <p className="text-xs text-red-500 mt-2">Se reintentará en el próximo ciclo programado.</p>
          </div>
        )}

        {/* Audit completado */}
        {audit?.status === "completed" && (
          <>
            {/* Scores overview */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                  Puntuación general
                </h2>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <Clock className="h-3.5 w-3.5" />
                  <span>
                    {audit.type === "quick" ? "Audit rápido" : "Audit completo"} ·{" "}
                    {formatDate(audit.completedAt ?? audit.date)}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: "Overall", score: audit.scoreOverall, highlight: true },
                  { label: "Técnico", score: audit.scoreTechnical },
                  { label: "Performance", score: audit.scorePerformance },
                  { label: "Contenido", score: audit.scoreContent },
                  { label: "SEO", score: audit.seoScore ?? 0 },
                  { label: "Accesibilidad", score: audit.accessibilityScore ?? 0 },
                ].map(({ label, score, highlight }) => (
                  <div
                    key={label}
                    className={`bg-white rounded-xl border p-4 flex flex-col items-center gap-2 shadow-sm ${
                      highlight ? "border-indigo-200 ring-1 ring-indigo-100" : "border-gray-100"
                    }`}
                  >
                    <ScoreBadge score={score} size={highlight ? "lg" : "md"} />
                    <span className="text-xs text-gray-500 font-medium">{label}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Stats de crawl */}
            <section>
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
                Estadísticas del sitio
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Páginas analizadas", value: audit.pagesCrawled, icon: Globe },
                  { label: "Indexables", value: audit.pagesIndexable, icon: CheckCircle2, good: true },
                  { label: "Con error (4xx/5xx)", value: audit.brokenPages, icon: XCircle, bad: audit.brokenPages > 0 },
                  { label: "Redirecciones", value: audit.redirectPages, icon: RefreshCw },
                ].map(({ label, value, icon: Icon, good, bad }) => (
                  <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`h-4 w-4 ${good ? "text-green-500" : bad ? "text-red-500" : "text-gray-400"}`} />
                      <span className="text-xs text-gray-500">{label}</span>
                    </div>
                    <p className={`text-2xl font-bold ${bad && value > 0 ? "text-red-700" : "text-gray-900"}`}>
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {/* CWV */}
            {cwvData?.mobile && (
              <section>
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
                  Core Web Vitals · Mobile
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "LCP", value: cwvData.mobile.lcp, unit: "ms", good: 2500, poor: 4000 },
                    { label: "FCP", value: cwvData.mobile.fcp, unit: "ms", good: 1800, poor: 3000 },
                    { label: "CLS", value: cwvData.mobile.cls, unit: "", good: 0.1, poor: 0.25, decimals: 3 },
                    { label: "TBT", value: cwvData.mobile.tbt, unit: "ms", good: 200, poor: 600 },
                  ]
                    .filter((m) => m.value !== undefined)
                    .map(({ label, value, unit, good, poor, decimals }) => {
                      const v = value ?? 0;
                      const status =
                        v <= good ? "good"
                        : v <= poor ? "needs-improvement"
                        : "poor";
                      const colors = {
                        good: "text-green-700 bg-green-50 border-green-200",
                        "needs-improvement": "text-amber-700 bg-amber-50 border-amber-200",
                        poor: "text-red-700 bg-red-50 border-red-200",
                      }[status];
                      return (
                        <div key={label} className={`rounded-xl border p-4 ${colors}`}>
                          <p className="text-xs font-semibold mb-1">{label}</p>
                          <p className="text-xl font-bold">
                            {decimals ? v.toFixed(decimals) : v.toLocaleString("es-MX")}
                            {unit && <span className="text-sm font-normal ml-1">{unit}</span>}
                          </p>
                        </div>
                      );
                    })}
                </div>
              </section>
            )}

            {/* Issues */}
            {totalIssues > 0 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                    Problemas detectados
                    <span className="ml-2 text-gray-400 font-normal normal-case">({totalIssues})</span>
                  </h2>
                  {(criticalCount > 0 || highCount > 0) && (
                    <div className="flex items-center gap-2 text-xs">
                      {criticalCount > 0 && (
                        <span className="bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full font-medium">
                          {criticalCount} críticos
                        </span>
                      )}
                      {highCount > 0 && (
                        <span className="bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full font-medium">
                          {highCount} altos
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  {(["critical", "high", "medium", "low", "info"] as const).map((sev) => {
                    const issues = issuesBySeverity[sev];
                    if (!issues || issues.length === 0) return null;
                    const config = SEVERITY_CONFIG[sev];
                    const SevIcon = config.icon;

                    return (
                      <div key={sev} className={`rounded-xl border ${config.border} ${config.bg} p-4`}>
                        <div className="flex items-center gap-2 mb-3">
                          <SevIcon className={`h-4 w-4 ${config.color}`} />
                          <span className={`text-xs font-semibold uppercase tracking-wide ${config.color}`}>
                            {config.label} · {issues.length} problema{issues.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {issues.map((issue) => (
                            <div key={issue.id} className="bg-white/70 rounded-lg p-3">
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-800">{issue.title}</p>
                                  {issue.description && (
                                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">{issue.description}</p>
                                  )}
                                  <div className="flex items-center gap-3 mt-1.5">
                                    <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-mono">
                                      {CATEGORY_LABEL[issue.category] ?? issue.category}
                                    </span>
                                    {issue.affectedUrl && (
                                      <span className="text-[10px] text-gray-400 truncate max-w-xs">
                                        {issue.affectedUrl}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {issue.count > 1 && (
                                  <span className="shrink-0 text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                                    ×{issue.count}
                                  </span>
                                )}
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
              <div className="bg-green-50 border border-green-200 rounded-xl p-8 flex flex-col items-center gap-3 text-center">
                <CheckCircle2 className="h-10 w-10 text-green-500" />
                <div>
                  <p className="text-base font-semibold text-green-800">Sin problemas detectados</p>
                  <p className="text-sm text-green-600 mt-1">El sitio está en excelente estado técnico.</p>
                </div>
              </div>
            )}

            {/* Footer con info del audit */}
            <div className="flex items-center gap-4 text-xs text-gray-400 pt-2">
              <span className="flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" />
                Tipo: {audit.type === "quick" ? "Rápido (PageSpeed)" : "Completo (Crawler + PageSpeed)"}
              </span>
              {site?.url && (
                <a
                  href={site.url.startsWith("http") ? site.url : `https://${site.url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 hover:text-indigo-600 transition-colors"
                >
                  <Globe className="h-3.5 w-3.5" />
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
