/**
 * GET /clientes/[id]/reporte/pdf?mes=YYYY-MM
 * Genera y descarga el PDF del Reporte Mensual.
 * Solo accesible para usuarios autenticados.
 */

import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ReportPdf } from "../ReportPdf";
import type { MonthlyReportResult } from "@/lib/monthly-report";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const mes = searchParams.get("mes");

  // Buscar el reporte (más reciente del mes o el más reciente global)
  const report = await prisma.monthlyReport.findFirst({
    where: {
      clientId: params.id,
      ...(mes ? { yearMonth: mes } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      yearMonth: true,
      content: true,
      client: {
        select: { name: true, domain: true },
      },
    },
  });

  if (!report) {
    return new NextResponse("Reporte no encontrado", { status: 404 });
  }

  let parsedContent: MonthlyReportResult;
  try {
    parsedContent = JSON.parse(report.content) as MonthlyReportResult;
  } catch {
    return new NextResponse("Error al parsear el reporte", { status: 500 });
  }

  const element = React.createElement(ReportPdf, {
    report: parsedContent,
    clientName: report.client.name,
    domain: report.client.domain ?? "",
  });

  const buffer = await renderToBuffer(element as React.ReactElement<DocumentProps>);
  const uint8 = new Uint8Array(buffer);

  const filename = `reporte-seo-${report.client.name.toLowerCase().replace(/\s+/g, "-")}-${report.yearMonth}.pdf`;

  return new NextResponse(uint8, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(uint8.byteLength),
    },
  });
}
