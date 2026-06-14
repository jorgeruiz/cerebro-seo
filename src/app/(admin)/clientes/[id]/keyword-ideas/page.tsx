export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { dataForSeoProvider } from "@/server/providers/dataforseo";
import {
  ArrowLeft,
  Lightbulb,
  AlertCircle,
  TrendingUp,
  Search,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SectionHeader, KpiCard } from "@/components/ui-darkui";
import { AddKeywordButton } from "./AddKeywordButton";
import { KeywordClipboardButton } from "./KeywordClipboardButton";
import type { KeywordIdea } from "@/server/providers/dataforseo";

// ─── Helpers visuales ─────────────────────────────────────────────────────────

function kdBadge(kd: number | null) {
  if (kd == null) return "text-muted-foreground bg-muted border-border";
  if (kd <= 30) return "text-ds-green bg-ds-green/10 border-ds-green/30";
  if (kd <= 60) return "text-ds-yellow bg-ds-yellow/10 border-ds-yellow/30";
  return "text-ds-red bg-ds-red/10 border-ds-red/30";
}

function intentBadge(intent: string | null) {
  if (!intent) return "text-muted-foreground bg-muted border-border";
  const map: Record<string, string> = {
    informational: "text-ds-blue bg-ds-blue/10 border-ds-blue/30",
    commercial: "text-ds-yellow bg-ds-yellow/10 border-ds-yellow/30",
    transactional: "text-ds-green bg-ds-green/10 border-ds-green/30",
    navigational: "text-muted-foreground bg-muted border-border",
  };
  return map[intent] ?? "text-muted-foreground bg-muted border-border";
}

