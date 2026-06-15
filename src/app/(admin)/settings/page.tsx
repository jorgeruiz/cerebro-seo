export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { getSession } from "@/lib/auth";
import { dataCollectionQueue, aiAnalysisQueue, syncQueue } from "@/server/jobs/queues";
import { UserRole } from "@prisma/client";
import { SectionHeader } from "@/components/ui-darkui";
import {
  CheckCircle2, XCircle, AlertCircle, Clock, Database,
  Cpu, DollarSign, Shield, Activity,
} from "lucide-react";
import { env } from "@/env";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueueCounts {
  active: number;
  waiting: number;
  delayed: number;
  failed: number;
  completed: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const JOB_LABEL: Record<string, { label: string; schedule: string }> = {
  "tracking:rankings-priority": { label: "Rankings Priority",   schedule: "Diario · 3 AM" },
  "tracking:rankings-bulk":     { label: "Rankings Bulk",       schedule: "Lunes · 4 AM" },
  "insights:generate":          { label: "Insights",            schedule: "Diario · 6 AM" },
  "analysis:backlinks":         { label: "Backlinks",           schedule: "Jueves · 5 AM" },
  "analysis:competitors":       { label: "Competidores",        schedule: "Días 1 y 15 · 7 AM" },
  "analysis:ai-search":         { label: "AI Search",           schedule: "Viernes · 6 AM" },
  "crawler:audit-quick":        { label: "Audit Rápido",        schedule: "Miércoles · 2 AM" },
  "crawler:audit":              { label: "Audit Completo",      schedule: "Día 1 · 1 AM" },
  "cycle:close":                { label: "Cierre de Ciclo",     schedule: "Día 1 · 2 AM" },
  "report:monthly":             { label: "Reporte Mensual",     schedule: "Día 2 · 6 AM" },
  "sync:cerebro":               { label: "Sync Cerebro",        schedule: "Cada 6 horas" },
  "sync:cerebro-tasks":         { label: "Sync Tareas",         schedule: "Cada 15 min" },
};

const PROVIDER_LABEL: Record<string, string> = {
  dataforseo: "DataForSEO",
  gsc:        "Google Search Console",
  ga4:        "Google Analytics 4",
  claude:     "Anthropic Claude",
  pagespeed:  "PageSpeed Insights",
};

function relativeTime(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(d));
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getSystemData() {
  // DB health
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch { /* dbOk stays false */ }

  // Redis health
  let redisOk = false;
  try {
    await redis.ping();
    redisOk = true;
  } catch { /* redisOk stays false */ }

  // Queue counts (try/catch — no bloquear el render si BullMQ falla)
  let dataQueueCounts: QueueCounts | null = null;
  let aiQueueCounts: QueueCounts | null = null;
  let syncQueueCounts: QueueCounts | null = null;
  try {
    const [d, a, s] = await Promise.all([
      dataCollectionQueue.getJobCounts("active", "waiting", "delayed", "failed", "completed"),
      aiAnalysisQueue.getJobCounts("active", "waiting", "delayed", "failed", "completed"),
      syncQueue.getJobCounts("active", "waiting", "delayed", "failed", "completed"),
    ]);
    dataQueueCounts = d as unknown as QueueCounts;
    aiQueueCounts = a as unknown as QueueCounts;
    syncQueueCounts = s as unknown as QueueCounts;
  } catch { /* queue stats unavailable */ }

  // Últimas ejecuciones por job type (últimas 300 entradas, agrupar client-side)
  const recentLogs = await prisma.jobLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  // Agrupar: última ejecución por jobName
  const latestByJob = new Map<string, typeof recentLogs[0]>();
  for (const log of recentLogs) {
    if (!latestByJob.has(log.jobName)) {
      latestByJob.set(log.jobName, log);
    }
  }

  // Costos del mes actual
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const costsByProvider = await prisma.apiUsage.groupBy({
    by: ["provider"],
    where: { date: { gte: startOfMonth } },
    _sum: { cost: true },
    _count: { id: true },
    orderBy: { _sum: { cost: "desc" } },
  });

  const totalCostMonth = costsByProvider.reduce(
    (acc, r) => acc + Number(r._sum.cost ?? 0), 0
  );

  // Conteo de clientes
  const [totalClients, seoClients] = await Promise.all([
    prisma.client.count({ where: { status: "ACTIVE" } }),
    prisma.client.count({ where: { status: "ACTIVE", services: { has: "seo" } } }),
  ]);

  return {
    dbOk, redisOk,
    dataQueueCounts, aiQueueCounts, syncQueueCounts,
    latestByJob,
    costsByProvider, totalCostMonth,
    totalClients, seoClients,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-flex h-2 w-2 rounded-full shrink-0 ${ok ? "bg-ds-green" : "bg-destructive"}`} />
  );
}

function QueueCard({ label, counts }: { label: string; counts: QueueCounts | null }) {
  if (!counts) {
    return (
      <div className="bg-card rounded-xl border border-border p-4">
        <p className="text-xs font-mono text-muted-foreground mb-2">{label}</p>
        <p className="text-xs text-muted-foreground/50">Sin datos</p>
      </div>
    );
  }
  const hasFailures = counts.failed > 0;
  const hasActive = counts.active > 0;
  return (
    <div className={`bg-card rounded-xl border p-4 ${hasFailures ? "border-destructive/30" : "border-border"}`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-wide">{label}</p>
        {hasActive && (
          <span className="flex items-center gap-1 text-[10px] font-mono text-ds-blue">
            <Activity className="h-2.5 w-2.5" />
            activo
          </span>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "En cola", value: counts.waiting + counts.delayed, color: "text-muted-foreground" },
          { label: "Activos",  value: counts.active,   color: "text-ds-blue" },
          { label: "Fallidos", value: counts.failed,   color: counts.failed > 0 ? "text-destructive" : "text-muted-foreground" },
          { label: "Done",     value: counts.completed, color: "text-ds-green" },
        ].map(({ label: l, value, color }) => (
          <div key={l} className="text-center">
            <p className={`text-lg font-bold font-mono ${color}`}>{value.toLocaleString()}</p>
            <p className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-wide">{l}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SettingsPage() {
  const session = await getSession();
  if (session?.user?.role !== UserRole.ADMIN) return notFound();

  const {
    dbOk, redisOk,
    dataQueueCounts, aiQueueCounts, syncQueueCounts,
    latestByJob,
    costsByProvider, totalCostMonth,
    totalClients, seoClients,
  } = await getSystemData();

  const adminEmails = (env.ADMIN_EMAILS ?? "")
    .split(",").map((e) => e.trim()).filter(Boolean);

  const systemOk = dbOk && redisOk;

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-border bg-background px-8 py-5">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="font-display font-extrabold text-[clamp(1.4rem,2.5vw,2rem)] tracking-tight leading-[1.05] text-foreground">
              Sistema
            </h1>
            <p className="font-mono text-[0.75rem] text-muted-foreground mt-0.5">
              Estado de infraestructura · workers · costos
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <StatusDot ok={systemOk} />
            <span className={`text-xs font-mono ${systemOk ? "text-ds-green" : "text-destructive"}`}>
              {systemOk ? "Todo operativo" : "Hay problemas"}
            </span>
          </div>
        </div>
      </div>

      <div className="p-8 space-y-8">

        {/* ── Estado del sistema ───────────────────────────── */}
        <section>
          <SectionHeader>Estado del sistema</SectionHeader>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "PostgreSQL",  ok: dbOk,    icon: Database },
              { label: "Redis",       ok: redisOk, icon: Cpu },
              { label: "Clientes activos", value: totalClients, icon: Shield, neutral: true },
              { label: "Con SEO",    value: seoClients, icon: Activity, neutral: true },
            ].map(({ label, ok, value, icon: Icon, neutral }) => (
              <div key={label} className="bg-card rounded-xl border border-border p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {!neutral && <StatusDot ok={ok!} />}
                </div>
                {neutral ? (
                  <p className="text-2xl font-bold font-mono text-foreground">{value}</p>
                ) : (
                  <p className={`text-sm font-semibold ${ok ? "text-ds-green" : "text-destructive"}`}>
                    {ok ? "Conectado" : "Sin conexión"}
                  </p>
                )}
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">{label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Colas BullMQ ─────────────────────────────────── */}
        <section>
          <SectionHeader>Colas BullMQ</SectionHeader>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <QueueCard label="Data Collection" counts={dataQueueCounts} />
            <QueueCard label="AI Analysis"     counts={aiQueueCounts} />
            <QueueCard label="Sync"            counts={syncQueueCounts} />
          </div>
        </section>

        {/* ── Últimas ejecuciones ───────────────────────────── */}
        <section>
          <SectionHeader>Workers — últimas ejecuciones</SectionHeader>
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Worker</th>
                  <th className="text-left px-4 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground hidden sm:table-cell">Schedule</th>
                  <th className="text-left px-4 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Estado</th>
                  <th className="text-left px-4 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground hidden md:table-cell">Último run</th>
                  <th className="text-right px-4 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground hidden lg:table-cell">Intentos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Object.entries(JOB_LABEL).map(([jobName, { label, schedule }]) => {
                  const log = latestByJob.get(jobName);
                  const isOk = log?.status === "success";
                  const isFailed = log?.status === "failed";

                  return (
                    <tr key={jobName} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{label}</p>
                        <p className="font-mono text-[9px] text-muted-foreground/50 mt-0.5">{jobName}</p>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="font-mono text-muted-foreground">{schedule}</span>
                      </td>
                      <td className="px-4 py-3">
                        {!log ? (
                          <span className="flex items-center gap-1.5 text-muted-foreground/40">
                            <Clock className="h-3 w-3" />
                            Sin datos
                          </span>
                        ) : isOk ? (
                          <span className="flex items-center gap-1.5 text-ds-green">
                            <CheckCircle2 className="h-3 w-3" />
                            OK
                          </span>
                        ) : isFailed ? (
                          <span className="flex items-center gap-1.5 text-destructive">
                            <XCircle className="h-3 w-3" />
                            Error
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-ds-yellow">
                            <AlertCircle className="h-3 w-3" />
                            {log.status}
                          </span>
                        )}
                        {isFailed && log.error && (
                          <p className="font-mono text-[9px] text-destructive/70 mt-0.5 truncate max-w-[200px]" title={log.error}>
                            {log.error.slice(0, 60)}{log.error.length > 60 ? "…" : ""}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {log ? (
                          <span className="font-mono text-muted-foreground" title={fmtDate(log.createdAt)}>
                            {relativeTime(log.createdAt)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/30">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right hidden lg:table-cell">
                        {log ? (
                          <span className="font-mono text-muted-foreground">{log.attempts}</span>
                        ) : (
                          <span className="text-muted-foreground/30">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Costos del mes ────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <SectionHeader>Costos del mes</SectionHeader>
            <span className="font-mono text-sm font-bold text-foreground">
              ${totalCostMonth.toFixed(4)} USD
            </span>
          </div>
          {costsByProvider.length === 0 ? (
            <div className="bg-card rounded-xl border border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">Sin consumo registrado este mes.</p>
            </div>
          ) : (
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Proveedor</th>
                    <th className="text-right px-4 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Requests</th>
                    <th className="text-right px-4 py-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Costo USD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {costsByProvider.map((row) => {
                    const cost = Number(row._sum.cost ?? 0);
                    const pct = totalCostMonth > 0 ? (cost / totalCostMonth) * 100 : 0;
                    return (
                      <tr key={row.provider} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <DollarSign className="h-3 w-3 text-muted-foreground/40" />
                            <span className="text-foreground font-medium">
                              {PROVIDER_LABEL[row.provider] ?? row.provider}
                            </span>
                          </div>
                          {totalCostMonth > 0 && (
                            <div className="mt-1.5 h-0.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full bg-primary/60 rounded-full"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                          {row._count.id.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-foreground font-semibold">
                          ${cost.toFixed(4)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Admins ───────────────────────────────────────── */}
        <section>
          <SectionHeader>Acceso ADMIN</SectionHeader>
          <div className="bg-card rounded-xl border border-border p-4 flex flex-wrap gap-2">
            {adminEmails.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin ADMIN_EMAILS configurados — roles desde BD.
              </p>
            ) : (
              adminEmails.map((email) => (
                <span
                  key={email}
                  className="flex items-center gap-1.5 text-xs font-mono bg-primary/10 border border-primary/30 text-foreground px-3 py-1.5 rounded-lg"
                >
                  <Shield className="h-3 w-3 text-primary" />
                  {email}
                </span>
              ))
            )}
          </div>
          <p className="font-mono text-[0.68rem] text-muted-foreground/40 mt-2">
            Configurado en Easypanel → cerebro-seo → ADMIN_EMAILS
          </p>
        </section>

      </div>
    </div>
  );
}
