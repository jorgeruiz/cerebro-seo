export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import { ArrowLeft, Zap, CheckCircle2, XCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SectionHeader, KpiCard } from "@/components/ui-darkui";
import { AiVisibilityChart } from "./AiVisibilityChart";
import { TriggerAiSearchButton } from "./TriggerAiSearchButton";
import { AiSearchClipboardButton } from "./AiSearchClipboardButton";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" });
}

function formatWeek(d: Date): string {
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

function llmLabel(source: string): string {
  const map: Record<string, string> = {
    claude: "Claude (Anthropic)",
    gpt: "ChatGPT (OpenAI)",
    gemini: "Gemini (Google)",
    perplexity: "Perplexity",
  };
  return map[source] ?? source;
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getAiSearchData(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, domain: true, services: true },
  });
  if (!client) return null;

  // Últimas 12 semanas de registros
  const since = new Date(Date.now() - 84 * 24 * 3600 * 1000); // 12 semanas

  const records = await prisma.aiSearchVisibility.findMany({
    where: { clientId, date: { gte: since } },
    orderBy: { date: "desc" },
  });

  return { client, records };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AiSearchPage({
  params,
}: {
  params: { id: string };
}) {
  const [data, session] = await Promise.all([
    getAiSearchData(params.id),
    getSession(),
  ]);

  if (!data) notFound();
  const { client, records } = data;

  if (!client.services.includes("seo")) {
    redirect(`/clientes/${client.id}`);
  }

  const isAdmin = session?.user?.role === UserRole.ADMIN;
  const hasData = records.length > 0;

  // ── Métricas generales ─────────────────────────────────────────────────────

  const totalQueries = records.length;
  const mentionedTotal = records.filter((r) => r.mentioned).length;
  const mentionRate = totalQueries > 0 ? Math.round((mentionedTotal / totalQueries) * 100) : 0;

  // Posición promedio cuando aparece
  const posRecords = records.filter((r) => r.position !== null);
  const avgPosition =
    posRecords.length > 0
      ? (posRecords.reduce((sum, r) => sum + (r.position ?? 0), 0) / posRecords.length).toFixed(1)
      : null;

  // Último run
  const lastRun = records[0]?.date ?? null;

  // ── Gráfica de tendencia semanal ──────────────────────────────────────────

  // Agrupar por semana (lunes)
  const weekMap = new Map<string, { mentioned: number; total: number; date: Date }>();
  for (const rec of records) {
    const d = new Date(rec.date);
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // retroceder al lunes
    const key = monday.toISOString().slice(0, 10);
    const entry = weekMap.get(key) ?? { mentioned: 0, total: 0, date: monday };
    entry.total++;
    if (rec.mentioned) entry.mentioned++;
    weekMap.set(key, entry);
  }
  const chartData = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({
      label: formatWeek(v.date),
      mentionRate: v.total > 0 ? Math.round((v.mentioned / v.total) * 100) : 0,
    }));

  // ── Registros más recientes (última sesión) ───────────────────────────────

  // Agrupar por día para mostrar la última sesión
  const latestDate = lastRun ? new Date(lastRun).toISOString().slice(0, 10) : null;
  const latestRecords = latestDate
    ? records.filter((r) => new Date(r.date).toISOString().slice(0, 10) === latestDate)
    : [];

  // ── Desglose por fuente LLM ───────────────────────────────────────────────

  const sourceMap = new Map<string, { mentioned: number; total: number }>();
  for (const rec of records) {
    const entry = sourceMap.get(rec.llmSource) ?? { mentioned: 0, total: 0 };
    entry.total++;
    if (rec.mentioned) entry.mentioned++;
    sourceMap.set(rec.llmSource, entry);
  }

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
              <Zap className="h-6 w-6 text-ds-yellow shrink-0" />
              AI Search Visibility
            </h1>
            <p className="font-mono text-[0.75rem] text-muted-foreground mt-1">
              {client.domain} · ¿te mencionan los LLMs cuando buscan lo que ofreces?
            </p>
          </div>
          {isAdmin && <TriggerAiSearchButton clientId={client.id} />}
        </div>

        {/* Empty state */}
        {!hasData && (
          <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center justify-center gap-4 text-center">
            <Zap className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="text-base font-medium text-foreground mb-1">Sin datos de visibilidad aún</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                El análisis se ejecuta automáticamente cada viernes a las 6 AM.
                Requiere al menos una keyword prioritaria configurada.
              </p>
            </div>
            {isAdmin && <TriggerAiSearchButton clientId={client.id} />}
          </div>
        )}

        {/* KPI row */}
        {hasData && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              label="Tasa de mención"
              value={`${mentionRate}%`}
              valueColor={mentionRate >= 60 ? "green" : mentionRate >= 30 ? "default" : "red"}
            />
            <KpiCard
              label="Queries con mención"
              value={`${mentionedTotal} / ${totalQueries}`}
            />
            <KpiCard
              label="Posición promedio"
              value={avgPosition ?? "—"}
              delta={
                avgPosition
                  ? <span className="font-mono text-[0.7rem] text-muted-foreground">cuando aparece</span>
                  : undefined
              }
            />
            <KpiCard
              label="Último análisis"
              value={lastRun ? formatDate(lastRun) : "—"}
              delta={
                <span className="font-mono text-[0.7rem] text-muted-foreground">viernes 6 AM</span>
              }
            />
          </div>
        )}

        {/* Gráfica de tendencia */}
        {hasData && chartData.length >= 2 && (
          <section>
            <SectionHeader>Visibilidad semanal</SectionHeader>
            <div className="bg-card rounded-xl border border-border p-6">
              <p className="font-mono text-[0.7rem] text-muted-foreground mb-4">
                % de queries donde el cliente fue mencionado por Claude al simular búsquedas de sus keywords
              </p>
              <AiVisibilityChart data={chartData} />
            </div>
          </section>
        )}

        {/* Desglose por LLM */}
        {hasData && sourceMap.size > 0 && (
          <section>
            <SectionHeader>Por fuente LLM</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from(sourceMap.entries()).map(([source, stats]) => {
                const rate = Math.round((stats.mentioned / stats.total) * 100);
                return (
                  <div key={source} className="bg-card rounded-xl border border-border p-5">
                    <p className="font-mono text-xs font-medium text-foreground mb-3">
                      {llmLabel(source)}
                    </p>
                    <div className="flex items-end gap-3">
                      <span
                        className={`font-display font-bold text-2xl ${
                          rate >= 60
                            ? "text-ds-green"
                            : rate >= 30
                            ? "text-ds-yellow"
                            : "text-ds-red"
                        }`}
                      >
                        {rate}%
                      </span>
                      <span className="font-mono text-[0.75rem] text-muted-foreground mb-1">
                        {stats.mentioned}/{stats.total} queries
                      </span>
                    </div>
                    <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          rate >= 60
                            ? "bg-ds-green"
                            : rate >= 30
                            ? "bg-ds-yellow"
                            : "bg-ds-red"
                        }`}
                        style={{ width: `${rate}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Última sesión — detalle de queries */}
        {hasData && latestRecords.length > 0 && (
          <section>
            <SectionHeader>
              Última sesión · {lastRun ? formatDate(lastRun) : ""}
            </SectionHeader>
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="w-10 px-2 py-3" />
                    <th className="text-left font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground px-4 py-3">
                      Query
                    </th>
                    <th className="text-center font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground px-3 py-3 w-24">
                      Mención
                    </th>
                    <th className="text-center font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground px-3 py-3 w-16">
                      Pos.
                    </th>
                    <th className="text-left font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground px-4 py-3">
                      Contexto
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {latestRecords.map((rec, i) => (
                    <tr
                      key={rec.id}
                      className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                    >
                      <td className="px-2 py-3">
                        <AiSearchClipboardButton
                          query={rec.query}
                          mentioned={rec.mentioned}
                          position={rec.position}
                          context={rec.context}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-xs text-foreground max-w-[280px] truncate block"
                          title={rec.query}
                        >
                          {rec.query}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        {rec.mentioned ? (
                          <span className="flex justify-center" title="Mencionado">
                            <CheckCircle2 className="h-4 w-4 text-ds-green" />
                          </span>
                        ) : (
                          <span className="flex justify-center" title="No mencionado">
                            <XCircle className="h-4 w-4 text-muted-foreground/40" />
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center font-mono text-xs text-muted-foreground">
                        {rec.position !== null ? `#${rec.position}` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {rec.context ? (
                          <span
                            className="font-mono text-[0.75rem] text-muted-foreground max-w-[260px] truncate block"
                            title={rec.context}
                          >
                            {rec.context}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/30 text-xs italic">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Historial completo (queries anteriores) */}
        {hasData && records.length > latestRecords.length && (
          <section>
            <SectionHeader>Historial de queries</SectionHeader>
            <div className="space-y-1">
              {/* Agrupar por semana y mostrar resumen */}
              {Array.from(weekMap.entries())
                .sort(([a], [b]) => b.localeCompare(a)) // desc
                .map(([weekKey, weekData]) => {
                  const rate = weekData.total > 0
                    ? Math.round((weekData.mentioned / weekData.total) * 100)
                    : 0;
                  return (
                    <div
                      key={weekKey}
                      className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-border bg-card"
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        Semana del {formatWeek(weekData.date)}
                      </span>
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-[0.75rem] text-muted-foreground">
                          {weekData.mentioned}/{weekData.total} menciones
                        </span>
                        <span
                          className={`font-mono text-xs font-medium ${
                            rate >= 60
                              ? "text-ds-green"
                              : rate >= 30
                              ? "text-ds-yellow"
                              : "text-muted-foreground"
                          }`}
                        >
                          {rate}%
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>
        )}

        {/* Nota metodológica */}
        {hasData && (
          <div className="bg-muted/30 rounded-xl border border-border p-4">
            <p className="font-mono text-[0.7rem] text-muted-foreground leading-relaxed">
              <span className="text-foreground font-medium">Metodología:</span> Cada viernes se generan queries en español
              basadas en las keywords prioritarias del cliente y se envían a Claude (Anthropic).
              Se detecta si el nombre o dominio del cliente aparece en las respuestas y en qué posición.
              Este método mide visibilidad en el conocimiento actual del modelo — no tráfico real desde LLMs.
            </p>
          </div>
        )}

        {/* Footer */}
        {lastRun && (
          <p className="font-mono text-[0.7rem] text-muted-foreground text-right">
            Último análisis: {formatDate(lastRun)} · Próximo: viernes 6 AM
          </p>
        )}
      </div>
    </div>
  );
}
