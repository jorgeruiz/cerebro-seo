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
  seo:        { label: "SEO",       color: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  google_ads: { label: "Ads",       color: "bg-blue-50 text-blue-700 border-blue-200" },
  meta_ads:   { label: "Meta",      color: "bg-pink-50 text-pink-700 border-pink-200" },
  contenidos: { label: "Contenido", color: "bg-green-50 text-green-700 border-green-200" },
};

async function getClients(role: UserRole, userEmail: string, filterSeo: boolean) {
  // ADMIN ve todos los clientes activos (filtrados por SEO si el toggle está en SEO).
  // EDITOR solo ve los que tiene asignados vía ClientUser (por email).
  const baseWhere = role === UserRole.ADMIN
    ? { status: ClientStatus.ACTIVE }
    : { status: ClientStatus.ACTIVE, clientUsers: { some: { email: userEmail } } };

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
    ACTIVE: { label: "Activo", class: "bg-green-50 text-green-700 border-green-200" },
    PLANNING: { label: "Planificando", class: "bg-blue-50 text-blue-700 border-blue-200" },
    CLOSING: { label: "Cerrando", class: "bg-orange-50 text-orange-700 border-orange-200" },
    CLOSED: { label: "Cerrado", class: "bg-gray-50 text-gray-600 border-gray-200" },
  }[status];

  return (
    <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border ${config.class}`}>
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
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Clientes</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {clients.length} {clients.length === 1 ? "cliente" : "clientes"}
            {filterSeo ? " con SEO" : " activos"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Suspense><ServiceToggle /></Suspense>
          {isAdmin && (
            <Link
              href="/clientes/nuevo"
              className={buttonVariants({ variant: "default" }) + " bg-[#6366f1] hover:bg-[#4f52d4] text-white gap-2"}
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
          <div className="h-12 w-12 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
            <Plus className="h-6 w-6 text-indigo-400" />
          </div>
          <p className="text-gray-900 font-medium">Sin clientes aún</p>
          <p className="text-sm text-gray-500 mt-1">
            Agrega tu primer cliente para empezar a trackear su SEO.
          </p>
          {isAdmin && (
            <Link
              href="/clientes/nuevo"
              className={buttonVariants({ variant: "default" }) + " mt-4 bg-[#6366f1] hover:bg-[#4f52d4] text-white"}
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
                className="group block rounded-xl border border-gray-100 bg-white p-5 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all duration-150"
              >
                {/* Top row */}
                <div className="flex items-start justify-between mb-3">
                  <div
                    className="h-9 w-9 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0"
                    style={{
                      background: client.brandColor ?? "linear-gradient(135deg, #6366f1, #3b82f6)",
                    }}
                  >
                    {client.name.slice(0, 2).toUpperCase()}
                  </div>
                  {cycle && <CycleStatusBadge status={cycle.status} />}
                </div>

                {/* Name & domain */}
                <h2 className="font-semibold text-gray-900 text-[15px] leading-tight group-hover:text-indigo-700 transition-colors">
                  {client.name}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">{client.domain}</p>

                {/* Badges de servicios */}
                {client.services.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {client.services.map((slug) => {
                      const cfg = SERVICE_LABEL[slug] ?? { label: slug, color: "bg-gray-50 text-gray-500 border-gray-200" };
                      return (
                        <span key={slug} className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${cfg.color}`}>
                          {cfg.label}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Indicators */}
                <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-50">
                  {criticalAlerts > 0 ? (
                    <span className="flex items-center gap-1.5 text-xs text-red-600">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {criticalAlerts} alerta{criticalAlerts > 1 ? "s" : ""}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-green-600">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Sin alertas
                    </span>
                  )}

                  {pendingTasks > 0 && (
                    <span className="flex items-center gap-1.5 text-xs text-amber-600">
                      <Clock className="h-3.5 w-3.5" />
                      {pendingTasks} tarea{pendingTasks > 1 ? "s" : ""} pendiente{pendingTasks > 1 ? "s" : ""}
                    </span>
                  )}

                  {!cycle && (
                    <span className="text-xs text-gray-400">Sin ciclo activo</span>
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
