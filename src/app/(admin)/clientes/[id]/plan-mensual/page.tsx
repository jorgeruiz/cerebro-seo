export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PlanMensualPanel } from "./PlanMensualPanel";
import { getPlanData } from "./actions";

export default async function PlanMensualPage({
  params,
}: {
  params: { id: string };
}) {
  const client = await prisma.client.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, domain: true, services: true },
  });
  if (!client) notFound();

  const { plan, months } = await getPlanData(client.id);

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
            <ClipboardList className="h-6 w-6 text-primary shrink-0" />
            Plan Mensual
          </h1>
          <p className="font-mono text-[0.75rem] text-muted-foreground mt-1">
            {client.domain} · tareas SEO del mes con ejecucion AI y seguimiento de progreso
          </p>
        </div>

        {/* Panel */}
        <PlanMensualPanel
          clientId={client.id}
          initialPlan={plan}
          initialMonths={months}
        />
      </div>
    </div>
  );
}
