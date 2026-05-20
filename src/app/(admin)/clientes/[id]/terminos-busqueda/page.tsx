export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getOAuth2Client } from "@/lib/google-oauth";
import { GscConnectSection } from "../GscConnectSection";
import { GscQueriesTable } from "./GscQueriesTable";
import { getGscQueries } from "../actions";

export default async function TerminosBusquedaPage({
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

  // Pre-cargar datos default para SSR rápido
  let initialData = null;
  if (site?.gscProperty && session?.user?.id) {
    const oauth = await getOAuth2Client(session.user.id);
    if (oauth) {
      const result = await getGscQueries({
        clientId: client.id,
        range: "28d",
        device: "all",
        country: "all",
        sortBy: "clicks",
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
        <h1 className="text-xl font-bold text-gray-900">Términos de búsqueda</h1>
        <p className="text-sm text-gray-400 mt-0.5">{client.domain} · Google Search Console</p>
      </div>

      <div className="p-8">
        {!site?.gscProperty ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <GscConnectSection clientId={client.id} />
          </div>
        ) : (
          <GscQueriesTable
            clientId={client.id}
            initialData={initialData}
          />
        )}
      </div>
    </div>
  );
}
