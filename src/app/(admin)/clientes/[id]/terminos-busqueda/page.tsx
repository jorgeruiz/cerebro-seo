export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Search } from "lucide-react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getOAuth2Client } from "@/lib/google-oauth";
import { buttonVariants } from "@/components/ui/button";
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
            <Search className="h-6 w-6 text-ds-blue shrink-0" />
            Términos de búsqueda
          </h1>
          <p className="font-mono text-[0.75rem] text-muted-foreground mt-1">
            {client.domain} · Google Search Console
          </p>
        </div>

        {!site?.gscProperty ? (
          <div className="bg-card rounded-xl border border-border p-6">
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
