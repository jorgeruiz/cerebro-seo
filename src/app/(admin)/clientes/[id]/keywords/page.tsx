export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ArrowLeft, TrendingUp, Target, Star } from "lucide-react";
import { KeywordsTable } from "./KeywordsTable";
import { KeywordEvolutionChart } from "./KeywordEvolutionChart";

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
  const client = await getKeywordsData(params.id);
  if (!client) notFound();

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
      {/* Header */}
      <div className="border-b border-gray-100 bg-white px-8 py-5">
        <div className="flex items-center gap-3">
          <Link href={`/clientes/${client.id}`} className="text-gray-400 hover:text-gray-700 transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-indigo-500" />
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Keywords objetivo</h1>
              <p className="text-xs text-gray-400">
                {client.name} · {totalKeywords} keywords
                {priorityKeywords > 0 && ` · ${priorityKeywords} priority`}
              </p>
            </div>
          </div>
          {/* Visibilidad score */}
          {totalKeywords > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-gray-400">Visibilidad</span>
              <span className={`text-lg font-bold ${
                visibilityScore >= 60 ? "text-green-600"
                : visibilityScore >= 30 ? "text-amber-600"
                : "text-red-600"
              }`}>
                {visibilityScore}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="p-8 space-y-8">

        {/* Sin keywords */}
        {totalKeywords === 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 flex flex-col items-center gap-4 text-center">
            <div className="h-14 w-14 rounded-2xl bg-indigo-50 flex items-center justify-center">
              <Target className="h-7 w-7 text-indigo-400" />
            </div>
            <div>
              <p className="text-base font-semibold text-gray-800">Sin keywords configuradas</p>
              <p className="text-sm text-gray-400 mt-1 max-w-sm">
                Agrega keywords objetivo en el wizard de alta del cliente para comenzar a trackear posiciones.
              </p>
            </div>
          </div>
        )}

        {totalKeywords > 0 && (
          <>
            {/* KPI cards */}
            <section>
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
                Posiciones actuales
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Top 3", value: inTop3, color: "text-green-700 bg-green-50 border-green-200" },
                  { label: "Top 10", value: inTop10, color: "text-blue-700 bg-blue-50 border-blue-200" },
                  { label: "Top 30", value: inTop30, color: "text-indigo-700 bg-indigo-50 border-indigo-200" },
                  { label: "Fuera top 30", value: outTop30, color: outTop30 > 0 ? "text-red-700 bg-red-50 border-red-200" : "text-gray-500 bg-gray-50 border-gray-200" },
                ].map(({ label, value, color }) => (
                  <div key={label} className={`rounded-xl border p-4 flex flex-col items-center gap-1 ${color}`}>
                    <span className="text-3xl font-bold">{value}</span>
                    <span className="text-xs font-medium">{label}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Info de última actualización */}
            <div className="flex items-center gap-6 text-xs text-gray-400">
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
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
                Todas las keywords
              </h2>
              <KeywordsTable rows={rows} />
            </section>

            {/* Gráfica de evolución */}
            {rows.some((r) => r.history.length > 1) && (
              <section>
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
                  Evolución de posiciones
                </h2>
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
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
