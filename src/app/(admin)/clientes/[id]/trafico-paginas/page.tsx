export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Activity, BarChart2 } from "lucide-react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getOAuth2Client } from "@/lib/google-oauth";
import { buttonVariants } from "@/components/ui/button";
import { GscConnectSection } from "../GscConnectSection";
import { PagesTrafficTable } from "./PagesTrafficTable";
import { getPagesTraffic } from "../actions";

export default async function TraficoPaginasPage({
  params,
}: {
  params: { id: string };
}) {
  const [client, session] = await Promise.all([
    prisma.client.findUnique({
      where: { id: params.id },
      include: { sites: { take: 1 } },
    }),
    getSession(),
  ]);

  if (!client) notFound();

  const site = client.sites[0];
  const hasGsc = !!site?.gscProperty;
  const hasGa4 = !!site?.ga4Property;

  // Sin ninguna propiedad: mostrar estado vacío
  if (!hasGsc && !hasGa4) {
    return (
      <div className="min-h-full">
        <div className="p-8 space-y-8">
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
              <BarChart2 className="h-6 w-6 text-ds-green shrink-0" />
              Tráfico de páginas
            </h1>
            <p className="font-mono text-[0.65rem] text-muted-foreground mt-1">
              {client.domain} · GA4 + GSC
            </p>
          </div>
          <div className="bg-card rounded-xl border border-border p-6">
            {!hasGsc ? (
              <GscConnectSection clientId={client.id} />
            ) : (
              <div className="h-32 flex flex-col items-center justify-center gap-2 text-center">
                <Activity className="h-6 w-6 text-muted-foreground/30" />
                <p className="text-sm font-medium text-muted-foreground">Google Analytics no configurado</p>
                <p className="text-xs text-muted-foreground/60 max-w-xs">
                  Agrega el ID de propiedad GA4 en los ajustes del cliente.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Pre-cargar datos default para SSR rápido
  let initialData = null;
  if (session?.user?.id) {
    const oauth = await getOAuth2Client(session.user.id);
    if (oauth) {
      const result = await getPagesTraffic({
        clientId: client.id,
        range: "28d",
        sortBy: hasGa4 ? "sessions" : "clicks",
        sortDir: "desc",
      });
      if (!("error" in result)) initialData = result;
    }
  }

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
            <BarChart2 className="h-6 w-6 text-ds-green shrink-0" />
            Tráfico de páginas
          </h1>
          <p className="font-mono text-[0.65rem] text-muted-foreground mt-1">
            {client.domain} ·{" "}
            {hasGa4 && hasGsc ? "GA4 + GSC" : hasGa4 ? "GA4" : "GSC"}
          </p>
        </div>

        <PagesTrafficTable
          clientId={client.id}
          initialData={initialData}
          hasGsc={hasGsc}
          hasGa4={hasGa4}
        />
      </div>
    </div>
  );
}
