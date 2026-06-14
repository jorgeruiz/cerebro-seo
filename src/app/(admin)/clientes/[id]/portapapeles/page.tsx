export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PortapapelesPanel } from "./PortapapelesPanel";

export const metadata = {
  title: "Portapapeles — Cerebro SEO",
};

export default async function PortapapelesPage({
  params,
}: {
  params: { id: string };
}) {
  const client = await prisma.client.findUnique({
    where: { id: params.id },
    select: { id: true, name: true },
  });
  if (!client) notFound();

  return <PortapapelesPanel clientId={client.id} clientName={client.name} />;
}
