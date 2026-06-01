"use server";

import { getSession } from "@/lib/auth";
import { Queue } from "bullmq";
import { redisBullMQ } from "@/lib/redis";
import { UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";

export async function actionTriggerCompetitorAnalysis(clientId: string) {
  const session = await getSession();
  if (session?.user?.role !== UserRole.ADMIN) {
    throw new Error("Solo ADMIN puede disparar análisis manual de competidores");
  }

  const queue = new Queue("data-collection", { connection: redisBullMQ });
  await queue.add(
    "analysis:competitors",
    { clientId },
    { jobId: `manual-competitors-${clientId}-${Date.now()}` }
  );
  await queue.close();

  revalidatePath(`/clientes/${clientId}/competencia`);
  return { ok: true };
}
