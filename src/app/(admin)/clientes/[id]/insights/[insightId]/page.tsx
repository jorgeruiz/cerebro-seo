export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ArrowLeft, CheckCheck, EyeOff, AlertCircle, TrendingUp, Trophy, Info } from "lucide-react";
import { resolveInsight, ignoreInsight } from "../../actions";
import { format } from "date-fns";
import { es } from "date-fns/locale";

type InsightType = "OPPORTUNITY" | "WARNING" | "WIN" | "INFO";

const TYPE_CONFIG: Record<InsightType, { label: string; icon: typeof AlertCircle; color: string }> = {
  WARNING:     { label: "Alerta",       icon: AlertCircle, color: "text-red-500" },
  OPPORTUNITY: { label: "Oportunidad",  icon: TrendingUp,  color: "text-green-500" },
  WIN:         { label: "Logro",        icon: Trophy,      color: "text-yellow-500" },
  INFO:        { label: "Información",  icon: Info,        color: "text-blue-500" },
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border border-red-200",
  high:     "bg-red-50 text-red-600 border border-red-100",
  medium:   "bg-amber-50 text-amber-700 border border-amber-200",
  low:      "bg-blue-50 text-blue-600 border border-blue-100",
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
      <div className="border-b border-gray-100 bg-white px-8 py-5">
        <div className="flex items-center gap-3">
          <Link
            href={`/clientes/${params.id}`}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {insight.client.name}
          </Link>
          <span className="text-gray-200">/</span>
          <span className="text-sm text-gray-600">Insight</span>
        </div>
      </div>

      <div className="p-8 max-w-3xl">
        {/* Estado */}
        {(isResolved || isIgnored) && (
          <div className={`mb-6 rounded-lg px-4 py-3 text-sm font-medium ${isResolved ? "bg-green-50 text-green-700 border border-green-100" : "bg-gray-50 text-gray-500 border border-gray-100"}`}>
            {isResolved
              ? `✓ Marcado como resuelto el ${format(insight.acknowledgedAt!, "d 'de' MMMM 'de' yyyy", { locale: es })}`
              : "Ignorado — no aparece en el panel del cliente"}
          </div>
        )}

        {/* Tarjeta principal */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-5">
          {/* Tipo + severidad */}
          <div className="flex items-center gap-2 flex-wrap">
            <Icon className={`h-5 w-5 ${config.color}`} />
            <span className="text-sm font-semibold text-gray-700">{config.label}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${severityClass}`}>
              {insight.severity.toUpperCase()}
            </span>
            <span className="ml-auto text-xs text-gray-400">
              {format(insight.generatedAt, "d MMM yyyy, HH:mm", { locale: es })}
            </span>
          </div>

          {/* Título */}
          <h1 className="text-lg font-bold text-gray-900 leading-snug">{insight.title}</h1>

          {/* Descripción completa */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Análisis</p>
            <p className="text-sm text-gray-700 leading-relaxed">{insight.description}</p>
          </div>

          {/* Acción sugerida */}
          {insight.suggestedAction && (
            <div className="bg-indigo-50 rounded-lg p-4 border border-indigo-100">
              <p className="text-xs font-semibold text-indigo-500 uppercase tracking-wide mb-1">Acción sugerida</p>
              <p className="text-sm text-indigo-900 font-medium">{insight.suggestedAction}</p>
            </div>
          )}

          {/* Keywords afectadas */}
          {insight.affectedKeywords.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Keywords relacionadas</p>
              <div className="flex flex-wrap gap-1.5">
                {insight.affectedKeywords.map((kw) => (
                  <span key={kw} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{kw}</span>
                ))}
              </div>
            </div>
          )}

          {/* URLs afectadas */}
          {insight.affectedUrls.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">URLs relacionadas</p>
              <ul className="space-y-1">
                {insight.affectedUrls.map((url) => (
                  <li key={url} className="text-xs text-indigo-600 truncate font-mono">{url}</li>
                ))}
              </ul>
            </div>
          )}

          {/* DataPoints (evidencia numérica) */}
          {insight.dataPoints && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Evidencia</p>
              <pre className="text-xs bg-gray-50 rounded-lg p-4 overflow-x-auto border border-gray-100 text-gray-600 leading-relaxed">
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
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors"
              >
                <CheckCheck className="h-4 w-4" />
                Marcar como resuelto
              </button>
            </form>
            <form action={ignoreInsight.bind(null, insight.id)}>
              <button
                type="submit"
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                <EyeOff className="h-4 w-4" />
                Ignorar
              </button>
            </form>
            <Link
              href={`/clientes/${params.id}`}
              className="ml-auto text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Volver al cliente
            </Link>
          </div>
        )}
        {(isResolved || isIgnored) && (
          <div className="mt-6">
            <Link
              href={`/clientes/${params.id}`}
              className="text-sm text-indigo-600 hover:text-indigo-700 transition-colors"
            >
              ← Volver al cliente
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
