"use server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getClientsFromNotion } from "@/lib/notion-direct";
import { ClientStatus } from "@prisma/client";

const ESTADO_MAP: Record<string, ClientStatus> = {
  "Activo": ClientStatus.ACTIVE,
  "En Pausa": ClientStatus.PAUSED,
};

export async function actionSyncNotion(): Promise<{
  ok: true;
  created: number;
  updated: number;
  total: number;
} | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores." };
  }

  try {
    const notionClients = await getClientsFromNotion();

    if (notionClients.length === 0) {
      return { ok: false, error: "Notion devolvió 0 clientes — posible error de API." };
    }

    let created = 0;
    let updated = 0;

    for (const nc of notionClients) {
      const status = ESTADO_MAP[nc.estado as string] ?? ClientStatus.PAUSED;

      const existing = await prisma.client.findUnique({
        where: { cerebroClientId: nc.notionPageId },
      });

      if (existing) {
        await prisma.client.update({
          where: { id: existing.id },
          data: {
            name: nc.name,
            domain: nc.domain ?? existing.domain,
            status,
            services: nc.services,
          },
        });
        updated++;
      } else {
        await prisma.client.create({
          data: {
            cerebroClientId: nc.notionPageId,
            name: nc.name,
            domain: nc.domain ?? "",
            plan: "BASIC",
            status,
            services: nc.services,
          },
        });
        created++;
      }
    }

    return { ok: true, created, updated, total: notionClients.length };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
