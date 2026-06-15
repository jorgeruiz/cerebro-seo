export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  ArrowLeft,
  Clock,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  FileSearch,
  Link2,
  Lightbulb,
  FileText,
  Sparkles,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui-darkui";

// ─── Tipos de evento ──────────────────────────────────────────────────────────

type EventKind =
  | "ranking-up"
  | "ranking-down"
  | "task-done"
  | "audit"
  | "backlink-snapshot"
  | "insight"
  | "report"
  | "analysis";

interface TimelineEvent {
  id: string;
  kind: EventKind;
  date: Date;
  title: string;
  detail: string;
  badge?: string;
  badgeColor?: string;
}

// ─── Helpers visuales ─────────────────────────────────────────────────────────

const KIND_META: Record<EventKind, {
  icon: React.FC<{ className?: string }>;
  color: string;
  bg: string;
  border: string;
}> = {
  "ranking-up":       { icon: TrendingUp,    color: "text-ds-green",  bg: "bg-ds-green/10",  border: "border-ds-green/30"  },
  "ranking-down":     { icon: TrendingDown,   color: "text-ds-red",    bg: "bg-ds-red/10",    border: "border-ds-red/30"    },
  "task-done":        { icon: CheckCircle2,   color: "text-ds-blue",   bg: "bg-ds-blue/10",   border: "border-ds-blue/30"   },
  "audit":            { icon: FileSearch,     color: "text-ds-orange", bg: "bg-ds-orange/10", border: "border-ds-orange/30" },
  "backlink-snapshot":{ icon: Link2,          color: "text-ds-blue",   bg: "bg-ds-blue/10",   border: "border-ds-blue/30"   },
  "insight":          { icon: Lightbulb,      color: "text-ds-yellow", bg: "bg-ds-yellow/10", border: "border-ds-yellow/30" },
  "report":           { icon: FileText,       color: "text-primary",   bg: "bg-primary/10",   border: "border-primary/30"   },
  "analysis":         { icon: Sparkles,       color: "text-primary",   bg: "bg-primary/10",   border: "border-primary/30"   },
};

function fmtDate(d: Date): string {
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

function fmtRelative(d: Date): string {
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays === 0) return "hoy";
  if (diffDays === 1) return "ayer";
  if (diffDays < 7) return `hace ${diffDays} días`;
  if (diffDays < 30) return `hace ${Math.floor(diffDays / 7)} sem.`;
  if (diffDays < 365) return `hace ${Math.floor(diffDays / 30)} meses`;
  return `hace ${Math.floor(diffDays / 365)} año(s)`;
}

// ─── Componente de evento ─────────────────────────────────────────────────────

function EventCard({ event }: { event: TimelineEvent }) {
  const meta = KIND_META[event.kind];
  const Icon = meta.icon;

  return (
    <div className="flex gap-4 group">
      {/* Línea + icono */}
      <div className="flex flex-col items-center">
        <div className={`h-8 w-8 rounded-full border ${meta.border} ${meta.bg} flex items-center justify-center shrink-0`}>
          <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
        </div>
        <div className="w-px flex-1 bg-border mt-1 group-last:hidden" />
      </div>

      {/* Contenido */}
      <div className="pb-6 min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3 mb-1">
          <p className="text-sm font-medium text-foreground leading-snug">{event.title}</p>
          <span className="font-mono text-[0.7rem] text-muted-foreground shrink-0 mt-0.5">
            {fmtRelative(event.date)}
          </span>
        </div>
        <p className="font-mono text-[0.75rem] text-muted-foreground leading-relaxed">{event.detail}</p>
        {event.badge && (
          <span className={`inline-block mt-1.5 font-mono text-[0.65rem] uppercase tracking-wide px-1.5 py-0.5 rounded border ${event.badgeColor ?? "text-muted-foreground bg-muted border-border"}`}>
            {event.badge}
          </span>
        )}
        <p className="font-mono text-[0.65rem] text-muted-foreground/60 mt-1">{fmtDate(event.date)}</p>
      </div>
    </div>
  );
}

// ─── Agrupación por mes ───────────────────────────────────────────────────────

