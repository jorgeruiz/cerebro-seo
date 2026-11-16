"use server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function actionSaveVerifiedServices(
  clientId: string,
  verified: string[],
  excluded: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") return { ok: false, error: "Solo administradores." };

  await prisma.client.update({
    where: { id: clientId },
    data: {
      verifiedServices: verified,
      excludedServices: excluded,
    },
  });

  return { ok: true };
}
