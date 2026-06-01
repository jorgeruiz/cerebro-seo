export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import { ArrowLeft, Link2, CheckCircle2, XCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SectionHeader, KpiCard } from "@/components/ui-darkui";
import { BacklinksEvolutionChart } from "./BacklinksEvolutionChart";
import { TriggerCrawlButton } from "./TriggerCrawlButton";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatNum(n: number): string {
  return n.toLocaleString("es-MX");
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

function daBadgeClass(da: number | null): string {
  if (da === null) return "text-muted-foreground bg-muted border-border";
  if (da >= 50) return "text-ds-green bg-primary/10 border-ds-gd";
  if (da >= 20) return "text-ds-yellow bg-ds-yellow/10 border-ds-yellow/40";
  return "text-muted-foreground bg-muted border-border";
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getBacklinksData(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, domain: true, services: true },
  });
  if (!client) return null;

  const [snapshots, topBacklinks, lastSnapshot] = await Promise.all([
    prisma.backlinkSnapshot.findMany({
      where: { clientId },
      orderBy: { capturedAt: "asc" },
      take: 12,
    }),
    prisma.backlink.findMany({
      where: { clientId, status: "ACTIVE" },
      orderBy: { domainAuthority: "desc" },
      take: 20,
    }),
    prisma.backlinkSnapshot.findFirst({
      where: { clientId },
      orderBy: { capturedAt: "desc" },
    }),
  ]);

  // Backlinks ganados y perdidos de los últimos 7 días
  const since = lastSnapshot
    ? new Date(lastSnapshot.capturedAt.getTime() - 7 * 24 * 3600 * 1000)
    : new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const [recentGained, recentLost] = await Promise.all([
    prisma.backlink.findMany({
      where: { clientId, status: "ACTIVE", firstSeen: { gte: since } },
      orderBy: { domainAuthority: "desc" },
      take: 10,
    }),
    prisma.backlink.findMany({
      where: { clientId, status: "LOST", lostAt: { gte: since } },
      orderBy: { domainAuthority: "desc" },
      take: 10,
    }),
  ]);

  return { client, snapshots, topBacklinks, lastSnapshot, recentGained, recentLost };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function BacklinksPage({ params }: { params: { id: string } }) {
  const [data, session] = await Promise.all([
    getBacklinksData(params.id),
    getSession(),
  ]);

  if (!data) notFound();
  const { client, snapshots, topBacklinks, lastSnapshot, recentGained, recentLost } = data;

  if (!client.services.includes("seo")) {
    redirect(`/clientes/${client.id}`);
  }

  const isAdmin = session?.user?.role === UserRole.ADMIN;

  // KPI deltas
  const prevSnapshot = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
  const deltaBacklinks = lastSnapshot && prevSnapshot
    ? lastSnapshot.totalBacklinks - prevSnapshot.totalBacklinks
    : null;
  const deltaDomains = lastSnapshot && prevSnapshot
    ? lastSnapshot.uniqueDomains - prevSnapshot.uniqueDomains
    : null;

  const gained = lastSnapshot?.gainedThisWeek ?? 0;
  const lost = lastSnapshot?.lostThisWeek ?? 0;
  const deltaColor: "green" | "red" | "default" =
    gained > lost ? "green" : lost > gained ? "red" : "default";

  // Datos para la gráfica (serializables)
  const chartData = snapshots.map((s) => ({
    label: formatDate(s.capturedAt),
    totalBacklinks: s.totalBacklinks,
    uniqueDomains: s.uniqueDomains,
  }));

  const hasAnyData = lastSnapshot !== null;

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
              <Link2 className="h-6 w-6 text-ds-blue shrink-0" />
              Backlinks
            </h1>
            <p className="font-mono text-[0.65rem] text-muted-foreground mt-1">
              {client.domain}
            </p>
          </div>
          {isAdmin && hasAnyData && (
            <TriggerCrawlButton clientId={client.id} />
          )}
        </div>

        {/* Empty state */}
        {!hasAnyData && (
          <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center justify-center gap-4 text-center">
            <Link2 className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="text-base font-medium text-foreground mb-1">Sin datos de backlinks</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                El primer crawl se ejecuta automáticamente el jueves a las 5 AM.
                Los datos aparecerán aquí tras el primer análisis.
              </p>
            </div>
            {isAdmin && (
              <TriggerCrawlButton clientId={client.id} />
            )}
          </div>
        )}

        {/* KPI row */}
        {hasAnyData && lastSnapshot && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              label="Total backlinks"
              value={formatNum(lastSnapshot.totalBacklinks)}
              delta={
                deltaBacklinks !== null ? (
                  <span className={`font-mono text-[0.65rem] ${deltaBacklinks >= 0 ? "text-ds-green" : "text-ds-red"}`}>
                    {deltaBacklinks >= 0 ? "+" : ""}{deltaBacklinks}
                  </span>
                ) : undefined
              }
            />
            <KpiCard
              label="Dominios referentes"
              value={formatNum(lastSnapshot.uniqueDomains)}
              delta={
                deltaDomains !== null ? (
                  <span className={`font-mono text-[0.65rem] ${deltaDomains >= 0 ? "text-ds-green" : "text-ds-red"}`}>
                    {deltaDomains >= 0 ? "+" : ""}{deltaDomains}
                  </span>
                ) : undefined
              }
            />
            <KpiCard
              label="DA promedio"
              value={lastSnapshot.avgDomainRank !== null ? lastSnapshot.avgDomainRank.toFixed(1) : "—"}
            />
            <KpiCard
              label="Δ esta semana"
              value={`+${gained} / -${lost}`}
              valueColor={deltaColor}
              delta={
                <span className="font-mono text-[0.6rem] text-muted-foreground">jueves 5 AM</span>
              }
            />
          </div>
        )}

        {/* Evolución */}
        {hasAnyData && (
          <section>
            <SectionHeader>Evolución</SectionHeader>
            <div className="bg-card rounded-xl border border-border p-6">
              <BacklinksEvolutionChart snapshots={chartData} />
            </div>
          </section>
        )}

        {/* Top backlinks */}
        {hasAnyData && (
          <section>
            <SectionHeader>Top backlinks por autoridad</SectionHeader>
            {topBacklinks.length === 0 ? (
              <div className="bg-card rounded-xl border border-border p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  Sin backlinks trackeados aún. El primer crawl se ejecuta el próximo jueves a las 5 AM.
                </p>
              </div>
            ) : (
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground px-4 py-3">
                        Dominio fuente
                      </th>
                      <th className="text-center font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground px-3 py-3 w-16">
                        DA
                      </th>
                      <th className="text-left font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground px-3 py-3">
                        Anchor text
                      </th>
                      <th className="text-center font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground px-3 py-3 w-20">
                        Tipo
                      </th>
                      <th className="text-right font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground px-4 py-3 w-24">
                        Primer det.
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {topBacklinks.map((bl, i) => (
                      <tr
                        key={bl.id}
                        className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                      >
                        <td className="px-4 py-2.5">
                          <span
                            className="font-mono text-xs text-foreground max-w-[180px] truncate block"
                            title={bl.sourceDomain}
                          >
                            {bl.sourceDomain}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {bl.domainAuthority !== null ? (
                            <span
                              className={`inline-flex items-center justify-center font-mono text-[0.65rem] px-1.5 py-0.5 rounded border ${daBadgeClass(bl.domainAuthority)}`}
                            >
                              {bl.domainAuthority}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className="text-xs text-muted-foreground max-w-[160px] truncate block"
                            title={bl.anchorText ?? undefined}
                          >
                            {bl.anchorText ?? <span className="italic opacity-50">sin anchor</span>}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {bl.followType === "follow" ? (
                            <span title="Dofollow" className="flex justify-center">
                              <CheckCircle2 className="h-3.5 w-3.5 text-ds-green" />
                            </span>
                          ) : (
                            <span title={bl.followType} className="flex justify-center">
                              <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-[0.65rem] text-muted-foreground">
                          {formatDate(bl.firstSeen)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Cambios recientes */}
        {hasAnyData && (gained > 0 || lost > 0) && (
          <section>
            <SectionHeader>Cambios esta semana</SectionHeader>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Ganados */}
              <div>
                <p className="font-mono text-[0.6rem] uppercase tracking-wider text-ds-green mb-3">
                  Ganados ({recentGained.length})
                </p>
                {recentGained.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sin nuevos backlinks esta semana.</p>
                ) : (
                  <div className="space-y-2">
                    {recentGained.map((bl) => (
                      <div
                        key={bl.id}
                        className="flex items-center justify-between gap-3 bg-card rounded-lg border border-ds-gd/30 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="font-mono text-xs text-foreground truncate">{bl.sourceDomain}</p>
                          {bl.anchorText && (
                            <p className="text-[0.65rem] text-muted-foreground truncate mt-0.5">
                              {bl.anchorText}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {bl.domainAuthority !== null && (
                            <span className={`font-mono text-[0.6rem] px-1.5 py-0.5 rounded border ${daBadgeClass(bl.domainAuthority)}`}>
                              DA {bl.domainAuthority}
                            </span>
                          )}
                          <span className="font-mono text-[0.6rem] text-muted-foreground">
                            {formatDate(bl.firstSeen)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Perdidos */}
              <div>
                <p className="font-mono text-[0.6rem] uppercase tracking-wider text-ds-red mb-3">
                  Perdidos ({recentLost.length})
                </p>
                {recentLost.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sin backlinks perdidos esta semana.</p>
                ) : (
                  <div className="space-y-2">
                    {recentLost.map((bl) => (
                      <div
                        key={bl.id}
                        className="flex items-center justify-between gap-3 bg-card rounded-lg border border-ds-red/20 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="font-mono text-xs text-foreground truncate">{bl.sourceDomain}</p>
                          {bl.anchorText && (
                            <p className="text-[0.65rem] text-muted-foreground truncate mt-0.5">
                              {bl.anchorText}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {bl.domainAuthority !== null && (
                            <span className={`font-mono text-[0.6rem] px-1.5 py-0.5 rounded border ${daBadgeClass(bl.domainAuthority)}`}>
                              DA {bl.domainAuthority}
                            </span>
                          )}
                          <span className="font-mono text-[0.6rem] text-muted-foreground">
                            {bl.lostAt ? formatDate(bl.lostAt) : "—"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Footer */}
        {lastSnapshot && (
          <p className="font-mono text-[0.6rem] text-muted-foreground text-right">
            Última actualización: {formatDate(lastSnapshot.capturedAt)} · Próximo crawl: jueves 5 AM
          </p>
        )}
      </div>
    </div>
  );
}
