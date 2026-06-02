"use server";

import { getSession } from "@/lib/auth";
import { Queue } from "bullmq";
import { redisBullMQ } from "@/lib/redis";
import { UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";

export async function actionTriggerAiSearch(clientId: string) {
  const session = await getSession();
  if (session?.user?.role !== UserRole.ADMIN) {
    throw new Error("Solo ADMIN puede disparar análisis manual de AI Search");
  }

  const queue = new Queue("data-collection", { connection: redisBullMQ });
  await queue.add(
    "analysis:ai-search",
    { clientId },
    { jobId: `manual-ai-search-${clientId}-${Date.now()}` }
  );
  await queue.close();

  revalidatePath(`/clientes/${clientId}/ai-search`);
  return { ok: true };
}
