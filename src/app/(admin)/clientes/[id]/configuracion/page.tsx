export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ArrowLeft, Settings, ExternalLink } from "lucide-react";
import { SectionHeader } from "@/components/ui-darkui";
import { KeywordsManager } from "./KeywordsManager";
import { CompetitorsManager } from "./CompetitorsManager";
import { actionUpdateGscProperty, actionUpdateGa4Property } from "./actions";

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

  // Form-compatible wrappers (form action must return void)
  async function updateGsc(formData: FormData) {
    "use server";
    await actionUpdateGscProperty(client!.id, formData);
  }
  async function updateGa4(formData: FormData) {
    "use server";
    await actionUpdateGa4Property(client!.id, formData);
  }

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
              <form action={updateGsc} className="space-y-2">
                <input
                  name="gscProperty"
                  defaultValue={site?.gscProperty ?? ""}
                  placeholder="sc-domain:tudominio.com"
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <p className="text-[10px] font-mono text-muted-foreground/60">
                  Formato: sc-domain:dominio.com o https://dominio.com/
                </p>
                <button
                  type="submit"
                  className="bg-primary text-primary-foreground text-xs font-mono rounded-lg px-3 py-1.5 hover:bg-primary/90 transition-colors"
                >
                  Guardar
                </button>
              </form>
            </div>

            {/* GA4 */}
            <div className="bg-card rounded-xl border border-border p-5 space-y-3">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Google Analytics 4</p>
              <form action={updateGa4} className="space-y-2">
                <input
                  name="ga4Property"
                  defaultValue={site?.ga4Property ?? ""}
                  placeholder="properties/123456789"
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <p className="text-[10px] font-mono text-muted-foreground/60">
                  Formato: properties/123456789
                </p>
                <button
                  type="submit"
                  className="bg-primary text-primary-foreground text-xs font-mono rounded-lg px-3 py-1.5 hover:bg-primary/90 transition-colors"
                >
                  Guardar
                </button>
              </form>
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
