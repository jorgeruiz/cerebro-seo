export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getOAuth2Client } from "@/lib/google-oauth";
import { GoogleSearchConsoleProvider } from "@/server/providers/google-search-console";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  TrendingUp,
  Search,
  Link2,
  BarChart3,
  Calendar,
  Zap,
  Activity,
  FileSearch,
  FileText,
  Lightbulb,
  Settings,
  Lock,
  Sparkles,
  Brain,
  ClipboardList,
} from "lucide-react";
import { ClientPortadaChart } from "./ClientPortadaChart";
import { GscConnectSection } from "./GscConnectSection";
import { GscSnapshotCards } from "./GscSnapshotCards";
import { Ga4SnapshotCards } from "./Ga4SnapshotCards";
import { InsightCards } from "./InsightCards";
import { CycleCloseButton } from "./CycleCloseButton";
import { NextStepsPanel } from "./NextStepsPanel";
import { SectionHeader, SectionIntro } from "@/components/ui-darkui";
import { buttonVariants } from "@/components/ui/button";
import { getGscSnapshot, getGa4Snapshot } from "./actions";
import { getLatestNextStepPlan } from "./next-steps-actions";
import type { DailyGscMetric } from "@/server/providers/google-search-console";
import type { GscSnapshot, Ga4Snapshot } from "./actions";
import { env } from "@/env";

async function getClientData(id: string) {
  return prisma.client.findUnique({
    where: { id },
    // services: incluido implícitamente (campo escalar, no relación)
    include: {
      sites: { take: 1 },
      cycles: {
        orderBy: { yearMonth: "desc" },
        take: 1,
        include: {
          tasks: {
            orderBy: [{ status: "asc" }, { priority: "asc" }],
            take: 10,
            select: {
              id: true, title: true, description: true, status: true,
              assignedTo: true, dueDate: true, priority: true,
            },
          },
          hypotheses: {
            orderBy: { validation: "asc" },
            take: 10,
            select: {
              id: true, statement: true, expectedMetric: true, expectedDelta: true,
              timeframeDays: true, validation: true, validatedAt: true,
            },
          },
        },
      },
      keywords: { where: { isPriority: true }, take: 10 },
      insights: {
        where: { dismissed: false, acknowledgedAt: null },
        orderBy: [{ severity: "desc" }, { generatedAt: "desc" }],
        take: 5,
      },
    },
  });
}

function getDateRange(daysBack: number) {
  const end = new Date();
  const start = new Date(Date.now() - (daysBack - 1) * 86400000);
  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
  };
}

const CYCLE_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: "Mes activo", color: "bg-primary/10 border-ds-gd text-ds-green" },
  PLANNING: { label: "Planificando", color: "bg-ds-blue/10 border-ds-blue/40 text-ds-blue" },
  CLOSING: { label: "Cerrando mes", color: "bg-ds-orange/10 border-ds-orange/40 text-ds-orange" },
  CLOSED: { label: "Cerrado", color: "bg-muted border-border text-muted-foreground" },
};

const MODULES = [
  // active: true = módulo implementado y linkeable
  // requiresSeo: false = disponible para todos los clientes activos
  // requiresSeo: true  = solo clientes con servicio SEO contratado
  { label: "Términos de búsqueda", icon: Search,     href: "terminos-busqueda", color: "text-ds-blue",        requiresSeo: false, active: true  },
  { label: "AI Search Visibility", icon: Zap,         href: "ai-search",         color: "text-ds-yellow",      requiresSeo: true,  active: true  },
  { label: "SEO Opportunities",    icon: TrendingUp,  href: "oportunidades",     color: "text-ds-green",       requiresSeo: true,  active: true  },
  { label: "Keywords objetivo",    icon: TrendingUp,  href: "keywords",          color: "text-primary",        requiresSeo: true,  active: true  },
  { label: "Tráfico de páginas",   icon: Activity,    href: "trafico-paginas",   color: "text-ds-blue",        requiresSeo: false, active: true  },
  { label: "Eventos",              icon: Calendar,    href: "timeline",          color: "text-ds-orange",      requiresSeo: false, active: true  },
  { label: "Site Audit",           icon: FileSearch,  href: "audit",             color: "text-destructive",    requiresSeo: false, active: true  },
  { label: "Competencia",          icon: BarChart3,   href: "competencia",       color: "text-ds-yellow",      requiresSeo: true,  active: true  },
  { label: "Backlinks",            icon: Link2,       href: "backlinks",         color: "text-ds-blue",        requiresSeo: true,  active: true  },
  { label: "Análisis Claude",      icon: Sparkles,    href: "analisis",          color: "text-primary",        requiresSeo: true,  active: true  },
  { label: "Reporte Mensual",      icon: FileText,    href: "reporte",           color: "text-ds-blue",        requiresSeo: true,  active: true  },
  { label: "Keyword Ideas",        icon: Lightbulb,   href: "keyword-ideas",     color: "text-ds-yellow",      requiresSeo: true,  active: true  },
  { label: "Plan de Contenido",    icon: Lightbulb,   href: "contenido",         color: "text-ds-green",       requiresSeo: true,  active: true  },
  { label: "AEO Research",         icon: Brain,       href: "aeo-research",      color: "text-ds-yellow",      requiresSeo: true,  active: true  },
  { label: "Portapapeles",         icon: ClipboardList, href: "portapapeles",    color: "text-ds-orange",      requiresSeo: false, active: true  },
];

