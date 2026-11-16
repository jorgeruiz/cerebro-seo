"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Loader2, Plus, X } from "lucide-react";

export function VerifiedServicesEditor({
  clientId,
  verified,
  excluded,
}: {
  clientId: string;
  verified: string[];
  excluded: string[];
}) {
  const [verifiedList, setVerifiedList] = useState(verified);
  const [excludedList, setExcludedList] = useState(excluded);
  const [newVerified, setNewVerified] = useState("");
  const [newExcluded, setNewExcluded] = useState("");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    startTransition(async () => {
      const { actionSaveVerifiedServices } = await import("./verified-services-actions");
      const res = await actionSaveVerifiedServices(clientId, verifiedList, excludedList);
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    });
  };

  const addVerified = () => {
    if (newVerified.trim() && !verifiedList.includes(newVerified.trim())) {
      setVerifiedList([...verifiedList, newVerified.trim()]);
      setNewVerified("");
    }
  };

  const addExcluded = () => {
    if (newExcluded.trim() && !excludedList.includes(newExcluded.trim())) {
      setExcludedList([...excludedList, newExcluded.trim()]);
      setNewExcluded("");
    }
  };

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <h3 className="font-mono text-sm font-semibold">Servicios verificados</h3>
      <p className="font-mono text-[0.6rem] text-muted-foreground">
        El Analisis y los ejecutores solo mencionan los servicios verificados. Lo que esta en la lista de exclusion se prohibe explicitamente.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <p className="font-mono text-[0.6rem] text-emerald-500 font-semibold">Ofrece</p>
          {verifiedList.map((s, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="font-mono text-[0.65rem] text-foreground flex-1">{s}</span>
              <button onClick={() => setVerifiedList(verifiedList.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <div className="flex gap-1">
            <input value={newVerified} onChange={(e) => setNewVerified(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addVerified()}
              placeholder="Agregar servicio..."
              className="flex-1 font-mono text-[0.65rem] border border-border rounded px-2 py-1 bg-card" />
            <button onClick={addVerified} className="text-muted-foreground hover:text-foreground">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <p className="font-mono text-[0.6rem] text-red-400 font-semibold">NO ofrece</p>
          {excludedList.map((s, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="font-mono text-[0.65rem] text-foreground flex-1">{s}</span>
              <button onClick={() => setExcludedList(excludedList.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <div className="flex gap-1">
            <input value={newExcluded} onChange={(e) => setNewExcluded(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addExcluded()}
              placeholder="Servicio que NO ofrece..."
              className="flex-1 font-mono text-[0.65rem] border border-border rounded px-2 py-1 bg-card" />
            <button onClick={addExcluded} className="text-muted-foreground hover:text-foreground">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-3 items-center">
        <button onClick={handleSave} disabled={isPending}
          className={cn(buttonVariants({ variant: "default", size: "sm" }), "text-xs")}>
          {isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          Guardar
        </button>
        {saved && <span className="font-mono text-[0.6rem] text-emerald-500">Guardado</span>}
      </div>
    </div>
  );
}
