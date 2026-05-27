export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { Plus, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { buttonVariants } from "@/components/ui/button";
import { CycleStatus, ClientStatus, UserRole } from "@prisma/client";
import { ServiceToggle } from "./ServiceToggle";

const SERVICE_LABEL: Record<string, { label: string; color: string }> = {
  seo:        { label: "SEO",       color: "bg-primary/10 border-ds-gd text-ds-green" },
  google_ads: { label: "Ads",       color: "bg-ds-blue/10 border-ds-blue/40 text-ds-blue" },
  meta_ads:   { label: "Meta",      color: "bg-destructive/10 border-destructive/30 text-destructive" },
  contenidos: { label: "Contenido", color: "bg-ds-yellow/10 border-ds-yellow/40 text-ds-yellow" },
};

async function getClients(_role: UserRole, _userEmail: string, filterSeo: boolean) {
  // Todos los usuarios autenticados (ADMIN y EDITOR) ven todos los clientes activos.
  // ClientUser granular está dormido — se activará en Fase 2 si se necesita restricción por cuenta.
  const baseWhere = { status: ClientStatus.ACTIVE };

  const where = filterSeo
    ? { ...baseWhere, services: { has: "seo" } }
    : baseWhere;

  return prisma.client.findMany({
    where,
    orderBy: { name: "asc" },
    include: {
      cycles: {
        where: {
          status: { in: [CycleStatus.ACTIVE, CycleStatus.PLANNING, CycleStatus.CLOSING] },
        },
        orderBy: { yearMonth: "desc" },
        take: 1,
        include: {
          tasks: {
            where: { status: { not: "DONE" } },
            select: { id: true },
          },
        },
      },
      insights: {
        where: { severity: "critical", dismissed: false },
        select: { id: true },
      },
    },
  });
}

// La página necesita searchParams para el toggle SEO/Todos
export default async function ClientesPage({
  searchParams,
}: {
  searchParams: { filter?: string };
}) {

function CycleStatusBadge({ status }: { status: CycleStatus }) {
  const config = {
    ACTIVE: { label: "Activo", class: "bg-primary/10 border-ds-gd text-ds-green" },
    PLANNING: { label: "Planificando", class: "bg-ds-blue/10 border-ds-blue/40 text-ds-blue" },
    CLOSING: { label: "Cerrando", class: "bg-ds-orange/10 border-ds-orange/40 text-ds-orange" },
    CLOSED: { label: "Cerrado", class: "bg-muted border-border text-muted-foreground" },
  }[status];

  return (
    <span className={`inline-flex items-center text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border ${config.class}`}>
      {config.label}
    </span>
  );
}

  const session = await getSession();
  const role = session?.user?.role ?? UserRole.EDITOR;
  const userEmail = session?.user?.email ?? "";
  const filterSeo = searchParams.filter !== "all"; // default SEO
  const clients = await getClients(role, userEmail, filterSeo);
  const isAdmin = role === UserRole.ADMIN;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-heading font-bold text-2xl text-foreground tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground mt-0.5 font-mono">
            {clients.length} {clients.length === 1 ? "cliente" : "clientes"}
            {filterSeo ? " con SEO" : " activos"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Suspense><ServiceToggle /></Suspense>
          {isAdmin && (
            <Link
              href="/clientes/nuevo"
              className={buttonVariants({ variant: "default" }) + " gap-2"}
            >
              <Plus className="h-4 w-4" />
              Nuevo cliente
            </Link>
          )}
        </div>
      </div>

      {/* Grid de clientes */}
      {clients.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Plus className="h-6 w-6 text-primary" />
          </div>
          <p className="text-foreground font-medium">Sin clientes aún</p>
          <p className="text-sm text-muted-foreground mt-1">
            Agrega tu primer cliente para empezar a trackear su SEO.
          </p>
          {isAdmin && (
            <Link
              href="/clientes/nuevo"
              className={buttonVariants({ variant: "default" }) + " mt-4"}
            >
              Agregar cliente
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map((client) => {
            const cycle = client.cycles[0];
            const pendingTasks = cycle?.tasks.length ?? 0;
            const criticalAlerts = client.insights.length;

            return (
              <Link
                key={client.id}
                href={`/clientes/${client.id}`}
                className="group block rounded-xl border border-border bg-card p-5 hover:border-primary/40 transition-all duration-150"
              >
                {/* Top row */}
                <div className="flex items-start justify-between mb-3">
                  <div
                    className="h-9 w-9 rounded-lg flex items-center justify-center text-primary-foreground text-sm font-bold shrink-0"
                    style={{
                      background: client.brandColor ?? "var(--primary)",
                    }}
                  >
                    {client.name.slice(0, 2).toUpperCase()}
                  </div>
                  {cycle && <CycleStatusBadge status={cycle.status} />}
                </div>

                {/* Name & domain */}
                <h2 className="font-semibold text-foreground text-[15px] leading-tight group-hover:text-primary transition-colors">
                  {client.name}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5 font-mono">{client.domain}</p>

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
