export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FlaskConical } from "lucide-react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { buttonVariants } from "@/components/ui/button";
import { SectionIntro } from "@/components/ui-darkui";
import { ResearchTabs } from "./ResearchTabs";
import type { ResearchData } from "@/server/research/types";

async function getPageData(clientId: string) {
  const [client, history] = await Promise.all([
    prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, domain: true },
    }),
    prisma.researchReport.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        domain: true,
        data: true,
        apiCost: true,
        claudeCost: true,
        triggeredBy: true,
        createdAt: true,
      },
    }),
  ]);

  if (!client) return null;
  return { client, history };
}

export default async function ResearchPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session?.user) return notFound();

  const data = await getPageData(params.id);
  if (!data) return notFound();

  const { client, history } = data;

  const latestReport = history[0]
    ? {
        id: history[0].id,
        data: history[0].data as unknown as ResearchData,
        apiCost: Number(history[0].apiCost),
        claudeCost: Number(history[0].claudeCost),
        createdAt: history[0].createdAt,
      }
    : null;

  const isAdmin = (session.user as { role?: string }).role === "ADMIN";

  return (
    <div className="min-h-full">
      <div className="p-4 sm:p-6 lg:p-8 space-y-8">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link
              href={`/clientes/${client.id}`}
              className={
                buttonVariants({ variant: "outline-mono", size: "sm" }) +
                " gap-1.5"
              }
            >
              <ArrowLeft className="h-3 w-3" />
              {client.name}
            </Link>
          </div>
          <h1 className="font-display font-extrabold text-[clamp(1.6rem,2.5vw,2.4rem)] tracking-tight leading-[1.05] text-foreground flex items-center gap-3">
            <FlaskConical className="h-6 w-6 text-ds-yellow shrink-0" />
            Research
          </h1>
          <p className="font-mono text-[0.75rem] text-muted-foreground mt-1">
            {client.domain} · oportunidades, keyword ideas y AEO/GEO research
          </p>
        </div>

        <SectionIntro>
          Análisis competitivo completo: keywords en striking distance,
          competidores orgánicos, páginas ganadoras y sugerencias accionables.
        </SectionIntro>

        <ResearchTabs
          clientId={client.id}
          domain={client.domain}
          latestReport={latestReport}
          historyCount={history.length}
          isAdmin={isAdmin}
        />
      </div>
    </div>
  );
}
