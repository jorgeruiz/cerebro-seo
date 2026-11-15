"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { DEFAULT_PLAN_CONFIG, type ClientPlanConfig } from "@/lib/plan/plan-composer";

export function PlanConfigEditor({
  clientId,
  current,
}: {
  clientId: string;
  current: ClientPlanConfig;
}) {
  const [config, setConfig] = useState(current);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    startTransition(async () => {
      const { actionSavePlanConfig } = await import("./plan-config-actions");
      const res = await actionSavePlanConfig(clientId, config);
      if (res.ok) setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  const update = (key: keyof ClientPlanConfig, value: unknown) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <h3 className="font-mono text-sm font-semibold">Configuracion del plan</h3>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Field label="Max tareas" value={config.maxTasks} onChange={(v) => update("maxTasks", Number(v))} type="number" />
        <Field label="Min humanos (min)" value={config.humanMinutesCap} onChange={(v) => update("humanMinutesCap", Number(v))} type="number" />
        <Field label="Costo API max ($)" value={config.apiCostCapUsd} onChange={(v) => update("apiCostCapUsd", Number(v))} type="number" step="0.5" />
      </div>

      <div className="space-y-1">
        <p className="font-mono text-[0.6rem] text-muted-foreground">Mezcla (fracciones)</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Urgentes tope" value={config.mix.urgentCap}
            onChange={(v) => update("mix", { ...config.mix, urgentCap: Number(v) })} type="number" step="0.05" />
          <Field label="Easy wins" value={config.mix.easyWinTarget}
            onChange={(v) => update("mix", { ...config.mix, easyWinTarget: Number(v) })} type="number" step="0.05" />
          <Field label="Estrategicas" value={config.mix.strategicTarget}
            onChange={(v) => update("mix", { ...config.mix, strategicTarget: Number(v) })} type="number" step="0.05" />
        </div>
      </div>

      <div className="space-y-1">
        <p className="font-mono text-[0.6rem] text-muted-foreground">Minimos por categoria</p>
        <div className="grid grid-cols-3 gap-3">
          {(["technical", "content", "aeo_geo", "authority_local", "measurement_conversion"] as const).map((cat) => (
            <Field key={cat} label={cat} value={config.categoryMinimums[cat] ?? 0}
              onChange={(v) => update("categoryMinimums", { ...config.categoryMinimums, [cat]: Number(v) })} type="number" />
          ))}
        </div>
      </div>

      <div className="flex gap-3 items-center">
        <button onClick={handleSave} disabled={isPending}
          className={cn(buttonVariants({ variant: "default", size: "sm" }), "text-xs")}>
          {isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          Guardar
        </button>
        <button onClick={() => setConfig(DEFAULT_PLAN_CONFIG)}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-xs")}>
          Restaurar defaults
        </button>
        {saved && <span className="font-mono text-[0.6rem] text-emerald-500">Guardado</span>}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", step }: {
  label: string; value: string | number; onChange: (v: string) => void; type?: string; step?: string;
}) {
  return (
    <div>
      <label className="font-mono text-[0.55rem] text-muted-foreground">{label}</label>
      <input type={type} step={step} value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full font-mono text-[0.65rem] border border-border rounded px-2 py-1 bg-card" />
    </div>
  );
}
