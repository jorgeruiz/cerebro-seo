export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ArrowLeft, Lightbulb } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SectionIntro } from "@/components/ui-darkui";
import { ContentPlanPanel } from "./ContentPlanPanel";
import { getContentPlanHistory } from "./actions";
import type { ContentPlanResult } from "@/lib/claude-content-plan";

async function getPageData(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, domain: true, services: true },
  });
  if (!client) return null;

  const history = await getContentPlanHistory(clientId);
  return { client, history };
}

export default async function ContenidoPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await getPageData(params.id);
  if (!data) notFound();

  const { client, history } = data;
  const latest = history[0] ?? null;

  // Deserializar el plan más reciente
  const initialRecord = latest
    ? {
        ...latest,
        plan: await prisma.contentPlan
          .findUniqueOrThrow({ where: { id: latest.id } })
          .then((r) => r.ideas as unknown as ContentPlanResult),
      }
    : null;

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
            <Lightbulb className="h-6 w-6 text-ds-yellow shrink-0" />
            Plan de Contenido
          </h1>
          <p className="font-mono text-[0.75rem] text-muted-foreground mt-1">
            {client.domain} · ideas de contenido SEO generadas con Claude, basadas en gaps, oportunidades GSC y estrategia del ciclo
          </p>
        </div>

        <SectionIntro>
          Claude analiza el estado SEO del cliente (gaps, oportunidades GSC, keywords near-top) y genera un plan editorial mensual priorizado.
          Cada idea incluye keyword objetivo, intención de búsqueda, formato sugerido y justificación basada en datos reales.
        </SectionIntro>

        {/* Panel principal */}
        <ContentPlanPanel
          clientId={client.id}
          initialRecord={initialRecord}
          history={history}
        />
      </div>
    </div>
  );
}
