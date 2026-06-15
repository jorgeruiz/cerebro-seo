export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getOAuth2Client } from "@/lib/google-oauth";
import { GoogleSearchConsoleProvider } from "@/server/providers/google-search-console";
import {
  ArrowLeft,
  TrendingUp,
  MousePointerClick,
  Search,
  BarChart2,
  Globe,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SectionHeader, KpiCard } from "@/components/ui-darkui";
import {
  buildOpportunitiesReport,
  type SeoOpportunity,
  type OpportunityType,
} from "@/lib/seo-opportunities";

// ─── Helpers visuales ─────────────────────────────────────────────────────────

const TYPE_META: Record<
  OpportunityType,
  { label: string; icon: React.FC<{ className?: string }>; color: string; borderColor: string }
> = {
  "quick-win":       { label: "Quick Win",      icon: TrendingUp,       color: "text-ds-green",  borderColor: "border-ds-gd/40" },
  "ctr-issue-query": { label: "CTR bajo",        icon: MousePointerClick, color: "text-ds-yellow", borderColor: "border-ds-yellow/30" },
  "no-coverage":     { label: "Sin cobertura",   icon: Search,           color: "text-ds-red",    borderColor: "border-ds-red/30" },
  "poor-position":   { label: "Posición pobre",  icon: BarChart2,        color: "text-ds-blue",   borderColor: "border-ds-blue/30" },
  "ctr-issue-page":  { label: "CTR página bajo", icon: Globe,            color: "text-ds-orange", borderColor: "border-ds-orange/30" },
};

function priorityBadge(p: string) {
  if (p === "alta")  return "text-ds-red bg-ds-red/10 border-ds-red/40";
  if (p === "media") return "text-ds-yellow bg-ds-yellow/10 border-ds-yellow/40";
  return "text-muted-foreground bg-muted border-border";
}

