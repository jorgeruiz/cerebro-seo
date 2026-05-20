export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Activity } from "lucide-react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getOAuth2Client } from "@/lib/google-oauth";
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
        <div className="border-b border-gray-100 bg-white px-8 py-5">
          <div className="flex items-center gap-3 mb-1">
            <Link
              href={`/clientes/${client.id}`}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {client.name}
            </Link>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Tráfico de páginas</h1>
          <p className="text-sm text-gray-400 mt-0.5">{client.domain} · GA4 + GSC</p>
        </div>
        <div className="p-8">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            {!hasGsc ? (
              <GscConnectSection clientId={client.id} />
            ) : (
              <div className="h-32 flex flex-col items-center justify-center gap-2 text-center">
                <Activity className="h-6 w-6 text-gray-300" />
                <p className="text-sm font-medium text-gray-500">Google Analytics no configurado</p>
                <p className="text-xs text-gray-400 max-w-xs">
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
      {/* Header */}
      <div className="border-b border-gray-100 bg-white px-8 py-5">
        <div className="flex items-center gap-3 mb-1">
          <Link
            href={`/clientes/${client.id}`}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {client.name}
          </Link>
        </div>
        <h1 className="text-xl font-bold text-gray-900">Tráfico de páginas</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {client.domain} ·{" "}
          {hasGa4 && hasGsc ? "GA4 + GSC" : hasGa4 ? "GA4" : "GSC"}
        </p>
      </div>

      <div className="p-8">
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
