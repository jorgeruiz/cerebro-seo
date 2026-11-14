"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle, Clock, XCircle } from "lucide-react";
const STATUS_CONFIG = {
  INSTALLED: { label: "Instalado", icon: CheckCircle2, color: "text-emerald-500" },
  PENDING: { label: "Pendiente", icon: Clock, color: "text-amber-500" },
  INSTALLING: { label: "Instalando...", icon: Loader2, color: "text-blue-500" },
  FAILED: { label: "Falló", icon: XCircle, color: "text-red-500" },
  ROLLBACK: { label: "Revertido", icon: AlertCircle, color: "text-zinc-500" },
  NOT_ACTIVE: { label: "No activo", icon: AlertCircle, color: "text-zinc-400" },
} as const;

export function PackageCard({
  packageDef,
  status,
  installedAt,
  verifiedAt,
  detectDetails,
  clientId,
  siteId,
}: {
  packageDef: { id: string; name: string; description: string; version: string; enables: string[] };
  status: string;
  installedAt: Date | null;
  verifiedAt: Date | null;
  detectDetails: string | null;
  clientId: string;
  siteId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.PENDING;
  const Icon = cfg.icon;
  const isActive = packageDef.version !== "0";

  const handleAddToPlan = () => {
    startTransition(async () => {
      try {
        const { actionAddPackageToPlan } = await import("./actions");
        const res = await actionAddPackageToPlan(clientId, siteId, packageDef.id);
        if (res.ok) {
          setResult(`Tarea creada en el plan. ID: ${res.taskId}`);
          setTimeout(() => window.location.reload(), 2000);
        } else {
          setResult(`Error: ${res.error}`);
        }
      } catch (err) {
        setResult(`Error: ${(err as Error).message}`);
      }
    });
  };

  return (
    <div className={cn(
      "border rounded-lg p-4 space-y-2",
      status === "INSTALLED" ? "border-emerald-500/30 bg-emerald-500/5" :
      status === "NOT_ACTIVE" ? "border-border/50 bg-muted/20 opacity-60" :
      "border-border",
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", cfg.color, status === "INSTALLING" && "animate-spin")} />
          <h3 className="font-mono text-sm font-semibold">{packageDef.name}</h3>
          <span className={cn("font-mono text-[0.6rem] px-1.5 py-0.5 rounded", cfg.color, "bg-current/10")}>
            {cfg.label}
          </span>
        </div>
        <span className="font-mono text-[0.55rem] text-muted-foreground">v{packageDef.version}</span>
      </div>

      <p className="font-mono text-[0.65rem] text-muted-foreground">{packageDef.description}</p>

      {packageDef.enables.length > 0 && (
        <p className="font-mono text-[0.6rem] text-muted-foreground">
          Habilita: {packageDef.enables.join(", ")}
        </p>
      )}

      {detectDetails && (
        <p className="font-mono text-[0.55rem] text-amber-500">{detectDetails}</p>
      )}

      {installedAt && (
        <p className="font-mono text-[0.55rem] text-muted-foreground">
          Instalado: {installedAt.toISOString().slice(0, 10)}
          {verifiedAt && ` | Verificado: ${verifiedAt.toISOString().slice(0, 10)}`}
        </p>
      )}

      {result && (
        <p className="font-mono text-[0.6rem] text-primary">{result}</p>
      )}

      {status === "PENDING" && isActive && (
        <button
          onClick={handleAddToPlan}
          disabled={isPending}
          className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-7 text-[0.6rem]")}
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          Agregar al plan
        </button>
      )}
    </div>
  );
}
