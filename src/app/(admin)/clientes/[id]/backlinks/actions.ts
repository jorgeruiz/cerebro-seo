"use server";

import { getSession } from "@/lib/auth";
import { Queue } from "bullmq";
import { redisBullMQ } from "@/lib/redis";
import { UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";

export async function actionTriggerBacklinksCrawl(clientId: string) {
  const session = await getSession();
  if (session?.user?.role !== UserRole.ADMIN) {
    throw new Error("Solo ADMIN puede disparar crawl manual");
  }

  const queue = new Queue("data-collection", { connection: redisBullMQ });
  await queue.add(
    "analysis:backlinks",
    { clientId },
    { jobId: `manual-backlinks-${clientId}-${Date.now()}` }
  );
  await queue.close();

  revalidatePath(`/clientes/${clientId}/backlinks`);
  return { ok: true };
}
