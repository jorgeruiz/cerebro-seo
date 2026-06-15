export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import { ArrowLeft, BarChart3, TrendingDown } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SectionHeader, KpiCard } from "@/components/ui-darkui";
import { SovChart } from "./SovChart";
import { TriggerCompetitorButton } from "./TriggerCompetitorButton";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatNum(n: number): string {
  return n.toLocaleString("es-MX");
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" });
}

function difficultyBadge(kd: number | null): string {
  if (kd === null) return "text-muted-foreground bg-muted border-border";
  if (kd >= 70) return "text-ds-red bg-ds-red/10 border-ds-red/40";
  if (kd >= 40) return "text-ds-yellow bg-ds-yellow/10 border-ds-yellow/40";
  return "text-ds-green bg-primary/10 border-ds-gd";
}

function intentLabel(intent: string | null): string {
  if (!intent) return "—";
  const map: Record<string, string> = {
    informational: "Info",
    navigational: "Nav",
    commercial: "Com",
    transactional: "Trans",
  };
  return map[intent.toLowerCase()] ?? intent;
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getCompetenciaData(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, domain: true, services: true },
  });
  if (!client) return null;

  const competitors = await prisma.competitor.findMany({
    where: { clientId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: {
      snapshots: {
        orderBy: { capturedAt: "desc" },
        take: 1,
      },
    },
  });

  // Top keyword gaps (volumen desc) de todos los competidores, del último análisis
  const topGaps = await prisma.competitorKeywordGap.findMany({
    where: { clientId },
    orderBy: { searchVolume: "desc" },
    take: 50,
    include: {
      competitor: { select: { domain: true } },
    },
  });

  return { client, competitors, topGaps };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CompetenciaPage({
  params,
}: {
  params: { id: string };
}) {
  const [data, session] = await Promise.all([
    getCompetenciaData(params.id),
    getSession(),
  ]);

  if (!data) notFound();
  const { client, competitors, topGaps } = data;

  if (!client.services.includes("seo")) {
    redirect(`/clientes/${client.id}`);
  }

  const isAdmin = session?.user?.role === UserRole.ADMIN;

  // ── Derived data ─────────────────────────────────────────────────────────

  const hasAnyData = competitors.some((c) => c.snapshots.length > 0);

  // SoV chart data — solo competidores con snapshot
  const sovData = competitors
    .filter((c) => c.snapshots[0]?.shareOfVoicePct != null)
    .map((c) => ({
      domain: c.domain,
      sov: c.snapshots[0]!.shareOfVoicePct!,
    }))
    .sort((a, b) => b.sov - a.sov);

  // Totales KPI
  const totalGaps = competitors.reduce(
    (sum, c) => sum + (c.snapshots[0]?.gapsCount ?? 0),
    0
  );
  const topCompetitor =
    sovData.length > 0 ? sovData[0] : null;

  const lastAnalyzed = competitors
    .map((c) => c.lastAnalyzed)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  return (
    <div className="min-h-full">
      <div className="p-8 space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
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
              <BarChart3 className="h-6 w-6 text-ds-yellow shrink-0" />
              Competencia
            </h1>
            <p className="font-mono text-[0.75rem] text-muted-foreground mt-1">
              {client.domain}
            </p>
          </div>
          {isAdmin && (
            <TriggerCompetitorButton clientId={client.id} />
          )}
        </div>

        {/* Empty state — sin competidores configurados */}
        {competitors.length === 0 && (
          <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center justify-center gap-4 text-center">
            <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="text-base font-medium text-foreground mb-1">Sin competidores configurados</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                Agrega dominios competidores desde la configuración del cliente.
                El análisis comparativo se ejecuta automáticamente los días 1 y 15 de cada mes.
              </p>
            </div>
            <Link
              href={`/clientes/${client.id}/configuracion`}
              className={buttonVariants({ variant: "outline-mono", size: "sm" })}
            >
              Ir a configuración
            </Link>
          </div>
        )}

        {/* Tiene competidores pero sin datos aún */}
        {competitors.length > 0 && !hasAnyData && (
          <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center justify-center gap-4 text-center">
            <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="text-base font-medium text-foreground mb-1">Sin datos de competencia aún</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                El primer análisis se ejecuta los días 1 y 15 de cada mes.
                Los datos aparecerán aquí tras el primer run.
              </p>
            </div>
            {isAdmin && <TriggerCompetitorButton clientId={client.id} />}
          </div>
        )}

        {/* KPI row */}
        {hasAnyData && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              label="Competidores"
              value={String(competitors.length)}
            />
            <KpiCard
              label="Total keyword gaps"
              value={formatNum(totalGaps)}
            />
            <KpiCard
              label="Mayor SoV"
              value={topCompetitor ? `${topCompetitor.domain.replace(/^www\./, "")} · ${topCompetitor.sov}%` : "—"}
            />
            <KpiCard
              label="Último análisis"
              value={lastAnalyzed ? formatDate(lastAnalyzed) : "—"}
              delta={
                <span className="font-mono text-[0.7rem] text-muted-foreground">
                  días 1 y 15, 7 AM
                </span>
              }
            />
          </div>
        )}

        {/* Share of Voice */}
        {hasAnyData && sovData.length > 0 && (
          <section>
            <SectionHeader>Share of Voice por competidor</SectionHeader>
            <div className="bg-card rounded-xl border border-border p-6">
              <p className="font-mono text-[0.7rem] text-muted-foreground mb-4">
                % del pool de keywords relevantes donde cada competidor tiene presencia (posición 1-100)
              </p>
              <SovChart data={sovData} />
            </div>
          </section>
        )}

        {/* Competitor cards */}
        {hasAnyData && (
          <section>
            <SectionHeader>Detalle por competidor</SectionHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {competitors.map((comp) => {
                const snap = comp.snapshots[0];
                return (
                  <div
                    key={comp.id}
                    className="bg-card rounded-xl border border-border p-5 space-y-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-sm font-medium text-foreground truncate">
                          {comp.domain}
                        </p>
                        {comp.lastAnalyzed && (
                          <p className="font-mono text-[0.7rem] text-muted-foreground mt-0.5">
                            Analizado: {formatDate(comp.lastAnalyzed)}
                          </p>
                        )}
                      </div>
                      {snap?.shareOfVoicePct != null && (
                        <span className="shrink-0 font-mono text-[0.75rem] px-2 py-0.5 rounded border bg-ds-yellow/10 border-ds-yellow/40 text-ds-yellow">
                          SoV {snap.shareOfVoicePct}%
                        </span>
                      )}
                    </div>

                    {snap ? (
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                        {[
                          { label: "DR", value: snap.domainRank ?? "—" },
                          { label: "Keywords rankeadas", value: snap.rankedKeywords != null ? formatNum(snap.rankedKeywords) : "—" },
                          { label: "Tráfico estimado", value: snap.estimatedTraffic != null ? formatNum(snap.estimatedTraffic) : "—" },
                          { label: "Keywords compartidas", value: snap.sharedKeywordsCount != null ? formatNum(snap.sharedKeywordsCount) : "—" },
                          { label: "Gaps (ventaja)", value: snap.gapsCount != null ? formatNum(snap.gapsCount) : "—" },
                        ].map(({ label, value }) => (
                          <div key={label}>
                            <dt className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                              {label}
                            </dt>
                            <dd className="font-mono text-sm font-medium text-foreground">
                              {value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="text-xs text-muted-foreground/60">Sin datos aún.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Keyword gaps table */}
        {hasAnyData && topGaps.length > 0 && (
          <section>
            <SectionHeader>
              <span className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-ds-red" />
                Keywords donde la competencia te gana
              </span>
            </SectionHeader>
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground px-4 py-3">
                      Keyword
                    </th>
                    <th className="text-center font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground px-3 py-3 w-20">
                      Volumen
                    </th>
                    <th className="text-center font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground px-3 py-3 w-16">
                      KD
                    </th>
                    <th className="text-center font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground px-3 py-3 w-16">
                      Intent
                    </th>
                    <th className="text-right font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground px-4 py-3 w-24">
                      Competidor
                    </th>
                    <th className="text-center font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground px-3 py-3 w-16">
                      Pos.
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topGaps.slice(0, 30).map((gap, i) => (
                    <tr
                      key={gap.id}
                      className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                    >
                      <td className="px-4 py-2.5">
                        <span
                          className="font-mono text-xs text-foreground max-w-[220px] truncate block"
                          title={gap.keyword}
                        >
                          {gap.keyword}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono text-xs text-muted-foreground">
                        {gap.searchVolume != null ? formatNum(gap.searchVolume) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {gap.keywordDifficulty != null ? (
                          <span
                            className={`inline-flex items-center justify-center font-mono text-[0.75rem] px-1.5 py-0.5 rounded border ${difficultyBadge(gap.keywordDifficulty)}`}
                          >
                            {gap.keywordDifficulty}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono text-[0.75rem] text-muted-foreground">
                        {intentLabel(gap.intent)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-[0.75rem] text-muted-foreground truncate max-w-[120px]">
                        {gap.competitor.domain.replace(/^www\./, "")}
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono text-xs text-foreground">
                        #{gap.competitorPosition}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {topGaps.length > 30 && (
                <p className="font-mono text-[0.7rem] text-muted-foreground text-center py-3 border-t border-border">
                  Mostrando 30 de {topGaps.length} gaps detectados
                </p>
              )}
            </div>
          </section>
        )}

        {/* Footer */}
        {lastAnalyzed && (
          <p className="font-mono text-[0.7rem] text-muted-foreground text-right">
            Último análisis: {formatDate(lastAnalyzed)} · Próximo: días 1 y 15, 7 AM
          </p>
        )}
      </div>
    </div>
  );
}
