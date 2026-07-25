export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createEmbedToken } from "@/lib/embed-token";
import { validateNotionClientId } from "@/lib/notion-client-id";

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function yearMonthToTitle(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return `Reporte mensual - ${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * GET /api/internal/constructor/clients/{notionId}/reports
 * Authorization: Bearer ${SEO_INTERNAL_SECRET}
 *
 * Lista los reportes mensuales de un cliente identificado por su notion_client_id
 * (route param [notionId], mapeado internamente a cerebroClientId).
 * Cada reporte incluye un embed_url con token firmado de vida corta (1h).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { notionId: string } }
) {
  // 1. Guard Bearer
  const authHeader = req.headers.get("authorization");
  const secret = process.env.SEO_INTERNAL_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validar notion_client_id (route param [notionId])
  const idValidation = validateNotionClientId(params.notionId);
  if (!idValidation.valid) {
    return NextResponse.json({ error: idValidation.message }, { status: 400 });
  }
  const notionClientId = idValidation.normalized;

  // 3. Lookup cerebroClientId → Client
  const client = await prisma.client.findUnique({
    where: { cerebroClientId: notionClientId },
    select: { id: true, name: true, cerebroClientId: true },
  });

  if (!client || !client.cerebroClientId) {
    return NextResponse.json({
      client: { notion_client_id: notionClientId, notionId: notionClientId, nombre: null },
      reports: [],
    });
  }

  // 3. Listar reportes ordenados por yearMonth desc
  const reports = await prisma.monthlyReport.findMany({
    where: { clientId: client.id },
    orderBy: { yearMonth: "desc" },
    select: {
      id: true,
      yearMonth: true,
      createdAt: true,
    },
  });

  // 4. Construir respuesta con embed_url firmado
  const baseUrl = process.env.NEXTAUTH_URL ?? "https://seo.clicksociety.mx";

  const reportsPayload = reports.map((r) => {
    const token = createEmbedToken(r.id);
    return {
      id: r.id,
      titulo: yearMonthToTitle(r.yearMonth),
      periodo: r.yearMonth,
      created_at: r.createdAt.toISOString(),
      embed_url: `${baseUrl}/reportes/${r.id}/embed?token=${encodeURIComponent(token)}`,
    };
  });

  return NextResponse.json({
    client: {
      notion_client_id: client.cerebroClientId,
      notionId: client.cerebroClientId, // alias legacy
      nombre: client.name,
    },
    reports: reportsPayload,
  });
}
