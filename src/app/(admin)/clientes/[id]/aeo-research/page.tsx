export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Brain, MessageSquare } from "lucide-react";
import { prisma } from "@/lib/db";
import { buttonVariants } from "@/components/ui/button";
import { AeoResearchPanel } from "./AeoResearchPanel";
import { getAeoResearchHistory } from "./actions";

async function getPageData(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      domain: true,
      keywords: {
        where: { isPriority: true, deletedAt: null },
        select: { term: true },
        take: 5,
      },
    },
  });
  if (!client) return null;

  const history = await getAeoResearchHistory(clientId);
  const seeds = client.keywords.map((k) => k.term);

  return { client, history, seeds };
}

export default async function AeoResearchPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await getPageData(params.id);
  if (!data) notFound();

  const { client, history, seeds } = data;
  const initialRecord = history[0] ?? null;

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
            <Brain className="h-6 w-6 text-ds-yellow shrink-0" />
            AEO Research
          </h1>
          <p className="font-mono text-[0.65rem] text-muted-foreground mt-1">
            {client.domain} · clusters de preguntas clasificados para featured snippets (AEO) y motores de IA (GEO)
          </p>
        </div>

        {/* Empty state — sin keywords de prioridad */}
        {seeds.length === 0 ? (
          <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center gap-4 text-center">
            <MessageSquare className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="text-base font-medium text-foreground mb-1">Sin keywords de prioridad</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                Marca al menos una keyword como prioridad en la sección de{" "}
                <Link
                  href={`/clientes/${client.id}/keywords`}
                  className="text-primary underline underline-offset-2"
                >
                  Keywords objetivo
                </Link>{" "}
                para poder generar el análisis AEO/GEO.
              </p>
            </div>
          </div>
        ) : (
          <AeoResearchPanel
            clientId={client.id}
            initialRecord={initialRecord}
            history={history}
            seeds={seeds}
          />
        )}
      </div>
    </div>
  );
}
