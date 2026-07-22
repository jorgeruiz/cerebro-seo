export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { buttonVariants } from "@/components/ui/button";
import { ClientStatus, UserRole } from "@prisma/client";
import { ServiceToggle } from "./ServiceToggle";
import { ClientGrid } from "./ClientGrid";


async function getClients(_role: UserRole, _userEmail: string, filterSeo: boolean) {
  const baseWhere = { status: ClientStatus.ACTIVE };
  const where = filterSeo ? { ...baseWhere, services: { has: "seo" } } : baseWhere;

  return prisma.client.findMany({
    where,
    orderBy: { name: "asc" },
    include: {
      cycles: {
        where: { status: { in: ["ACTIVE", "PLANNING", "CLOSING"] as const } },
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

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: { filter?: string };
}) {
  const session = await getSession();
  const role = session?.user?.role ?? UserRole.EDITOR;
  const userEmail = session?.user?.email ?? "";
  const filterSeo = searchParams.filter !== "all"; // default SEO
  const clients = await getClients(role, userEmail, filterSeo);
  const isAdmin = role === UserRole.ADMIN;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex flex-col gap-3 mb-8">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display font-extrabold text-[clamp(1.5rem,3vw,2.8rem)] tracking-tight leading-[1.05] text-foreground">Clientes</h1>
            <p className="text-sm text-muted-foreground mt-0.5 font-mono">
              {clients.length} {clients.length === 1 ? "cliente" : "clientes"}
              {filterSeo ? " con SEO" : " activos"}
            </p>
          </div>
          {isAdmin && (
            <Link
              href="/clientes/nuevo"
              className={buttonVariants({ variant: "default", size: "icon" }) + " shrink-0 sm:hidden h-9 w-9"}
              title="Nuevo cliente"
            >
              <Plus className="h-4 w-4" />
            </Link>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Suspense><ServiceToggle /></Suspense>
          {isAdmin && (
            <Link
              href="/clientes/nuevo"
              className={buttonVariants({ variant: "default" }) + " gap-2 hidden sm:inline-flex"}
            >
              <Plus className="h-4 w-4" />
              Nuevo cliente
            </Link>
          )}
        </div>
      </div>

      {/* Grid de clientes con búsqueda */}
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
        <ClientGrid clients={clients} />
      )}
    </div>
  );
}
