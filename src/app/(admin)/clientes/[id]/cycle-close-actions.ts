"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { closeCycle, type CycleCloseResult } from "@/lib/cycle-close";

export type { CycleCloseResult };

export async function actionCloseCycle(
  clientId: string
): Promise<{ ok: true; result: CycleCloseResult } | { ok: false; error: string }> {
  const session = await getSession();
  if (session?.user?.role !== "ADMIN") {
    return { ok: false, error: "Solo administradores pueden cerrar un ciclo." };
  }

  try {
    const result = await closeCycle(clientId);
    revalidatePath(`/clientes/${clientId}`);
    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido al cerrar el ciclo.";
    return { ok: false, error: message };
  }
}
