export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifyEmbedToken } from "@/lib/embed-token";
import { ReportContent } from "@/components/report/ReportContent";
import type { MonthlyReportResult } from "@/lib/monthly-report";

/**
 * /reportes/{id}/embed?token=<firmado>
 *
 * Página embebible (iframe) del reporte mensual. Sin sesión requerida.
 * Acceso controlado por token firmado de vida corta (1h), atado al report id.
 * CSP frame-ancestors restringido a constructor.clicksociety.com.mx.
 */
export default async function EmbedReportPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { token?: string };
}) {
  const { id } = params;
  const token = searchParams.token;

  if (!token) {
    notFound();
  }

  // Verificar token
  const result = verifyEmbedToken(token, id);
  if (!result.valid) {
    notFound();
  }

  // Cargar reporte
  const report = await prisma.monthlyReport.findUnique({
    where: { id },
    select: {
      content: true,
      yearMonth: true,
      client: {
        select: { name: true, domain: true },
      },
    },
  });

  if (!report) {
    notFound();
  }

  let parsedContent: MonthlyReportResult;
  try {
    parsedContent = JSON.parse(report.content) as MonthlyReportResult;
  } catch {
    notFound();
  }

  // CSP frame-ancestors is set by middleware for /reportes/*/embed paths.

  return (
    <div className="min-h-screen bg-background p-6 md:p-10 space-y-8">
      {/* Header del reporte */}
      <div>
        <p className="font-mono text-[0.65rem] text-muted-foreground uppercase tracking-[0.15em] mb-1">
          Click Society · Cerebro SEO
        </p>
        <h1 className="font-display font-extrabold text-[clamp(1.4rem,2vw,2rem)] tracking-tight leading-[1.05] text-foreground">
          {report.client.name}
        </h1>
        <p className="font-mono text-[0.75rem] text-muted-foreground mt-1">
          {report.client.domain} · Reporte mensual · {parsedContent.periodo}
        </p>
      </div>

      {/* Contenido del reporte — mismo render que la vista admin */}
      <ReportContent report={parsedContent} />

      {/* Footer */}
      <div className="border-t border-border pt-4 mt-8">
        <p className="font-mono text-[0.65rem] text-muted-foreground">
          Generado por Cerebro SEO · Click Society · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
