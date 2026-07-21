export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ArrowLeft, CheckCheck, EyeOff, AlertCircle, TrendingUp, Trophy, Info, ExternalLink } from "lucide-react";
import { resolveInsight, ignoreInsight } from "../../actions";
import { buttonVariants } from "@/components/ui/button";
import { format } from "date-fns";
import { es } from "date-fns/locale";

type InsightType = "OPPORTUNITY" | "WARNING" | "WIN" | "INFO";

const TYPE_CONFIG: Record<InsightType, { label: string; icon: typeof AlertCircle; color: string }> = {
  WARNING:     { label: "Alerta",      icon: AlertCircle, color: "text-destructive" },
  OPPORTUNITY: { label: "Oportunidad", icon: TrendingUp,  color: "text-ds-green" },
  WIN:         { label: "Logro",       icon: Trophy,      color: "text-ds-yellow" },
  INFO:        { label: "Información", icon: Info,        color: "text-ds-blue" },
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-destructive/10 border-destructive/30 text-destructive",
  high:     "bg-destructive/10 border-destructive/20 text-destructive/80",
  medium:   "bg-ds-yellow/10 border-ds-yellow/40 text-ds-yellow",
  low:      "bg-ds-blue/10 border-ds-blue/40 text-ds-blue",
};

export default async function InsightDetailPage({
  params,
}: {
  params: { id: string; insightId: string };
}) {
  const session = await getSession();
  if (!session?.user?.id) return notFound();

  const insight = await prisma.insight.findUnique({
    where: { id: params.insightId },
    include: { client: { select: { id: true, name: true } } },
  });

  if (!insight || insight.clientId !== params.id) return notFound();

  const config = TYPE_CONFIG[insight.type as InsightType] ?? TYPE_CONFIG.INFO;
  const Icon = config.icon;
  const severityClass = SEVERITY_BADGE[insight.severity.toLowerCase()] ?? SEVERITY_BADGE.low;
  const isResolved = insight.acknowledgedAt !== null;
  const isIgnored = insight.dismissed;

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-border bg-background px-8 py-5">
        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/clientes/${params.id}`}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {insight.client.name}
          </Link>
          <span className="text-border">/</span>
          <Link
            href={`/clientes/${params.id}/insights`}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Insights
          </Link>
          <span className="text-border">/</span>
          <span className="text-foreground/60 font-mono text-xs truncate max-w-[200px]">{insight.title}</span>
        </div>
      </div>

      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl">
        {/* Estado banner */}
        {(isResolved || isIgnored) && (
          <div className={`mb-6 rounded-lg px-4 py-3 text-sm font-medium border ${
            isResolved
              ? "bg-primary/10 border-ds-gd text-ds-green"
              : "bg-muted border-border text-muted-foreground"
          }`}>
            {isResolved
              ? `✓ Resuelto el ${format(insight.acknowledgedAt!, "d 'de' MMMM 'de' yyyy", { locale: es })}`
              : "Ignorado — no aparece en el panel del cliente"}
          </div>
        )}

        {/* Tarjeta principal */}
        <div className="bg-card rounded-xl border border-border p-6 space-y-5">
          {/* Tipo + severidad + fecha */}
          <div className="flex items-center gap-2 flex-wrap">
            <Icon className={`h-4.5 w-4.5 ${config.color}`} />
            <span className="text-sm font-semibold text-foreground">{config.label}</span>
            <span className={`text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border ${severityClass}`}>
              {insight.severity}
            </span>
            <span className="ml-auto text-xs font-mono text-muted-foreground">
              {format(insight.generatedAt, "d MMM yyyy, HH:mm", { locale: es })}
            </span>
          </div>

          {/* Título */}
          <h1 className="font-display font-bold text-xl text-foreground leading-snug">{insight.title}</h1>

          {/* Descripción */}
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted-foreground mb-2">Análisis</p>
            <p className="text-sm text-foreground/80 leading-relaxed">{insight.description}</p>
          </div>

          {/* Acción sugerida */}
          {insight.suggestedAction && (
            <div className="bg-primary/5 rounded-lg p-4 border border-primary/20">
              <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-primary/70 mb-1.5">Acción sugerida</p>
              <p className="text-sm text-foreground font-medium">{insight.suggestedAction}</p>
            </div>
          )}

          {/* Keywords afectadas */}
          {insight.affectedKeywords.length > 0 && (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted-foreground mb-2">Keywords relacionadas</p>
              <div className="flex flex-wrap gap-1.5">
                {insight.affectedKeywords.map((kw) => (
                  <span key={kw} className="text-xs bg-muted border border-border text-muted-foreground px-2 py-0.5 rounded-full font-mono">
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* URLs afectadas */}
          {insight.affectedUrls.length > 0 && (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted-foreground mb-2">URLs relacionadas</p>
              <ul className="space-y-1">
                {insight.affectedUrls.map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-primary hover:underline font-mono truncate"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      {url.replace(/^https?:\/\//, "")}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* DataPoints (evidencia numérica) */}
          {insight.dataPoints && (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted-foreground mb-2">Evidencia</p>
              <pre className="text-xs bg-muted rounded-lg p-4 overflow-x-auto border border-border text-muted-foreground leading-relaxed font-mono">
                {JSON.stringify(insight.dataPoints, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Acciones */}
        {!isResolved && !isIgnored && (
          <div className="mt-6 flex items-center gap-3">
            <form action={resolveInsight.bind(null, insight.id)}>
              <button
                type="submit"
                className={buttonVariants({ variant: "default" }) + " gap-2"}
              >
                <CheckCheck className="h-4 w-4" />
                Marcar como resuelto
              </button>
            </form>
            <form action={ignoreInsight.bind(null, insight.id)}>
              <button
                type="submit"
                className={buttonVariants({ variant: "outline-mono" }) + " gap-2"}
              >
                <EyeOff className="h-4 w-4" />
                Ignorar
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