function OpportunityCard({ opp }: { opp: SeoOpportunity }) {
  const meta = TYPE_META[opp.type];
  const Icon = meta.icon;

  return (
    <div className={`bg-card rounded-xl border ${meta.borderColor} p-5 space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`h-4 w-4 shrink-0 ${meta.color}`} />
          <p className="text-xs font-semibold text-foreground truncate">
            {opp.keyword
              ? `"${opp.keyword}"`
              : opp.url
              ? (() => {
                  try { return new URL(opp.url).pathname; } catch { return opp.url; }
                })()
              : "—"}
          </p>
        </div>
        <span
          className={`shrink-0 font-mono text-[0.65rem] uppercase tracking-wide px-1.5 py-0.5 rounded border ${priorityBadge(opp.priority)}`}
        >
          {opp.priority}
        </span>
      </div>

      {/* Métricas */}
      <p className="font-mono text-[0.75rem] text-muted-foreground">{opp.label}</p>

      {/* Posición badge si existe */}
      {opp.position != null && (
        <div className="flex items-center gap-2">
          <span className="font-mono text-[0.7rem] bg-muted border border-border rounded px-1.5 py-0.5 text-foreground">
            #{Math.round(opp.position)}
          </span>
          {opp.impressions != null && (
            <span className="font-mono text-[0.7rem] text-muted-foreground">
              {opp.impressions.toLocaleString("es-MX")} impresiones
            </span>
          )}
          {opp.ctr != null && (
            <span className="font-mono text-[0.7rem] text-muted-foreground">
              CTR {opp.ctr.toFixed(1)}%
            </span>
          )}
        </div>
      )}

      {/* Acción */}
      <div className="border-t border-border pt-3">
        <p className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground mb-1">
          Acción recomendada
        </p>
        <p className="text-xs text-foreground leading-relaxed">{opp.action}</p>
      </div>
    </div>
  );
}

function OpportunitySection({
  title,
  opportunities,
  emptyText,
}: {
  title: string;
  opportunities: SeoOpportunity[];
  emptyText: string;
}) {
  return (
    <section>
      <SectionHeader>
        <span className="flex items-center gap-2">
          {title}
          {opportunities.length > 0 && (
            <span className="font-mono text-[0.7rem] bg-muted border border-border rounded px-1.5 py-0.5 text-muted-foreground">
              {opportunities.length}
            </span>
          )}
        </span>
      </SectionHeader>
      {opportunities.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-border bg-card">
          <CheckCircle2 className="h-4 w-4 text-ds-green shrink-0" />
          <p className="text-xs text-muted-foreground">{emptyText}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {opportunities.map((opp, i) => (
            <OpportunityCard key={i} opp={opp} />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function OportunidadesPage({
  params,
}: {
  params: { id: string };
}) {
  const [session, client] = await Promise.all([
    getSession(),
    prisma.client.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, domain: true, services: true },
    }),
  ]);

  if (!client) notFound();
  if (!client.services.includes("seo")) redirect(`/clientes/${client.id}`);

  // Obtener site con propiedad GSC
  const site = await prisma.site.findFirst({
    where: { clientId: client.id },
    select: { gscProperty: true },
  });

  // OAuth client del usuario actual
  const oauth = session?.user?.id ? await getOAuth2Client(session.user.id) : null;

  // ── Sin GSC configurado ───────────────────────────────────────────────────

  if (!site?.gscProperty || !oauth) {
    return (
      <div className="min-h-full">
        <div className="p-8 space-y-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Link
                href={`/clientes/${client.id}`}
                className={buttonVariants({ variant: "outline-mono", size: "sm" }) + " gap-1.5"}
              >
                <ArrowLeft className="h-3 w-3" />
                {client.name}
              </Link>
            </div>
            <h1 className="font-display font-extrabold text-[clamp(1.6rem,2.5vw,2.4rem)] tracking-tight leading-[1.05] text-foreground flex items-center gap-3">
              <TrendingUp className="h-6 w-6 text-ds-green shrink-0" />
              SEO Opportunities
            </h1>
          </div>
          <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="text-base font-medium text-foreground mb-1">
                {!site?.gscProperty ? "Google Search Console no configurado" : "Token de Google no disponible"}
              </p>
              <p className="text-sm text-muted-foreground max-w-sm">
                {!site?.gscProperty
                  ? "Configura la propiedad de GSC para este cliente primero."
                  : "Cierra sesión y vuelve a entrar con Google para refrescar los permisos."}
              </p>
            </div>
            {!site?.gscProperty && (
              <Link
                href={`/clientes/${client.id}/configuracion`}
                className={buttonVariants({ variant: "outline-mono", size: "sm" })}
              >
                Ir a configuración
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Fetch de datos ────────────────────────────────────────────────────────

  const end = new Date().toISOString().split("T")[0];
  const start = new Date(Date.now() - 28 * 86400000).toISOString().split("T")[0];

  const gsc = new GoogleSearchConsoleProvider(oauth);

  const [queries, pages, keywordsDb] = await Promise.all([
    gsc.getQueries({ siteUrl: site.gscProperty, startDate: start, endDate: end, rowLimit: 1000 }).catch(() => []),
    gsc.getPages({ siteUrl: site.gscProperty, startDate: start, endDate: end, rowLimit: 500 }).catch(() => []),
    prisma.keyword.findMany({
      where: { clientId: client.id, isPriority: true, deletedAt: null },
      select: { term: true },
    }),
  ]);

  const priorityKeywords = keywordsDb.map((k) => k.term);

  // ── Calcular oportunidades ────────────────────────────────────────────────

  const report = buildOpportunitiesReport(queries, pages, priorityKeywords);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-full">
      <div className="p-8 space-y-8">

        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link
              href={`/clientes/${client.id}`}
              className={buttonVariants({ variant: "outline-mono", size: "sm" }) + " gap-1.5"}
            >
              <ArrowLeft className="h-3 w-3" />
              {client.name}
            </Link>
          </div>
          <h1 className="font-display font-extrabold text-[clamp(1.6rem,2.5vw,2.4rem)] tracking-tight leading-[1.05] text-foreground flex items-center gap-3">
            <TrendingUp className="h-6 w-6 text-ds-green shrink-0" />
            SEO Opportunities
          </h1>
          <p className="font-mono text-[0.75rem] text-muted-foreground mt-1">
            {client.domain} · últimos 28 días · datos de Google Search Console
          </p>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Total oportunidades"
            value={String(report.totalCount)}
            valueColor={report.totalCount > 0 ? "default" : "green"}
          />
          <KpiCard
            label="Prioridad alta"
            value={String(report.highPriorityCount)}
            valueColor={report.highPriorityCount > 0 ? "red" : "green"}
          />
          <KpiCard
            label="Quick wins"
            value={String(report.quickWins.length)}
          />
          <KpiCard
            label="Sin cobertura"
            value={String(report.noCoverage.length)}
            valueColor={report.noCoverage.length > 0 ? "red" : "green"}
          />
        </div>

        {/* Zero state */}
        {report.totalCount === 0 && (
          <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center gap-4 text-center">
            <CheckCircle2 className="h-10 w-10 text-ds-green/60" />
            <div>
              <p className="text-base font-medium text-foreground mb-1">Sin oportunidades detectadas</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                No se encontraron oportunidades de mejora en los últimos 28 días.
                Puede ser que el sitio no tenga suficiente tráfico en GSC aún.
              </p>
            </div>
          </div>
        )}

        {/* Secciones por tipo */}
        {report.totalCount > 0 && (
          <>
            <OpportunitySection
              title="Quick wins — keywords a un paso del top 3"
              opportunities={report.quickWins}
              emptyText="Sin keywords en posición 4-10 con suficientes impresiones."
            />

            <OpportunitySection
              title="Problema de CTR — buenos rankings sin suficientes clics"
              opportunities={report.ctrIssuesQuery}
              emptyText="Ninguna keyword en top 3 tiene CTR anormalmente bajo."
            />

            <OpportunitySection
              title="Sin cobertura — keywords prioritarias sin presencia"
              opportunities={report.noCoverage}
              emptyText="Todas las keywords prioritarias tienen visibilidad en GSC."
            />

            <OpportunitySection
              title="Posición pobre — mucha visibilidad, poco tráfico"
              opportunities={report.poorPosition}
              emptyText="Sin keywords con muchas impresiones en página 2+."
            />

            <OpportunitySection
              title="CTR bajo por URL — páginas que no convierten impresiones en clics"
              opportunities={report.ctrIssuesPage}
              emptyText="Ninguna URL tiene CTR anormalmente bajo dado su volumen de impresiones."
            />
          </>
        )}

        {/* Footer */}
        <p className="font-mono text-[0.7rem] text-muted-foreground text-right">
          Datos GSC: {start} → {end} · Caché 24h · {queries.length} queries analizadas
        </p>
      </div>
    </div>
  );
}
