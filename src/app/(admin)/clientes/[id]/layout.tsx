/**
 * Layout del detalle de cliente — monta ClipboardProvider + ClientSidebar.
 *
 * - El provider se keyed por clientId: si el usuario navega entre clientes,
 *   React desmonta el provider anterior y monta uno nuevo → items se resetean.
 * - El layout persiste al navegar ENTRE módulos del mismo cliente (keyword-ideas,
 *   aeo-research, contenido, etc.) → los items del portapapeles se mantienen.
 * - ClientSidebar reemplaza el grid de módulos: nav contextual siempre visible.
 */

import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ClipboardProvider } from "./ClipboardContext";
import { ClientSidebar } from "@/components/layout/ClientSidebar";

async function getClientMeta(id: string) {
  return prisma.client.findUnique({
    where: { id },
    select: { id: true, name: true, services: true },
  });
}

export default async function ClientDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { id: string };
}) {
  const client = await getClientMeta(params.id);
  if (!client) notFound();

  const hasSeo = client.services.includes("seo");

  return (
    // key={params.id} fuerza remount del provider al cambiar de cliente
    <ClipboardProvider key={params.id} clientId={params.id}>
      <div className="flex h-full">
        <ClientSidebar
          clientId={client.id}
          clientName={client.name}
          hasSeo={hasSeo}
        />
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </ClipboardProvider>
  );
}
