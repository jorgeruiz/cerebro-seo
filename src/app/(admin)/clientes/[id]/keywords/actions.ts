"use server";

import { Queue } from "bullmq";
import { redisBullMQ } from "@/lib/redis";
import { getSession } from "@/lib/auth";
import { UserRole } from "@prisma/client";

export async function actionTriggerRankTracking(
  clientId: string,
  mode: "priority" | "bulk",
): Promise<{ ok?: true; error?: string }> {
  const session = await getSession();
  if (session?.user?.role !== UserRole.ADMIN) {
    return { error: "Solo ADMIN puede disparar tracking manual" };
  }

  const queue = new Queue("data-collection", { connection: redisBullMQ });
  await queue.add(
    `tracking:rankings-${mode}`,
    { clientId, mode },
    { jobId: `manual-${mode}-${clientId}-${Date.now()}` },
  );
  await queue.close();

  return { ok: true };
}