function groupByMonth(events: TimelineEvent[]): Map<string, TimelineEvent[]> {
  const groups = new Map<string, TimelineEvent[]>();
  for (const event of events) {
    const key = event.date.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  return groups;
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default async function TimelinePage({
  params,
}: {
  params: { id: string };
}) {
  const [, client] = await Promise.all([
    getSession(),
    prisma.client.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, domain: true },
    }),
  ]);

  if (!client) notFound();

  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000); // últimos 90 días

  // ── Fetch paralelo de todas las fuentes ────────────────────────────────────

  const [
    rankingMovements,
    tasks,
    audits,
    backlinkSnapshots,
    insights,
    reports,
    analyses,
  ] = await Promise.all([

    // Rankings con movimiento significativo (|delta| >= 3)
    prisma.keywordRanking.findMany({
      where: {
        keyword: { clientId: client.id },
        date: { gte: since },
        delta: { not: null },
      },
      include: { keyword: { select: { term: true } } },
      orderBy: { date: "desc" },
      take: 50,
    }),

    // Tareas completadas del ciclo actual y recientes
    prisma.task.findMany({
      where: {
        cycle: { clientId: client.id },
        status: "DONE",
        completedAt: { gte: since },
      },
      select: { id: true, title: true, completedAt: true, priority: true },
      orderBy: { completedAt: "desc" },
      take: 30,
    }),

    // Audits recientes
    prisma.audit.findMany({
      where: { clientId: client.id, date: { gte: since } },
      select: { id: true, date: true, scoreOverall: true, pagesCrawled: true, status: true },
      orderBy: { date: "desc" },
      take: 10,
    }),

    // Snapshots de backlinks
    prisma.backlinkSnapshot.findMany({
      where: { clientId: client.id, capturedAt: { gte: since } },
      select: {
        id: true, capturedAt: true, totalBacklinks: true,
        gainedThisWeek: true, lostThisWeek: true, uniqueDomains: true,
      },
      orderBy: { capturedAt: "desc" },
      take: 12,
    }),

    // Insights recientes
    prisma.insight.findMany({
      where: { clientId: client.id, generatedAt: { gte: since } },
      select: { id: true, title: true, description: true, severity: true, type: true, generatedAt: true },
      orderBy: { generatedAt: "desc" },
      take: 20,
    }),

    // Reportes mensuales
    prisma.monthlyReport.findMany({
      where: { clientId: client.id, createdAt: { gte: since } },
      select: { id: true, yearMonth: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),

    // Análisis on-demand
    prisma.clientAnalysis.findMany({
      where: { clientId: client.id, createdAt: { gte: since } },
      select: { id: true, createdAt: true, triggeredBy: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  // ── Construir timeline unificada ───────────────────────────────────────────

  const events: TimelineEvent[] = [];

  // Rankings significativos
  for (const r of rankingMovements) {
    const delta = r.delta ?? 0;
    if (Math.abs(delta) < 3) continue;
    const up = delta < 0; // delta negativo = bajó posiciones numéricamente = subió en ranking
    events.push({
      id: r.id,
      kind: up ? "ranking-up" : "ranking-down",
      date: r.date,
      title: up
        ? `"${r.keyword.term}" subió ${Math.abs(delta)} posiciones`
        : `"${r.keyword.term}" bajó ${Math.abs(delta)} posiciones`,
      detail: `Movimiento de ${Math.abs(delta)} posiciones en Google`,
      badge: up ? `+${Math.abs(delta)}` : `-${Math.abs(delta)}`,
      badgeColor: up
        ? "text-ds-green bg-ds-green/10 border-ds-green/30"
        : "text-ds-red bg-ds-red/10 border-ds-red/30",
    });
  }

  // Tareas completadas
  for (const t of tasks) {
    if (!t.completedAt) continue;
    events.push({
      id: t.id,
      kind: "task-done",
      date: t.completedAt,
      title: `Tarea completada: ${t.title}`,
      detail: `Prioridad: ${t.priority}`,
      badge: "completada",
      badgeColor: "text-ds-blue bg-ds-blue/10 border-ds-blue/30",
    });
  }

  // Audits
  for (const a of audits) {
    const scoreStr = a.scoreOverall > 0 ? `Score: ${a.scoreOverall}/100` : "";
    const issueStr = a.pagesCrawled > 0 ? `${a.pagesCrawled} páginas crawleadas` : "";
    events.push({
      id: a.id,
      kind: "audit",
      date: a.date,
      title: "Site Audit ejecutado",
      detail: [scoreStr, issueStr].filter(Boolean).join(" · ") || "Análisis técnico completado",
      badge: a.status,
      badgeColor: "text-ds-orange bg-ds-orange/10 border-ds-orange/30",
    });
  }

  // Backlink snapshots con cambios
  for (const b of backlinkSnapshots) {
    const net = b.gainedThisWeek - b.lostThisWeek;
    events.push({
      id: b.id,
      kind: "backlink-snapshot",
      date: b.capturedAt,
      title: net >= 0
        ? `Backlinks: +${b.gainedThisWeek} ganados esta semana`
        : `Backlinks: -${b.lostThisWeek} perdidos esta semana`,
      detail: `Total: ${b.totalBacklinks} backlinks · ${b.uniqueDomains} dominios únicos`,
      badge: net >= 0 ? `+${net} neto` : `${net} neto`,
      badgeColor: net >= 0
        ? "text-ds-green bg-ds-green/10 border-ds-green/30"
        : "text-ds-red bg-ds-red/10 border-ds-red/30",
    });
  }

  // Insights
  for (const ins of insights) {
    const severityColor: Record<string, string> = {
      HIGH:   "text-ds-red bg-ds-red/10 border-ds-red/30",
      MEDIUM: "text-ds-yellow bg-ds-yellow/10 border-ds-yellow/30",
      LOW:    "text-muted-foreground bg-muted border-border",
    };
    events.push({
      id: ins.id,
      kind: "insight",
      date: ins.generatedAt,
      title: ins.title,
      detail: ins.description.slice(0, 120),
      badge: ins.severity,
      badgeColor: severityColor[ins.severity] ?? "text-muted-foreground bg-muted border-border",
    });
  }

  // Reportes mensuales
  for (const r of reports) {
    events.push({
      id: r.id,
      kind: "report",
      date: r.createdAt,
      title: `Reporte mensual ${r.yearMonth} generado`,
      detail: "Análisis ejecutivo del período con Claude Sonnet 4.6",
    });
  }

  // Análisis on-demand
  for (const a of analyses) {
    events.push({
      id: a.id,
      kind: "analysis",
      date: a.createdAt,
      title: "Análisis Claude generado",
      detail: a.triggeredBy ? `Por ${a.triggeredBy}` : "Análisis ejecutivo on-demand",
    });
  }

  // Ordenar por fecha descendente
  events.sort((a, b) => b.date.getTime() - a.date.getTime());

  const grouped = groupByMonth(events);

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
            <Clock className="h-6 w-6 text-ds-orange shrink-0" />
            Eventos
          </h1>
          <p className="font-mono text-[0.75rem] text-muted-foreground mt-1">
            {client.domain} · últimos 90 días · {events.length} eventos
          </p>
        </div>

        {/* Leyenda */}
        <div className="flex flex-wrap gap-3">
          {(Object.entries(KIND_META) as [EventKind, typeof KIND_META[EventKind]][]).map(([kind, meta]) => {
            const Icon = meta.icon;
            const labels: Record<EventKind, string> = {
              "ranking-up": "Subida ranking",
              "ranking-down": "Caída ranking",
              "task-done": "Tarea completada",
              "audit": "Site Audit",
              "backlink-snapshot": "Backlinks",
              "insight": "Insight",
              "report": "Reporte",
              "analysis": "Análisis Claude",
            };
            return (
              <div key={kind} className="flex items-center gap-1.5">
                <Icon className={`h-3 w-3 ${meta.color}`} />
                <span className="font-mono text-[0.7rem] text-muted-foreground">{labels[kind]}</span>
              </div>
            );
          })}
        </div>

        {/* Zero state */}
        {events.length === 0 && (
          <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center gap-4 text-center">
            <Clock className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="text-base font-medium text-foreground mb-1">Sin eventos en los últimos 90 días</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                Los eventos aparecerán aquí a medida que el sistema genere datos: rankings, audits, insights, reportes.
              </p>
            </div>
          </div>
        )}

        {/* Timeline agrupada por mes */}
        {events.length > 0 && (
          <div className="space-y-8">
            {Array.from(grouped.entries()).map(([month, monthEvents]) => (
              <section key={month}>
                <SectionHeader>{month}</SectionHeader>
                <div className="mt-4">
                  {monthEvents.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Footer */}
        <p className="font-mono text-[0.7rem] text-muted-foreground text-right">
          Fuentes: Rankings · Tareas · Site Audit · Backlinks · Insights · Reportes · Análisis
        </p>

      </div>
    </div>
  );
}