export default async function ClienteDetallePage({
  params,
}: {
  params: { id: string };
}) {
  const [client, session] = await Promise.all([
    getClientData(params.id),
    getSession(),
  ]);

  if (!client) notFound();

  // Todos los usuarios autenticados pueden ver cualquier cliente activo.
  // ClientUser granular está dormido — reservado para Fase 2 si se necesita restricción por cuenta.

  const site = client.sites[0];

  // Fetch GSC + GA4 con el token del usuario actual
  let gscData: DailyGscMetric[] | null = null;
  let gscSnapshot: GscSnapshot | null = null;
  let ga4Snapshot: Ga4Snapshot | null = null;

  if (session?.user?.id && site) {
    const oauth = await getOAuth2Client(session.user.id);

    if (oauth) {
      // GSC — siempre pedimos 365 días para que el selector 12m funcione sin nueva llamada
      if (site.gscProperty) {
        const { startDate, endDate } = getDateRange(365);
        try {
          const gsc = new GoogleSearchConsoleProvider(oauth);
          [gscData, gscSnapshot] = await Promise.all([
            gsc.getDailyMetrics(site.gscProperty, startDate, endDate),
            getGscSnapshot(client.id),
          ]);
          await prisma.apiUsage.create({
            data: {
              provider: "gsc",
              endpoint: "searchanalytics.query",
              cost: 0,
              clientId: client.id,
            },
          });
        } catch (err) {
          console.error("[GSC] Error fetching metrics:", err);
        }
      }

      // GA4 — snapshot 28d con deltas vs 28d anteriores
      try {
        ga4Snapshot = await getGa4Snapshot(client.id);
        if (ga4Snapshot) {
          await prisma.apiUsage.create({
            data: {
              provider: "ga4",
              endpoint: "properties.runReport",
              cost: 0,
              clientId: client.id,
            },
          });
        }
      } catch (err) {
        console.error("[GA4] Error fetching snapshot:", err);
      }
    }
  }

  const hasSeo = client.services.includes("seo");
  const isAdmin = session?.user?.role === "ADMIN";

  // Próximos pasos sugeridos — solo para clientes con servicio SEO
  const nextStepPlan = hasSeo ? await getLatestNextStepPlan(client.id) : null;

  const cycle = client.cycles[0];
  const cycleStatus = cycle ? CYCLE_STATUS_LABEL[cycle.status] : null;
  const pendingTasks = cycle?.tasks.filter((t) => t.status !== "DONE") ?? [];
  const criticalInsights = client.insights.filter((i) => i.severity === "critical");

  // Piloto de InsightsAgent: solo para clientes en INSIGHTS_PILOT_CLIENT_IDS
  const pilotIds = env.INSIGHTS_PILOT_CLIENT_IDS
    ?.split(",").map((s) => s.trim()).filter(Boolean);
  const isPilotClient = !pilotIds || pilotIds.length === 0 || pilotIds.includes(client.id);

  return (
    <div className="min-h-full">
      <div className="p-8 space-y-8">
        {/* Inline page header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display font-extrabold text-[clamp(1.8rem,3vw,2.8rem)] tracking-tight leading-[1.05] text-foreground">
              {client.name}
            </h1>
            <p className="font-mono text-[0.75rem] text-muted-foreground mt-1">{client.domain}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <Link
              href={`/clientes/${client.id}/configuracion`}
              className={buttonVariants({ variant: "outline-mono", size: "sm" }) + " gap-2"}
            >
              <Settings className="h-3.5 w-3.5" />
              Configuración
            </Link>
            {cycleStatus && (
              <span className={`inline-flex items-center text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border ${cycleStatus.color}`}>
                {cycleStatus.label}{cycle?.yearMonth ? ` · ${cycle.yearMonth}` : ""}
              </span>
            )}
            {criticalInsights.length > 0 ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border bg-destructive/10 border-destructive/30 text-destructive">
                <AlertCircle className="h-2.5 w-2.5" />
                {criticalInsights.length} alertas
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border bg-primary/10 border-ds-gd text-ds-green">
                <CheckCircle2 className="h-2.5 w-2.5" />
                Sin alertas
              </span>
            )}
            {pendingTasks.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border bg-ds-yellow/10 border-ds-yellow/40 text-ds-yellow">
                <Clock className="h-2.5 w-2.5" />
                {pendingTasks.length} tareas
              </span>
            )}
          </div>
        </div>
        {/* Próximos pasos sugeridos — SeoAdvisor */}
        {hasSeo && (
          <section>
            <SectionIntro className="mb-5">
              Vista general del cliente. El SeoAdvisor analiza diariamente el estado SEO y genera los próximos pasos priorizados a las 7 AM.
              Los datos de Search Console y Analytics se actualizan cada 24h. Usa los módulos de análisis para profundizar en cada área.
            </SectionIntro>
            <NextStepsPanel
              clientId={client.id}
              initialRecord={nextStepPlan}
              isAdmin={isAdmin}
            />
          </section>
        )}

        {/* Snapshot GSC 28d — solo si hay propiedad configurada y datos */}
        {gscSnapshot && (
          <section>
            <SectionHeader>Orgánico · últimos 28 días</SectionHeader>
            <GscSnapshotCards snapshot={gscSnapshot} />
          </section>
        )}

        {/* Gráfica principal GSC */}
        <section>
          <SectionHeader>Tráfico orgánico</SectionHeader>
          <div className="bg-card rounded-xl border border-border p-6">
            {site?.gscProperty ? (
              <ClientPortadaChart data={gscData} />
            ) : (
              <GscConnectSection clientId={client.id} />
            )}
          </div>
        </section>

        {/* GA4 snapshot 28d con deltas */}
        <section>
          <SectionHeader>Analytics · últimos 28 días</SectionHeader>
          {ga4Snapshot ? (
            <Ga4SnapshotCards snapshot={ga4Snapshot} />
          ) : site?.ga4Property ? (
            <div className="bg-card rounded-xl border border-border p-6 h-32 flex flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium text-muted-foreground">Sin datos de Analytics disponibles</p>
              <p className="text-xs text-muted-foreground/60 max-w-xs">
                No se pudieron cargar los datos de GA4. Si acabas de reconectar, vuelve a cargar.
              </p>
            </div>
          ) : (
            <div className="bg-card rounded-xl border border-border p-6 h-32 flex flex-col items-center justify-center gap-2 text-center">
              <Activity className="h-6 w-6 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">Google Analytics no configurado</p>
              <p className="text-xs text-muted-foreground/60 max-w-xs">
                Agrega el ID de propiedad GA4 en los ajustes del cliente para ver datos de Analytics.
              </p>
            </div>
          )}
        </section>

        {/* Insights proactivos */}
        {hasSeo && (
          <section>
            <SectionHeader>Insights del sistema</SectionHeader>
            <InsightCards
              insights={client.insights}
              clientId={client.id}
              isPilotClient={isPilotClient}
            />
          </section>
        )}

        {/* Operativa del mes */}
        <section>
          <div className="flex items-center gap-2.5 font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.1em] mb-5">
            <span className="text-primary">{"//"}</span>
            <span>Operativa del mes{cycle ? ` · ${cycle.yearMonth}` : ""}</span>
            <span className="flex-1 h-px bg-border" />
            {isAdmin && cycle && (cycle.status === "ACTIVE" || cycle.status === "CLOSING") && (
              <CycleCloseButton clientId={client.id} yearMonth={cycle.yearMonth} />
            )}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Bloque 1 — Estrategia del mes */}
            <div className="bg-card rounded-xl border border-border p-5">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">Estrategia</p>
              {cycle?.focus ? (
                <>
                  <p className="text-sm font-medium text-foreground mb-2">{cycle.focus}</p>
                  {(cycle.goals ?? []).length > 0 && (
                    <ul className="space-y-1">
                      {(cycle.goals ?? []).map((g, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <span className="text-primary shrink-0 mt-0.5">·</span>
                          {g}
                        </li>
                      ))}
                    </ul>
                  )}
                  {cycle.strategySummary && (
                    <p className="text-xs text-muted-foreground/60 mt-3 leading-relaxed">{cycle.strategySummary}</p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground/60 leading-relaxed">
                  Sin estrategia capturada en Notion para este mes.
                </p>
              )}
            </div>

            {/* Bloque 2 — Tareas activas */}
            <div className="bg-card rounded-xl border border-border p-5">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">Tareas activas</p>
              {pendingTasks.length === 0 ? (
                <p className="text-xs text-muted-foreground/60">
                  Sin tareas activas para este mes.
                </p>
              ) : (
                <ul className="space-y-2">
                  {pendingTasks.slice(0, 5).map((task) => {
                    const statusColors: Record<string, string> = {
                      IN_PROGRESS: "bg-ds-blue/10 text-ds-blue",
                      BLOCKED:     "bg-destructive/10 text-destructive",
                      PENDING:     "bg-muted text-muted-foreground",
                      DONE:        "bg-primary/10 text-ds-green",
                    };
                    const statusLabels: Record<string, string> = {
                      IN_PROGRESS: "En curso",
                      BLOCKED:     "Bloqueada",
                      PENDING:     "Pendiente",
                      DONE:        "Completada",
                    };
                    return (
                      <li key={task.id} className="flex items-start gap-2">
                        <span className={`shrink-0 text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded mt-0.5 ${statusColors[task.status] ?? "bg-muted text-muted-foreground"}`}>
                          {statusLabels[task.status] ?? task.status}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground leading-tight truncate">{task.title}</p>
                          {task.assignedTo && (
                            <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{task.assignedTo}</p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                  {pendingTasks.length > 5 && (
                    <li className="text-xs text-primary pt-1 font-mono">
                      +{pendingTasks.length - 5} tareas más
                    </li>
                  )}
                </ul>
              )}
            </div>

            {/* Bloque 3 — Hipótesis del mes */}
            <div className="bg-card rounded-xl border border-border p-5">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">Hipótesis</p>
              {(cycle?.hypotheses ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground/60">
                  Sin hipótesis registradas para este ciclo.
                </p>
              ) : (
                <ul className="space-y-2">
                  {(cycle?.hypotheses ?? []).slice(0, 5).map((h) => {
                    const validColors: Record<string, string> = {
                      PENDING:   "bg-ds-yellow/10 text-ds-yellow",
                      VALIDATED: "bg-primary/10 text-ds-green",
                      REFUTED:   "bg-destructive/10 text-destructive",
                      PARTIAL:   "bg-ds-orange/10 text-ds-orange",
                    };
                    const validLabels: Record<string, string> = {
                      PENDING:   "Pendiente",
                      VALIDATED: "Validada",
                      REFUTED:   "Refutada",
                      PARTIAL:   "Parcial",
                    };
                    return (
                      <li key={h.id} className="flex items-start gap-2">
                        <span className={`shrink-0 text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded mt-0.5 ${validColors[h.validation] ?? "bg-muted text-muted-foreground"}`}>
                          {validLabels[h.validation] ?? h.validation}
                        </span>
                        <p className="text-xs text-muted-foreground leading-tight line-clamp-2">{h.statement}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </section>

        {/* Los 9 módulos */}
        <section>
          <SectionHeader>Módulos de análisis</SectionHeader>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {MODULES.map(({ label, icon: Icon, href, color, requiresSeo, active }) => {
              const locked = requiresSeo && !hasSeo;
              const moduleUrl = `/clientes/${client.id}/${href}`;

              const inner = (
                <>
                  <div className="flex items-center justify-between w-full">
                    <div className={`h-8 w-8 rounded-lg bg-muted flex items-center justify-center ${locked ? "text-muted-foreground/30" : color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    {locked && <Lock className="h-3 w-3 text-muted-foreground/30 shrink-0" />}
                  </div>
                  <span className={`text-xs font-medium leading-tight ${locked ? "text-muted-foreground/40" : "text-foreground"}`}>{label}</span>
                </>
              );

              if (active && !locked) {
                return (
                  <Link
                    key={href}
                    href={moduleUrl}
                    className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-all duration-150 hover:border-primary/40 hover:bg-card"
                  >
                    {inner}
                  </Link>
                );
              }

              return (
                <button
                  key={href}
                  className={[
                    "flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-all duration-150",
                    locked ? "cursor-not-allowed opacity-40" : "cursor-not-allowed opacity-50",
                  ].join(" ")}
                  disabled
                  title={locked ? "Este cliente no tiene servicio SEO contratado." : "Disponible próximamente"}
                >
                  {inner}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground/60 mt-3 text-center font-mono">
            Los módulos restantes se activarán conforme avance la Fase 2.
          </p>
        </section>
      </div>
    </div>
  );
}
