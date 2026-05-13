export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import { getOAuth2Client } from "@/lib/google-oauth";
import { GoogleSearchConsoleProvider } from "@/server/providers/google-search-console";
import { GoogleAnalytics4Provider } from "@/server/providers/google-analytics-4";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  TrendingUp,
  Search,
  Globe,
  Link2,
  BarChart3,
  Calendar,
  Zap,
  Activity,
  FileSearch,
  Users,
  MousePointerClick,
} from "lucide-react";
import { ClientPortadaChart } from "./ClientPortadaChart";
import { GscConnectSection } from "./GscConnectSection";
import { GscSnapshotCards } from "./GscSnapshotCards";
import { InsightCards } from "./InsightCards";
import { getGscSnapshot } from "./actions";
import type { DailyGscMetric } from "@/server/providers/google-search-console";
import type { Ga4Overview } from "@/server/providers/google-analytics-4";
import type { GscSnapshot } from "./actions";

async function getClientData(id: string) {
  return prisma.client.findUnique({
    where: { id },
    include: {
      sites: { take: 1 },
      cycles: {
        orderBy: { yearMonth: "desc" },
        take: 1,
        include: {
          tasks: { orderBy: { priority: "asc" }, take: 10 },
          hypotheses: { where: { validation: "PENDING" } },
        },
      },
      keywords: { where: { isPriority: true }, take: 10 },
      insights: {
        where: { dismissed: false },
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
  ACTIVE: { label: "Mes activo", color: "bg-green-50 text-green-700 border-green-200" },
  PLANNING: { label: "Planificando", color: "bg-blue-50 text-blue-700 border-blue-200" },
  CLOSING: { label: "Cerrando mes", color: "bg-orange-50 text-orange-700 border-orange-200" },
  CLOSED: { label: "Cerrado", color: "bg-gray-50 text-gray-500 border-gray-200" },
};

const MODULES = [
  { label: "Términos de búsqueda", icon: Search, href: "terminos", color: "text-blue-500" },
  { label: "AI Search Visibility", icon: Zap, href: "ai-search", color: "text-purple-500" },
  { label: "SEO Opportunities", icon: TrendingUp, href: "oportunidades", color: "text-green-500" },
  { label: "Keyword Ideas", icon: Globe, href: "keywords", color: "text-indigo-500" },
  { label: "Tráfico de páginas", icon: Activity, href: "trafico", color: "text-cyan-500" },
  { label: "Eventos", icon: Calendar, href: "eventos", color: "text-orange-500" },
  { label: "Site Audit", icon: FileSearch, href: "audit", color: "text-red-500" },
  { label: "Competencia", icon: BarChart3, href: "competencia", color: "text-yellow-500" },
  { label: "Backlinks", icon: Link2, href: "backlinks", color: "text-pink-500" },
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

  // EDITOR solo puede ver clientes asignados via ClientUser (por email) — 404 si no tiene acceso.
  if (session?.user?.role !== UserRole.ADMIN) {
    const assigned = await prisma.clientUser.findFirst({
      where: { clientId: client.id, email: session?.user?.email ?? "" },
    });
    if (!assigned) notFound();
  }

  const site = client.sites[0];

  // Fetch GSC + GA4 con el token del usuario actual
  let gscData: DailyGscMetric[] | null = null;
  let gscSnapshot: GscSnapshot | null = null;
  let ga4Overview: Ga4Overview | null = null;

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

      // GA4
      if (site.ga4Property) {
        const { startDate, endDate } = getDateRange(90);
        try {
          const ga4 = new GoogleAnalytics4Provider(oauth);
          ga4Overview = await ga4.getOverview(site.ga4Property, startDate, endDate);
          await prisma.apiUsage.create({
            data: {
              provider: "ga4",
              endpoint: "properties.runReport",
              cost: 0,
              clientId: client.id,
            },
          });
        } catch (err) {
          console.error("[GA4] Error fetching overview:", err);
        }
      }
    }
  }

  const cycle = client.cycles[0];
  const cycleStatus = cycle ? CYCLE_STATUS_LABEL[cycle.status] : null;
  const pendingTasks = cycle?.tasks.filter((t) => t.status !== "DONE") ?? [];
  const criticalInsights = client.insights.filter((i) => i.severity === "critical");

  return (
    <div className="min-h-full">
      {/* Hero header del cliente */}
      <div className="border-b border-gray-100 bg-white px-8 py-6">
        <div className="flex items-start gap-4">
          <div
            className="h-12 w-12 rounded-xl flex items-center justify-center text-white text-lg font-bold shrink-0 shadow-sm"
            style={{
              background: client.brandColor ?? "linear-gradient(135deg, #6366f1, #3b82f6)",
            }}
          >
            {client.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">{client.name}</h1>
              {cycleStatus && (
                <span
                  className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border ${cycleStatus.color}`}
                >
                  {cycleStatus.label} {cycle?.yearMonth && `· ${cycle.yearMonth}`}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-400 mt-0.5">{client.domain}</p>
          </div>

          {/* KPIs rápidos */}
          <div className="flex items-center gap-6 shrink-0">
            {criticalInsights.length > 0 ? (
              <div className="flex items-center gap-1.5 text-sm text-red-600">
                <AlertCircle className="h-4 w-4" />
                <span className="font-medium">{criticalInsights.length}</span>
                <span className="text-xs">alertas</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-xs">Sin alertas</span>
              </div>
            )}
            {pendingTasks.length > 0 && (
              <div className="flex items-center gap-1.5 text-sm text-amber-600">
                <Clock className="h-4 w-4" />
                <span className="font-medium">{pendingTasks.length}</span>
                <span className="text-xs">tareas</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-8 space-y-8">
        {/* Snapshot GSC 28d — solo si hay propiedad configurada y datos */}
        {gscSnapshot && (
          <section>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
              Orgánico · últimos 28 días
            </h2>
            <GscSnapshotCards snapshot={gscSnapshot} />
          </section>
        )}

        {/* Gráfica principal GSC */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Tráfico orgánico
            </h2>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            {site?.gscProperty ? (
              <ClientPortadaChart data={gscData} />
            ) : (
              <GscConnectSection clientId={client.id} />
            )}
          </div>
        </section>

        {/* GA4 KPIs — solo si hay datos */}
        {ga4Overview && (
          <section>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
              Analytics (90d · Orgánico)
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="h-4 w-4 text-indigo-500" />
                  <span className="text-xs text-gray-500">Sesiones</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">
                  {ga4Overview.totalSessions.toLocaleString("es-MX")}
                </p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="h-4 w-4 text-blue-500" />
                  <span className="text-xs text-gray-500">Usuarios activos</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">
                  {ga4Overview.totalUsers.toLocaleString("es-MX")}
                </p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4 text-pink-500" />
                  <span className="text-xs text-gray-500">Tasa de rebote</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">
                  {ga4Overview.avgBounceRate}%
                </p>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center gap-2 mb-2">
                  <MousePointerClick className="h-4 w-4 text-green-500" />
                  <span className="text-xs text-gray-500">Conversiones</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">
                  {ga4Overview.totalConversions.toLocaleString("es-MX")}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Insights proactivos */}
        {client.insights.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
              Insights del sistema
            </h2>
            <InsightCards insights={client.insights} />
          </section>
        )}

        {/* Operativa del mes */}
        {cycle && (
          <section>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
              Operativa del mes · {cycle.yearMonth}
            </h2>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
              {cycle.strategySummary && (
                <p className="text-sm text-gray-600 mb-5 leading-relaxed">
                  {cycle.strategySummary}
                </p>
              )}

              {pendingTasks.length === 0 ? (
                <p className="text-sm text-gray-400">Sin tareas pendientes este mes.</p>
              ) : (
                <ul className="space-y-2">
                  {pendingTasks.map((task) => (
                    <li key={task.id} className="flex items-start gap-3">
                      <div className="mt-1 h-4 w-4 rounded border-2 border-gray-200 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-gray-800">{task.title}</p>
                        {task.description && (
                          <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">
                            {task.description}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* Los 9 módulos */}
        <section>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
            Módulos de análisis
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {MODULES.map(({ label, icon: Icon, href, color }) => (
              <button
                key={href}
                className="flex flex-col items-start gap-3 rounded-xl border border-gray-100 bg-white p-4 text-left shadow-sm hover:shadow-md hover:border-indigo-200 transition-all duration-150 cursor-not-allowed opacity-60"
                disabled
                title="Disponible en Fase 2"
              >
                <div className={`h-8 w-8 rounded-lg bg-gray-50 flex items-center justify-center ${color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <span className="text-xs font-medium text-gray-700 leading-tight">{label}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3 text-center">
            Los módulos se activarán conforme se implemente la Fase 2 del proyecto.
          </p>
        </section>
      </div>
    </div>
  );
}
