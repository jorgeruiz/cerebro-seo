export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ArrowLeft, AlertCircle, TrendingUp, Trophy, Info, ArrowRight } from "lucide-react";
import { SectionIntro } from "@/components/ui-darkui";
import { format } from "date-fns";
import { es } from "date-fns/locale";

type InsightType = "OPPORTUNITY" | "WARNING" | "WIN" | "INFO";
type Tab = "activos" | "resueltos" | "ignorados";

const TYPE_CONFIG: Record<InsightType, { label: string; icon: typeof AlertCircle; color: string }> = {
  WARNING:     { label: "Alerta",      icon: AlertCircle, color: "text-destructive" },
  OPPORTUNITY: { label: "Oportunidad", icon: TrendingUp,  color: "text-ds-green" },
  WIN:         { label: "Logro",       icon: Trophy,      color: "text-ds-yellow" },
  INFO:        { label: "Información", icon: Info,        color: "text-ds-blue" },
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-destructive/10 border-destructive/30 text-destructive",
  high:     "bg-destructive/10 border-destructive/20 text-destructive/80",
  medium:   "bg-ds-yellow/10 border-ds-yellow/40 text-ds-yellow",
  low:      "bg-ds-blue/10 border-ds-blue/40 text-ds-blue",
};

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export default async function InsightsListPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string };
}) {
  const session = await getSession();
  if (!session?.user?.id) return notFound();

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    select: { id: true, name: true },
  });
  if (!client) return notFound();

  const tab: Tab = (searchParams.tab as Tab) ?? "activos";

  const where =
    tab === "activos"
      ? { clientId: params.id, dismissed: false, acknowledgedAt: null }
      : tab === "resueltos"
      ? { clientId: params.id, acknowledgedAt: { not: null as null } }
      : { clientId: params.id, dismissed: true };

  const [activos, resueltos, ignorados, insights] = await Promise.all([
    prisma.insight.count({ where: { clientId: params.id, dismissed: false, acknowledgedAt: null } }),
    prisma.insight.count({ where: { clientId: params.id, acknowledgedAt: { not: null } } }),
    prisma.insight.count({ where: { clientId: params.id, dismissed: true } }),
    prisma.insight.findMany({
      where,
      orderBy: { generatedAt: "desc" },
    }),
  ]);

  const sorted = [...insights].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
  );

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "activos",   label: "Activos",   count: activos },
    { key: "resueltos", label: "Resueltos", count: resueltos },
    { key: "ignorados", label: "Ignorados", count: ignorados },
  ];

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-border bg-background px-8 py-5">
        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/clientes/${params.id}`}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {client.name}
          </Link>
          <span className="text-border">/</span>
          <span className="text-foreground/70">Insights</span>
        </div>
      </div>

      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Page title */}
        <div>
          <h1 className="font-display font-extrabold text-[clamp(1.4rem,2.5vw,2rem)] tracking-tight leading-[1.05] text-foreground">
            Insights del sistema
          </h1>
          <p className="font-mono text-[0.75rem] text-muted-foreground mt-0.5">
            {client.name} · historial completo
          </p>
        </div>

        <SectionIntro>
          Alertas, oportunidades y logros detectados automáticamente por el sistema SEO. Se generan cuando hay cambios significativos
          en rankings, tráfico, backlinks o issues técnicos. Marca como resuelto cuando hayas actuado sobre el insight.
        </SectionIntro>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-border">
          {tabs.map(({ key, label, count }) => (
            <Link
              key={key}
              href={`/clientes/${params.id}/insights?tab=${key}`}
              className={[
                "flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono border-b-2 -mb-px transition-colors",
                tab === key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {label}
              <span className={[
                "text-[10px] px-1.5 py-0.5 rounded-full font-mono",
                tab === key ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
              ].join(" ")}>
                {count}
              </span>
            </Link>
          ))}
        </div>

        {/* Lista */}
        {sorted.length === 0 ? (
          <div className="rounded-xl border border-border bg-muted/30 p-12 flex flex-col items-center text-center gap-3">
            <p className="text-sm font-medium text-muted-foreground">
              {tab === "activos"
                ? "Sin insights activos — el sistema está en verde."
                : tab === "resueltos"
                ? "Ningún insight marcado como resuelto aún."
                : "Ningún insight ignorado."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map((insight) => {
              const config = TYPE_CONFIG[insight.type as InsightType] ?? TYPE_CONFIG.INFO;
              const Icon = config.icon;
              const severityClass = SEVERITY_BADGE[insight.severity.toLowerCase()] ?? SEVERITY_BADGE.low;

              return (
                <Link
                  key={insight.id}
                  href={`/clientes/${params.id}/insights/${insight.id}`}
                  className="group flex items-start gap-4 rounded-xl border border-border bg-card px-5 py-4 hover:border-primary/40 transition-all"
                >
                  <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${config.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                        {insight.title}
                      </span>
                      <span className={`shrink-0 text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${severityClass}`}>
                        {insight.severity}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{insight.description}</p>
                    {insight.suggestedAction && (
                      <p className="font-mono text-[0.72rem] text-muted-foreground/60 mt-1 truncate">
                        → {insight.suggestedAction}
                      </p>
                    )}
                    <p className="font-mono text-[0.68rem] text-muted-foreground/40 mt-2">
                      {format(insight.generatedAt, "d MMM yyyy, HH:mm", { locale: es })}
                      {insight.acknowledgedAt && ` · resuelto ${format(insight.acknowledgedAt, "d MMM", { locale: es })}`}
                    </p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground shrink-0 mt-0.5 transition-colors" />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
