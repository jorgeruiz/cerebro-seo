export const dynamic = "force-dynamic";

import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  LayoutDashboard,
  Users,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CheckCircle2,
  Lightbulb,
  FileText,
  Clock,
  Activity,
} from "lucide-react";
import { KpiCard, SectionHeader } from "@/components/ui-darkui";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtRelative(d: Date): string {
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays === 0) return "hoy";
  if (diffDays === 1) return "ayer";
  if (diffDays < 7) return `hace ${diffDays} días`;
  return `hace ${Math.floor(diffDays / 7)} sem.`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  await getSession(); // ensure auth

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

  const seoWhere = { status: "ACTIVE" as const, services: { has: "seo" } };

  const [
    totalClientes,
    totalKeywords,
    top10Groups,
    totalInsights,
    criticalInsights,
    recentRankings,
    recentInsights,
    recentReports,
    cycleClients,
  ] = await Promise.all([

    // 1. Total clientes SEO activos
    prisma.client.count({ where: seoWhere }),

    // 2. Total keywords trackeadas (no eliminadas)
    prisma.keyword.count({
      where: { client: seoWhere, deletedAt: null },
    }),

    // 3. Keywords en top-10 últimos 30 días (distinct por keyword)
    prisma.keywordRanking.groupBy({
      by: ["keywordId"],
      where: {
        keyword: { client: seoWhere, deletedAt: null },
        position: { lte: 10 },
        date: { gte: thirtyDaysAgo },
      },
    }),

    // 4. Total insights activos (no dismissidos)
    prisma.insight.count({
      where: {
        client: seoWhere,
        dismissed: false,
        acknowledgedAt: null,
      },
    }),

    // 5. Insights críticos con cliente
    prisma.insight.findMany({
      where: {
        client: seoWhere,
        severity: "critical",
        dismissed: false,
        acknowledgedAt: null,
      },
      select: {
        id: true,
        title: true,
        generatedAt: true,
        client: { select: { id: true, name: true } },
      },
      orderBy: { generatedAt: "desc" },
      take: 10,
    }),

    // 6. Rankings con movimiento significativo últimos 7 días
    prisma.keywordRanking.findMany({
      where: {
        keyword: { client: seoWhere, deletedAt: null },
        date: { gte: sevenDaysAgo },
        delta: { not: null },
      },
      include: {
        keyword: { select: { term: true, client: { select: { id: true, name: true } } } },
      },
      orderBy: { date: "desc" },
      take: 100,
    }),

    // 7. Insights recientes (7 días) no críticos
    prisma.insight.findMany({
      where: {
        client: seoWhere,
        generatedAt: { gte: sevenDaysAgo },
        severity: { not: "critical" },
        dismissed: false,
      },
      select: {
        id: true,
        title: true,
        severity: true,
        generatedAt: true,
        client: { select: { id: true, name: true } },
      },
      orderBy: { generatedAt: "desc" },
      take: 8,
    }),

    // 8. Reportes mensuales recientes (30 días)
    prisma.monthlyReport.findMany({
      where: {
        client: seoWhere,
        createdAt: { gte: thirtyDaysAgo },
      },
      select: {
        id: true,
        yearMonth: true,
        createdAt: true,
        client: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),

    // 9. Estado de ciclos de todos los clientes SEO
    prisma.client.findMany({
      where: seoWhere,
      select: {
        id: true,
        name: true,
        domain: true,
        cycles: {
          where: { status: { in: ["ACTIVE", "PLANNING", "CLOSING"] } },
          orderBy: { yearMonth: "desc" },
          take: 1,
          select: {
            id: true,
            yearMonth: true,
            status: true,
            tasks: {
              select: { id: true, status: true },
            },
            hypotheses: {
              select: { id: true, validation: true },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  // ── Procesar rankings: filtrar |delta| >= 3 y separar subidas/bajadas ──────
  const significantMovements = recentRankings
    .filter((r) => Math.abs(r.delta ?? 0) >= 3)
    .slice(0, 15);

  const subidas = significantMovements.filter((r) => (r.delta ?? 0) < 0); // delta negativo = subió posición
  const bajadas = significantMovements.filter((r) => (r.delta ?? 0) > 0);

  const inTop10 = top10Groups.length;

  // ── Clientes con alertas críticas agrupados ───────────────────────────────
  const alertsByClient = criticalInsights.reduce<
    Record<string, { name: string; id: string; count: number }>
  >((acc, ins) => {
    const { id, name } = ins.client;
    acc[id] = acc[id] ?? { id, name, count: 0 };
    acc[id].count++;
    return acc;
  }, {});
  const alertClients = Object.values(alertsByClient).sort((a, b) => b.count - a.count);

  // ── Ciclos: calcular completion rate ─────────────────────────────────────
  const cycleRows = cycleClients.map((c) => {
    const cycle = c.cycles[0] ?? null;
    const tasks = cycle?.tasks ?? [];
    const done = tasks.filter((t) => t.status === "DONE").length;
    const total = tasks.length;
    const hypotheses = cycle?.hypotheses ?? [];
    const validated = hypotheses.filter((h) => h.validation === "VALIDATED").length;
    return { ...c, cycle, done, total, validated, hypothesesTotal: hypotheses.length };
  });

  const CYCLE_STATUS: Record<string, { label: string; cls: string }> = {
    ACTIVE:   { label: "Activo",       cls: "text-ds-green bg-ds-green/10 border-ds-green/30" },
    PLANNING: { label: "Planificando", cls: "text-ds-blue bg-ds-blue/10 border-ds-blue/30" },
    CLOSING:  { label: "Cerrando",     cls: "text-ds-orange bg-ds-orange/10 border-ds-orange/30" },
    CLOSED:   { label: "Cerrado",      cls: "text-muted-foreground bg-muted border-border" },
  };

  const SEVERITY_COLOR: Record<string, string> = {
    HIGH:   "text-ds-red",
    MEDIUM: "text-ds-yellow",
    LOW:    "text-muted-foreground",
  };

  return (
    <div className="min-h-full">
      <div className="p-4 sm:p-6 lg:p-8 space-y-8">

        {/* Header */}
        <div>
          <h1 className="font-display font-extrabold text-[clamp(1.6rem,2.5vw,2.4rem)] tracking-tight leading-[1.05] text-foreground flex items-center gap-3">
            <LayoutDashboard className="h-6 w-6 text-primary shrink-0" />
            Dashboard SEO
          </h1>
          <p className="font-mono text-[0.75rem] text-muted-foreground mt-1">
            {totalClientes} clientes SEO activos · datos en tiempo real
          </p>
        </div>

        {/* KPIs globales */}
        <section>
          <SectionHeader>Métricas globales</SectionHeader>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              label="Clientes SEO"
              value={String(totalClientes)}
              icon={<Users className="h-4 w-4" />}
            />
            <KpiCard
              label="Keywords trackeadas"
              value={String(totalKeywords)}
              icon={<Activity className="h-4 w-4" />}
            />
            <KpiCard
              label="En top-10 (30d)"
              value={String(inTop10)}
              valueColor={inTop10 > 0 ? "green" : "default"}
              icon={<TrendingUp className="h-4 w-4" />}
            />
            <KpiCard
              label="Insights activos"
              value={String(totalInsights)}
              valueColor={criticalInsights.length > 0 ? "red" : "default"}
              icon={<Lightbulb className="h-4 w-4" />}
            />
          </div>
        </section>

        {/* Alertas + Actividad */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Alertas críticas */}
          <section>
            <SectionHeader>
              <span className="flex items-center gap-2">
                Alertas críticas
                {criticalInsights.length > 0 && (
                  <span className="font-mono text-[0.7rem] bg-destructive/10 border border-destructive/30 text-destructive rounded px-1.5 py-0.5">
                    {criticalInsights.length}
                  </span>
                )}
              </span>
            </SectionHeader>
            {alertClients.length === 0 ? (
              <div className="bg-card rounded-xl border border-ds-green/20 p-6 flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-ds-green shrink-0" />
                <p className="text-sm text-ds-green font-medium">Sin alertas críticas activas</p>
              </div>
            ) : (
              <div className="space-y-2">
                {alertClients.map((ac) => (
                  <Link
                    key={ac.id}
                    href={`/clientes/${ac.id}`}
                    className="flex items-center justify-between bg-card rounded-xl border border-destructive/20 p-4 hover:border-destructive/40 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                      <span className="text-sm font-medium text-foreground truncate">{ac.name}</span>
                    </div>
                    <span className="font-mono text-[0.75rem] text-destructive bg-destructive/10 border border-destructive/30 rounded px-2 py-0.5 shrink-0">
                      {ac.count} alerta{ac.count > 1 ? "s" : ""}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Actividad reciente */}
          <section>
            <SectionHeader>Actividad — últimos 7 días</SectionHeader>
            <div className="space-y-1.5">

              {/* Rankings subidas */}
              {subidas.slice(0, 3).map((r) => (
                <Link
                  key={r.id}
                  href={`/clientes/${r.keyword.client.id}/keywords`}
                  className="flex items-center gap-3 bg-card rounded-lg border border-border px-4 py-2.5 hover:border-ds-green/40 transition-colors"
                >
                  <TrendingUp className="h-3.5 w-3.5 text-ds-green shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{`"${r.keyword.term}"`}</p>
                    <p className="font-mono text-[0.68rem] text-muted-foreground">{r.keyword.client.name}</p>
                  </div>
                  <span className="font-mono text-[0.7rem] text-ds-green shrink-0">
                    +{Math.abs(r.delta ?? 0)} pos.
                  </span>
                </Link>
              ))}

              {/* Rankings bajadas */}
              {bajadas.slice(0, 2).map((r) => (
                <Link
                  key={r.id}
                  href={`/clientes/${r.keyword.client.id}/keywords`}
                  className="flex items-center gap-3 bg-card rounded-lg border border-border px-4 py-2.5 hover:border-ds-red/40 transition-colors"
                >
                  <TrendingDown className="h-3.5 w-3.5 text-ds-red shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{`"${r.keyword.term}"`}</p>
                    <p className="font-mono text-[0.68rem] text-muted-foreground">{r.keyword.client.name}</p>
                  </div>
                  <span className="font-mono text-[0.7rem] text-ds-red shrink-0">
                    -{Math.abs(r.delta ?? 0)} pos.
                  </span>
                </Link>
              ))}

              {/* Insights recientes */}
              {recentInsights.slice(0, 3).map((ins) => (
                <Link
                  key={ins.id}
                  href={`/clientes/${ins.client.id}`}
                  className="flex items-center gap-3 bg-card rounded-lg border border-border px-4 py-2.5 hover:border-primary/30 transition-colors"
                >
                  <Lightbulb className={`h-3.5 w-3.5 shrink-0 ${SEVERITY_COLOR[ins.severity] ?? "text-muted-foreground"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{ins.title}</p>
                    <p className="font-mono text-[0.68rem] text-muted-foreground">{ins.client.name}</p>
                  </div>
                  <span className="font-mono text-[0.65rem] text-muted-foreground shrink-0">
                    {fmtRelative(ins.generatedAt)}
                  </span>
                </Link>
              ))}

              {/* Reportes recientes */}
              {recentReports.slice(0, 2).map((r) => (
                <Link
                  key={r.id}
                  href={`/clientes/${r.client.id}/reporte`}
                  className="flex items-center gap-3 bg-card rounded-lg border border-border px-4 py-2.5 hover:border-primary/30 transition-colors"
                >
                  <FileText className="h-3.5 w-3.5 text-ds-blue shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">
                      Reporte {r.yearMonth} — {r.client.name}
                    </p>
                    <p className="font-mono text-[0.68rem] text-muted-foreground">Reporte mensual generado</p>
                  </div>
                  <span className="font-mono text-[0.65rem] text-muted-foreground shrink-0">
                    {fmtRelative(r.createdAt)}
                  </span>
                </Link>
              ))}

              {subidas.length === 0 && bajadas.length === 0 && recentInsights.length === 0 && recentReports.length === 0 && (
                <div className="bg-card rounded-xl border border-border p-6 text-center">
                  <Clock className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">Sin actividad en los últimos 7 días</p>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Estado de ciclos */}
        <section>
          <SectionHeader>
            <span className="flex items-center gap-2">
              Ciclos activos
              <span className="font-mono text-[0.7rem] bg-muted border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                {cycleRows.filter((c) => c.cycle).length} de {totalClientes}
              </span>
            </span>
          </SectionHeader>
          <div className="rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-xs min-w-[600px]">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">Cliente</th>
                  <th className="text-center px-4 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">Ciclo</th>
                  <th className="text-center px-4 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">Estado</th>
                  <th className="text-right px-4 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">Tareas</th>
                  <th className="text-right px-4 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Hipótesis</th>
                </tr>
              </thead>
              <tbody>
                {cycleRows.map((row) => {
                  const cs = row.cycle ? CYCLE_STATUS[row.cycle.status] : null;
                  return (
                    <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <Link href={`/clientes/${row.id}`} className="hover:text-primary transition-colors">
                          <p className="font-medium text-foreground">{row.name}</p>
                          <p className="font-mono text-[0.68rem] text-muted-foreground">{row.domain}</p>
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-center font-mono text-[0.75rem] text-muted-foreground">
                        {row.cycle?.yearMonth ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {cs ? (
                          <span className={`font-mono text-[0.65rem] uppercase tracking-wide px-1.5 py-0.5 rounded border ${cs.cls}`}>
                            {cs.label}
                          </span>
                        ) : (
                          <span className="font-mono text-[0.65rem] text-muted-foreground/50">Sin ciclo</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {row.total > 0 ? (
                          <span className={`font-mono text-[0.75rem] ${row.done === row.total ? "text-ds-green" : "text-foreground"}`}>
                            {row.done}/{row.total}
                          </span>
                        ) : (
                          <span className="font-mono text-[0.75rem] text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right hidden lg:table-cell">
                        {row.hypothesesTotal > 0 ? (
                          <span className={`font-mono text-[0.75rem] ${row.validated === row.hypothesesTotal ? "text-ds-green" : "text-foreground"}`}>
                            {row.validated}/{row.hypothesesTotal}
                          </span>
                        ) : (
                          <span className="font-mono text-[0.75rem] text-muted-foreground/50">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Rankings: top movimientos semana */}
        {significantMovements.length > 0 && (
          <section>
            <SectionHeader>
              <span className="flex items-center gap-2">
                Movimientos de ranking — últimos 7 días
                <span className="font-mono text-[0.7rem] bg-muted border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                  {significantMovements.length}
                </span>
              </span>
            </SectionHeader>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {significantMovements.map((r) => {
                const up = (r.delta ?? 0) < 0;
                return (
                  <Link
                    key={r.id}
                    href={`/clientes/${r.keyword.client.id}/keywords`}
                    className="flex items-center gap-3 bg-card rounded-lg border border-border px-4 py-3 hover:border-primary/30 transition-colors"
                  >
                    {up
                      ? <TrendingUp className="h-4 w-4 text-ds-green shrink-0" />
                      : <TrendingDown className="h-4 w-4 text-ds-red shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{`"${r.keyword.term}"`}</p>
                      <p className="font-mono text-[0.68rem] text-muted-foreground">{r.keyword.client.name}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`font-mono text-[0.8rem] font-bold ${up ? "text-ds-green" : "text-ds-red"}`}>
                        {up ? "+" : "-"}{Math.abs(r.delta ?? 0)}
                      </p>
                      <p className="font-mono text-[0.65rem] text-muted-foreground">
                        pos. {r.position}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* Footer */}
        <p className="font-mono text-[0.7rem] text-muted-foreground text-right">
          Cerebro SEO · Click Society · datos en tiempo real desde BD
        </p>

      </div>
    </div>
  );
}
