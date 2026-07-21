export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ArrowLeft, Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { AnalysisPanel } from "./AnalysisPanel";
import { getAnalysisHistory } from "./actions";
import type { AnalysisResult } from "@/lib/claude-analysis";

async function getPageData(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, domain: true, services: true },
  });
  if (!client) return null;

  const history = await getAnalysisHistory(clientId);
  return { client, history };
}

export default async function AnalisisPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await getPageData(params.id);
  if (!data) notFound();

  const { client, history } = data;
  const latest = history[0] ?? null;

  // Deserializar el análisis más reciente para pasarlo como prop inicial
  const initialRecord = latest
    ? {
        ...latest,
        analysis: JSON.parse(
          await prisma.clientAnalysis
            .findUniqueOrThrow({ where: { id: latest.id } })
            .then((r) => r.content)
        ) as AnalysisResult,
      }
    : null;

  return (
    <div className="min-h-full">
      <div className="p-4 sm:p-6 lg:p-8 space-y-8">

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
            <Sparkles className="h-6 w-6 text-primary shrink-0" />
            Análisis Claude
          </h1>
          <p className="font-mono text-[0.75rem] text-muted-foreground mt-1">
            {client.domain} · análisis ejecutivo on-demand con todo el contexto SEO del cliente
          </p>
        </div>

        {/* Panel principal */}
        <AnalysisPanel
          clientId={client.id}
          initialRecord={initialRecord}
          history={history}
        />
      </div>
    </div>
  );
}
