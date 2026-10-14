export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ArrowLeft, Settings, ExternalLink } from "lucide-react";
import { SectionHeader } from "@/components/ui-darkui";
import { KeywordsManager } from "./KeywordsManager";
import { CompetitorsManager } from "./CompetitorsManager";
import { GscConnectSection } from "../GscConnectSection";
import { Ga4ConnectSection } from "../Ga4ConnectSection";

export default async function ConfiguracionPage({ params }: { params: { id: string } }) {
  const client = await prisma.client.findUnique({
    where: { id: params.id },
    include: {
      sites: { take: 1 },
      keywords: {
        where: { deletedAt: null },
        orderBy: [{ isPriority: "desc" }, { createdAt: "desc" }],
      },
      competitors: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
      },
      cycles: {
        orderBy: { yearMonth: "desc" },
        take: 1,
      },
    },
  });

  if (!client) notFound();

  const site = client.sites[0];

  return (
    <div className="min-h-full">
      <div className="p-4 sm:p-6 lg:p-8 space-y-10">

        {/* Page header */}
        <div className="flex items-start gap-3">
          <Link href={`/clientes/${client.id}`} className="text-muted-foreground hover:text-foreground transition-colors mt-1">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <Settings className="h-4 w-4 text-muted-foreground" />
              <h1 className="font-display font-extrabold text-[clamp(1.4rem,2.5vw,2rem)] tracking-tight leading-[1.05] text-foreground">
                Configuración
              </h1>
            </div>
            <p className="font-mono text-[0.75rem] text-muted-foreground">
              {client.name} · {client.domain}
            </p>
          </div>
        </div>

        {/* Datos generales */}
        <section>
          <SectionHeader>Datos generales</SectionHeader>
          <div className="bg-card rounded-xl border border-border p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { label: "Cliente", value: client.name },
              { label: "Dominio", value: client.domain },
              { label: "Plan", value: client.plan },
              { label: "Estado", value: client.status },
              { label: "Servicios", value: client.services.join(", ") || "—" },
              {
                label: "Ciclo activo",
                value: client.cycles[0]?.yearMonth ?? "Sin ciclo",
              },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-0.5">{label}</p>
                <p className="text-sm text-foreground font-mono">{value}</p>
              </div>
            ))}
            {client.cerebroClientId && (
              <div>
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-0.5">Cerebro</p>
                <a
                  href={`https://cerebro.clicksociety.com.mx/dashboard/${client.cerebroClientId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-primary font-mono hover:underline"
                >
                  Ver en Cerebro <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>
        </section>

        {/* Propiedades GSC / GA4 */}
        <section>
          <SectionHeader>Search Console {"&"} Analytics</SectionHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* GSC */}
            <div className="bg-card rounded-xl border border-border p-5 space-y-3">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Google Search Console</p>
              {site?.gscProperty ? (
                <div className="space-y-2">
                  <p className="text-sm font-mono text-foreground">{site.gscProperty}</p>
                  <p className="text-[10px] font-mono text-ds-green">Conectado</p>
                </div>
              ) : (
                <GscConnectSection clientId={client.id} />
              )}
            </div>

            {/* GA4 */}
            <div className="bg-card rounded-xl border border-border p-5 space-y-3">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Google Analytics 4</p>
              {site?.ga4Property ? (
                <div className="space-y-2">
                  <p className="text-sm font-mono text-foreground">{site.ga4Property}</p>
                  <p className="text-[10px] font-mono text-ds-green">Conectado</p>
                </div>
              ) : (
                <Ga4ConnectSection clientId={client.id} />
              )}
            </div>
          </div>
        </section>

        {/* Keywords */}
        <section>
          <SectionHeader>Keywords objetivo</SectionHeader>
          <KeywordsManager
            clientId={client.id}
            keywords={client.keywords.map((k) => ({
              id: k.id,
              term: k.term,
              country: k.country,
              language: k.language,
              isPriority: k.isPriority,
              createdAt: k.createdAt,
            }))}
          />
        </section>

        {/* Competidores */}
        <section>
          <SectionHeader>Competidores</SectionHeader>
          <CompetitorsManager
            clientId={client.id}
            competitors={client.competitors.map((c) => ({
              id: c.id,
              domain: c.domain,
              createdAt: c.createdAt,
            }))}
          />
        </section>

      </div>
    </div>
  );
}