function fmtVol(n: number | null) {
  if (n == null) return "—";
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtCpc(n: number | null) {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default async function KeywordIdeasPage({
  params,
}: {
  params: { id: string };
}) {
  const [session, client] = await Promise.all([
    getSession(),
    prisma.client.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, domain: true, services: true },
    }),
  ]);

  if (!client) notFound();
  if (!client.services.includes("seo")) redirect(`/clientes/${client.id}`);

  const isAdmin = session?.user?.role === "ADMIN";

  // Obtener keywords prioritarias como seeds (máx 5)
  const seedKeywords = await prisma.keyword.findMany({
    where: { clientId: client.id, isPriority: true, deletedAt: null },
    select: { term: true },
    take: 5,
  });

  // Sin keywords prioritarias = no hay seeds
  if (seedKeywords.length === 0) {
    return (
      <div className="min-h-full">
        <div className="p-8 space-y-8">
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
              Keyword Ideas
            </h1>
          </div>
          <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="text-base font-medium text-foreground mb-1">Sin keywords prioritarias</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                Configura al menos una keyword prioritaria en el cliente para generar ideas relacionadas.
              </p>
            </div>
            <Link
              href={`/clientes/${client.id}/configuracion`}
              className={buttonVariants({ variant: "outline-mono", size: "sm" })}
            >
              Ir a configuración
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const seeds = seedKeywords.map((k) => k.term);

  // Llamar DataForSEO (con caché 7d)
  const ideas = await dataForSeoProvider
    .getKeywordIdeas(seeds, {}, client.id)
    .catch(() => [] as KeywordIdea[]);

  // Calcular KPIs rápidos
  const withVolume = ideas.filter((i) => (i.searchVolume ?? 0) > 0);
  const easyKws = ideas.filter((i) => i.keywordDifficulty != null && i.keywordDifficulty <= 30);
  const highVol = ideas.filter((i) => (i.searchVolume ?? 0) >= 1000);

  // Keywords existentes del cliente (para marcar cuáles ya están agregadas)
  const existingTerms = new Set(
    (
      await prisma.keyword.findMany({
        where: { clientId: client.id, deletedAt: null },
        select: { term: true },
      })
    ).map((k) => k.term.toLowerCase())
  );

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
            Keyword Ideas
          </h1>
          <p className="font-mono text-[0.65rem] text-muted-foreground mt-1">
            Seeds: {seeds.map((s) => `"${s}"`).join(", ")} · DataForSEO Labs · caché 7 días
          </p>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="Ideas encontradas" value={String(ideas.length)} />
          <KpiCard label="Con volumen" value={String(withVolume.length)} />
          <KpiCard
            label="KD fácil (≤30)"
            value={String(easyKws.length)}
            valueColor={easyKws.length > 0 ? "green" : "default"}
          />
          <KpiCard
            label="Alto volumen (≥1k)"
            value={String(highVol.length)}
            valueColor={highVol.length > 0 ? "default" : "default"}
          />
        </div>

        {/* Zero state */}
        {ideas.length === 0 && (
          <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center gap-4 text-center">
            <Search className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="text-base font-medium text-foreground mb-1">Sin ideas disponibles</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                DataForSEO no retornó sugerencias para las keywords seed. Intenta con seeds diferentes.
              </p>
            </div>
          </div>
        )}

        {/* Tabla de ideas */}
        {ideas.length > 0 && (
          <section>
            <SectionHeader>
              <span className="flex items-center gap-2">
                Sugerencias de keywords
                <span className="font-mono text-[0.6rem] bg-muted border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                  {ideas.length}
                </span>
              </span>
            </SectionHeader>

            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-4 py-2.5 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">Keyword</th>
                    <th className="text-right px-4 py-2.5 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">Vol/mes</th>
                    <th className="text-center px-4 py-2.5 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">KD</th>
                    <th className="text-right px-4 py-2.5 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground hidden lg:table-cell">CPC</th>
                    <th className="text-center px-4 py-2.5 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Intención</th>
                    <th className="text-center px-4 py-2.5 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">Copiar</th>
                    {isAdmin && (
                      <th className="text-center px-4 py-2.5 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">Agregar</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {ideas.slice(0, 200).map((idea, i) => {
                    const alreadyAdded = existingTerms.has(idea.keyword.toLowerCase());
                    return (
                      <tr
                        key={i}
                        className={`border-b border-border last:border-0 hover:bg-muted/20 transition-colors ${alreadyAdded ? "opacity-50" : ""}`}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            {idea.searchVolume != null && idea.searchVolume >= 1000 && (
                              <TrendingUp className="h-3 w-3 text-ds-green shrink-0" />
                            )}
                            <span className="font-mono text-[0.7rem] text-foreground">{idea.keyword}</span>
                            {alreadyAdded && (
                              <span className="font-mono text-[0.55rem] text-muted-foreground bg-muted rounded px-1">ya existe</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-[0.65rem] text-foreground">
                          {fmtVol(idea.searchVolume)}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {idea.keywordDifficulty != null ? (
                            <span className={`font-mono text-[0.55rem] px-1.5 py-0.5 rounded border ${kdBadge(idea.keywordDifficulty)}`}>
                              {idea.keywordDifficulty}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-[0.65rem] text-muted-foreground hidden lg:table-cell">
                          {fmtCpc(idea.cpc)}
                        </td>
                        <td className="px-4 py-2.5 text-center hidden lg:table-cell">
                          {idea.intent && (
                            <span className={`font-mono text-[0.55rem] px-1.5 py-0.5 rounded border ${intentBadge(idea.intent)}`}>
                              {idea.intent.slice(0, 4)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <KeywordClipboardButton
                            keyword={idea.keyword}
                            volume={idea.searchVolume}
                            kd={idea.keywordDifficulty}
                            intent={idea.intent}
                          />
                        </td>
                        {isAdmin && (
                          <td className="px-4 py-2.5 text-center">
                            {!alreadyAdded && (
                              <AddKeywordButton
                                clientId={client.id}
                                keyword={idea.keyword}
                              />
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {ideas.length > 200 && (
              <p className="font-mono text-[0.6rem] text-muted-foreground text-right mt-2">
                Mostrando 200 de {ideas.length} resultados · ajusta las keywords seed para refinar
              </p>
            )}
          </section>
        )}

        {/* Footer */}
        <p className="font-mono text-[0.6rem] text-muted-foreground text-right">
          Datos DataForSEO Labs · Standard Queue · caché 7 días · México / Español
        </p>

      </div>
    </div>
  );
}
