"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { XCircle, Loader2, CheckCircle2 } from "lucide-react";
import { actionCloseCycle } from "./cycle-close-actions";

interface Props {
  clientId: string;
  yearMonth: string;
}

export function CycleCloseButton({ clientId, yearMonth }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  function handleClose() {
    startTransition(async () => {
      const res = await actionCloseCycle(clientId);
      if (res.ok) {
        const { tasksBlocked, hypothesesValidated, hypothesesPartial } = res.result;
        setToast({
          ok: true,
          msg: `Ciclo ${yearMonth} cerrado · ${tasksBlocked} tareas bloqueadas · ${hypothesesValidated} hipótesis validadas · ${hypothesesPartial} parciales`,
        });
        setConfirm(false);
        router.refresh();
      } else {
        setToast({ ok: false, msg: res.error });
        setConfirm(false);
      }
    });
  }

  if (toast) {
    return (
      <div
        className={`flex items-center gap-2 text-[0.65rem] font-mono px-3 py-1.5 rounded border ${
          toast.ok
            ? "bg-ds-green/10 border-ds-green/30 text-ds-green"
            : "bg-destructive/10 border-destructive/30 text-destructive"
        }`}
      >
        {toast.ok ? (
          <CheckCircle2 className="h-3 w-3 shrink-0" />
        ) : (
          <XCircle className="h-3 w-3 shrink-0" />
        )}
        {toast.msg}
      </div>
    );
  }

  if (confirm) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[0.65rem] font-mono text-muted-foreground">
          ¿Cerrar ciclo {yearMonth}? No se puede deshacer.
        </span>
        <button
          onClick={handleClose}
          disabled={isPending}
          className="inline-flex items-center gap-1 text-[0.65rem] font-mono uppercase tracking-wide px-2.5 py-1 rounded border bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <XCircle className="h-3 w-3" />
          )}
          Confirmar
        </button>
        <button
          onClick={() => setConfirm(false)}
          disabled={isPending}
          className="text-[0.65rem] font-mono text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      className="inline-flex items-center gap-1.5 text-[0.65rem] font-mono uppercase tracking-wide px-2.5 py-1 rounded border border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
    >
      <XCircle className="h-3 w-3" />
      Cerrar ciclo
    </button>
  );
}
