export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PortapapelesPanel } from "./PortapapelesPanel";
import { SectionIntro } from "@/components/ui-darkui";

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

  return (
    <div className="p-8 space-y-6">
      <SectionIntro>
        Colección de snippets y textos SEO del cliente: meta descriptions, títulos, fragmentos de contenido optimizados.
        Guarda aquí cualquier texto que quieras reutilizar o compartir con el equipo. Los snippets se pueden copiar con un clic.
      </SectionIntro>
      <PortapapelesPanel clientId={client.id} clientName={client.name} />
    </div>
  );
}
