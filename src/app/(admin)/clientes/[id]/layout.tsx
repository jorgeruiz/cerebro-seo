import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
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
    <div className="flex h-full">
      <ClientSidebar
        clientId={client.id}
        clientName={client.name}
        hasSeo={hasSeo}
      />
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
        {children}
      </div>
    </div>
  );
}
