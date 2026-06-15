"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock, Search, X } from "lucide-react";
import type { CycleStatus } from "@prisma/client";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ClientRow {
  id: string;
  name: string;
  domain: string | null;
  services: string[];
  cycles: Array<{
    status: CycleStatus;
    tasks: Array<{ id: string }>;
  }>;
  insights: Array<{ id: string }>;
}

const SERVICE_LABEL: Record<string, { label: string; color: string }> = {
  seo:        { label: "SEO",       color: "bg-primary/10 border-ds-gd text-ds-green" },
  google_ads: { label: "Ads",       color: "bg-ds-blue/10 border-ds-blue/40 text-ds-blue" },
  meta_ads:   { label: "Meta",      color: "bg-destructive/10 border-destructive/30 text-destructive" },
  contenidos: { label: "Contenido", color: "bg-ds-yellow/10 border-ds-yellow/40 text-ds-yellow" },
};

const CYCLE_STATUS_BADGE: Record<CycleStatus, { label: string; cls: string }> = {
  ACTIVE:   { label: "Activo",      cls: "bg-primary/10 border-ds-gd text-ds-green" },
  PLANNING: { label: "Planificando",cls: "bg-ds-blue/10 border-ds-blue/40 text-ds-blue" },
  CLOSING:  { label: "Cerrando",    cls: "bg-ds-orange/10 border-ds-orange/40 text-ds-orange" },
  CLOSED:   { label: "Cerrado",     cls: "bg-muted border-border text-muted-foreground" },
};

// ─── Componente ───────────────────────────────────────────────────────────────

export function ClientGrid({ clients }: { clients: ClientRow[] }) {
  const [query, setQuery] = useState("");

  // Filtrar + ordenar client-side
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    const matched = q
      ? clients.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.domain ?? "").toLowerCase().includes(q)
        )
      : clients;

    // Ordenar: alertas críticas primero → tareas pendientes → nombre
    return [...matched].sort((a, b) => {
      const alertDiff = b.insights.length - a.insights.length;
      if (alertDiff !== 0) return alertDiff;
      const taskA = a.cycles[0]?.tasks.length ?? 0;
      const taskB = b.cycles[0]?.tasks.length ?? 0;
      if (taskB !== taskA) return taskB - taskA;
      return a.name.localeCompare(b.name, "es");
    });
  }, [clients, query]);

  return (
    <div className="space-y-4">

      {/* Buscador */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre o dominio…"
          className="w-full pl-9 pr-9 py-2 rounded-lg border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 font-mono transition-colors"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Contador */}
      {query && (
        <p className="font-mono text-[0.7rem] text-muted-foreground">
          {filtered.length} de {clients.length} clientes
        </p>
      )}

      {/* Zero state — búsqueda sin resultados */}
      {filtered.length === 0 && query && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            Sin resultados para {`"${query}"`}
          </p>
          <button
            onClick={() => setQuery("")}
            className="mt-2 text-xs text-primary hover:underline font-mono"
          >
            Limpiar búsqueda
          </button>
        </div>
      )}

      {/* Grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((client) => {
            const cycle = client.cycles[0];
            const pendingTasks = cycle?.tasks.length ?? 0;
            const criticalAlerts = client.insights.length;
            const cycleBadge = cycle ? CYCLE_STATUS_BADGE[cycle.status] : null;

            return (
              <Link
                key={client.id}
                href={`/clientes/${client.id}`}
                className="group block rounded-xl border border-border bg-card p-5 hover:border-primary/40 transition-all duration-150"
              >
                {/* Top row: name + cycle badge */}
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h2 className="font-display font-semibold text-foreground text-[15px] leading-tight group-hover:text-primary transition-colors flex-1 min-w-0">
                    {client.name}
                  </h2>
                  {cycleBadge && (
                    <span className={`shrink-0 inline-flex items-center text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border ${cycleBadge.cls}`}>
                      {cycleBadge.label}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mb-3 font-mono">{client.domain}</p>

                {/* Badges de servicios */}
                {client.services.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {client.services.map((slug) => {
                      const cfg = SERVICE_LABEL[slug] ?? { label: slug, color: "bg-muted text-muted-foreground border-border" };
                      return (
                        <span key={slug} className={`inline-flex items-center text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded border ${cfg.color}`}>
                          {cfg.label}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Indicators */}
                <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border">
                  {criticalAlerts > 0 ? (
                    <span className="flex items-center gap-1.5 text-xs text-destructive">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {criticalAlerts} alerta{criticalAlerts > 1 ? "s" : ""}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-ds-green">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Sin alertas
                    </span>
                  )}

                  {pendingTasks > 0 && (
                    <span className="flex items-center gap-1.5 text-xs text-ds-yellow">
                      <Clock className="h-3.5 w-3.5" />
                      {pendingTasks} tarea{pendingTasks > 1 ? "s" : ""} pendiente{pendingTasks > 1 ? "s" : ""}
                    </span>
                  )}

                  {!cycle && (
                    <span className="text-xs text-muted-foreground font-mono">Sin ciclo activo</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
