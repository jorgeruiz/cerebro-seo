export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import { ArrowLeft, TrendingUp, Target, Star, Settings } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui-darkui";
import { KeywordsTable } from "./KeywordsTable";
import { KeywordEvolutionChart } from "./KeywordEvolutionChart";
import { TriggerTrackingButton } from "./TriggerTrackingButton";

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getKeywordsData(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      domain: true,
      brandColor: true,
      keywords: {
        where: { deletedAt: null },
        orderBy: [{ isPriority: "desc" }, { term: "asc" }],
        include: {
          rankings: {
            orderBy: { date: "desc" },
            take: 31, // hoy + 30 días
          },
        },
      },
    },
  });
  return client;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KeywordRow {
  id: string;
  term: string;
  isPriority: boolean;
  country: string;
  targetUrl: string | null;
  currentPosition: number | null;
  rankingUrl: string | null;
  delta7d: number | null;
  delta30d: number | null;
  lastTracked: Date | null;
  history: Array<{ date: Date; position: number | null }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildKeywordRows(
  keywords: NonNullable<Awaited<ReturnType<typeof getKeywordsData>>>["keywords"]
): KeywordRow[] {
  return keywords.map((kw) => {
    const sorted = [...kw.rankings].sort((a, b) => +b.date - +a.date);
    const latest = sorted[0] ?? null;

    // Delta 7d: posición hoy vs posición hace 7 días
    const rank7dAgo = sorted.find((r) => {
      const daysAgo = (Date.now() - +r.date) / 86400000;
      return daysAgo >= 6 && daysAgo <= 8;
    });
    const delta7d =
      latest?.position != null && rank7dAgo?.position != null
        ? rank7dAgo.position - latest.position
        : null;

    // Delta 30d
    const rank30dAgo = sorted.find((r) => {
      const daysAgo = (Date.now() - +r.date) / 86400000;
      return daysAgo >= 28 && daysAgo <= 32;
    });
    const delta30d =
      latest?.position != null && rank30dAgo?.position != null
        ? rank30dAgo.position - latest.position
        : null;

    return {
      id: kw.id,
      term: kw.term,
      isPriority: kw.isPriority,
      country: kw.country,
      targetUrl: kw.targetUrl,
      currentPosition: latest?.position ?? null,
      rankingUrl: latest?.rankingUrl ?? null,
      delta7d,
      delta30d,
      lastTracked: latest?.date ?? null,
      history: sorted.slice(0, 31).map((r) => ({ date: r.date, position: r.position })),
    };
  });
}

// ─── Score de visibilidad ─────────────────────────────────────────────────────

function calcVisibilityScore(rows: KeywordRow[]): number {
  const ranked = rows.filter((r) => r.currentPosition !== null);
  if (ranked.length === 0) return 0;
  const sum = ranked.reduce((acc, r) => acc + (1 / (r.currentPosition! + 1)) * 100, 0);
  return Math.min(100, Math.round(sum / ranked.length));
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function KeywordsPage({ params }: { params: { id: string } }) {
  const [client, session] = await Promise.all([
    getKeywordsData(params.id),
    getSession(),
  ]);
  if (!client) notFound();

  const isAdmin = session?.user?.role === UserRole.ADMIN;

  const rows = buildKeywordRows(client.keywords);
  const totalKeywords = rows.length;
  const priorityKeywords = rows.filter((r) => r.isPriority).length;

  // KPI stats
  const inTop3 = rows.filter((r) => r.currentPosition !== null && r.currentPosition <= 3).length;
  const inTop10 = rows.filter((r) => r.currentPosition !== null && r.currentPosition <= 10).length;
  const inTop30 = rows.filter((r) => r.currentPosition !== null && r.currentPosition <= 30).length;
  const outTop30 = rows.filter((r) => r.currentPosition === null).length;
  const visibilityScore = calcVisibilityScore(rows);

  // Última fecha de tracking
  const lastPriorityDate = rows
    .filter((r) => r.isPriority && r.lastTracked)
    .sort((a, b) => +b.lastTracked! - +a.lastTracked!)[0]?.lastTracked ?? null;

  const lastBulkDate = rows
    .filter((r) => !r.isPriority && r.lastTracked)
    .sort((a, b) => +b.lastTracked! - +a.lastTracked!)[0]?.lastTracked ?? null;

  function fmtDate(d: Date | null) {
    if (!d) return "—";
    return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(d);
  }

  return (
    <div className="min-h-full">
      <div className="p-8 space-y-8">

        {/* Page header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <Link href={`/clientes/${client.id}`} className="text-muted-foreground hover:text-foreground transition-colors mt-1">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <TrendingUp className="h-4 w-4 text-primary" />
                <h1 className="font-display font-extrabold text-[clamp(1.4rem,2.5vw,2rem)] tracking-tight leading-[1.05] text-foreground">
                  Keywords objetivo
                </h1>
              </div>
              <p className="font-mono text-[0.65rem] text-muted-foreground">
                {client.name} · {totalKeywords} keywords{priorityKeywords > 0 && ` · ${priorityKeywords} priority`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1">
            {totalKeywords > 0 && (
              <span className={[
                "text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border",
                visibilityScore >= 60
                  ? "bg-primary/10 border-ds-gd text-ds-green"
                  : visibilityScore >= 30
                  ? "bg-ds-yellow/10 border-ds-yellow/40 text-ds-yellow"
                  : "bg-destructive/10 border-destructive/30 text-destructive",
              ].join(" ")}>
                Visibilidad {visibilityScore}
              </span>
            )}
            <Link
              href={`/clientes/${client.id}/configuracion`}
              className={buttonVariants({ variant: "outline-mono", size: "sm" }) + " gap-2"}
            >
              <Settings className="h-3.5 w-3.5" />
              Configurar keywords
            </Link>
            {isAdmin && <TriggerTrackingButton clientId={client.id} />}
          </div>
        </div>

        {/* Sin keywords */}
        {totalKeywords === 0 && (
          <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center gap-4 text-center">
            <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center">
              <Target className="h-7 w-7 text-muted-foreground/40" />
            </div>
            <div>
              <p className="text-base font-semibold text-foreground">Sin keywords configuradas</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Agrega keywords objetivo en{" "}
                <Link href={`/clientes/${client.id}/configuracion`} className="text-primary hover:underline">
                  Configuración
                </Link>{" "}
                para comenzar a trackear posiciones.
              </p>
            </div>
          </div>
        )}

        {totalKeywords > 0 && (
          <>
            {/* KPI cards */}
            <section>
              <SectionHeader>Posiciones actuales</SectionHeader>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Top 3",        value: inTop3,    color: "text-ds-green  bg-primary/10  border-ds-gd" },
                  { label: "Top 10",       value: inTop10,   color: "text-ds-blue   bg-ds-blue/10  border-ds-blue/30" },
                  { label: "Top 30",       value: inTop30,   color: "text-primary   bg-primary/10  border-primary/30" },
                  { label: "Fuera top 30", value: outTop30,  color: outTop30 > 0 ? "text-destructive bg-destructive/10 border-destructive/30" : "text-muted-foreground bg-muted border-border" },
                ].map(({ label, value, color }) => (
                  <div key={label} className={`rounded-xl border p-4 flex flex-col items-center gap-1 ${color}`}>
                    <span className="font-display text-3xl font-bold">{value}</span>
                    <span className="text-[10px] font-mono uppercase tracking-wide">{label}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Info de última actualización */}
            <div className="flex items-center gap-6 text-xs font-mono text-muted-foreground/60">
              {lastPriorityDate && (
                <span className="flex items-center gap-1.5">
                  <Star className="h-3 w-3" />
                  Priority: último tracking {fmtDate(lastPriorityDate)}
                </span>
              )}
              {lastBulkDate && (
                <span>Bulk: último tracking {fmtDate(lastBulkDate)}</span>
              )}
              {!lastPriorityDate && !lastBulkDate && (
                <span>Sin datos de tracking aún — el primer ciclo corre automáticamente según el schedule</span>
              )}
            </div>

            {/* Tabla de keywords */}
            <section>
              <SectionHeader>Todas las keywords</SectionHeader>
              <KeywordsTable rows={rows} />
            </section>

            {/* Gráfica de evolución */}
            {rows.some((r) => r.history.length > 1) && (
              <section>
                <SectionHeader>Evolución de posiciones</SectionHeader>
                <div className="bg-card rounded-xl border border-border p-6">
                  <KeywordEvolutionChart rows={rows.filter((r) => r.history.length > 1)} />
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
