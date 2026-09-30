export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ArrowLeft, ListChecks } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SectionIntro } from "@/components/ui-darkui";
import { PlanMensualPanel } from "./PlanMensualPanel";
import { getPlanExecutions, getAvailableMonths } from "./actions";

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

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [availableMonths, executions] = await Promise.all([
    getAvailableMonths(client.id),
    getPlanExecutions(client.id, currentMonth),
  ]);

  // If no executions this month but there are others, default to most recent
  const effectiveMonth = executions.length > 0
    ? currentMonth
    : availableMonths[0] ?? currentMonth;

  const effectiveExecutions = executions.length > 0
    ? executions
    : effectiveMonth !== currentMonth
      ? await getPlanExecutions(client.id, effectiveMonth)
      : [];

  // Ensure current month is in the list
  const allMonths = availableMonths.includes(currentMonth)
    ? availableMonths
    : [currentMonth, ...availableMonths];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href={`/clientes/${client.id}`}
          className={buttonVariants({ variant: "ghost", size: "sm" }) + " gap-1.5 -ml-3 mb-2"}
        >
          <ArrowLeft className="h-3 w-3" />
          {client.name}
        </Link>
        <h1 className="text-xl font-display font-bold text-foreground flex items-center gap-3">
          <ListChecks className="h-5 w-5 text-primary" />
          Plan Mensual
        </h1>
        <p className="font-mono text-[0.75rem] text-muted-foreground mt-1">
          {client.domain} · ejecución de tareas SEO con Constructor
        </p>
      </div>

      <SectionIntro>
        Las tareas marcadas con <strong>IA</strong> se ejecutan automáticamente en Constructor.
        Las marcadas con <strong>HT</strong> (Human Task) requieren trabajo manual —
        Cerebro SEO genera los pasos detallados. Al completar todas las tareas se alcanza el 100%.
      </SectionIntro>

      <PlanMensualPanel
        clientId={client.id}
        initialExecutions={effectiveExecutions}
        availableMonths={allMonths}
        currentMonth={effectiveMonth}
      />
    </div>
  );
}
