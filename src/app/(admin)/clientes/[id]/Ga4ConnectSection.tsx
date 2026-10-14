"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BarChart2, ChevronDown, Loader2, CheckCircle2 } from "lucide-react";
import { listGa4Properties, setClientGa4Property } from "./actions";
import type { Ga4Property } from "./actions";

interface Props {
  clientId: string;
}

export function Ga4ConnectSection({ clientId }: Props) {
  const router = useRouter();
  const [properties, setProperties] = useState<Ga4Property[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState("");
  const [manual, setManual] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLoad() {
    setLoading(true);
    setError(null);
    const result = await listGa4Properties();
    setProperties(result);
    setLoaded(true);
    setLoading(false);
  }

  async function handleConnect(value: string) {
    if (!value) return;
    setError(null);
    startTransition(async () => {
      const res = await setClientGa4Property(clientId, value);
      if (res.ok) {
        setDone(true);
        router.refresh();
      } else {
        setError(res.error ?? "Error al guardar");
      }
    });
  }

  if (done) {
    return (
      <div className="h-48 flex flex-col items-center justify-center gap-2">
        <CheckCircle2 className="h-8 w-8 text-ds-green" />
        <p className="text-sm text-muted-foreground">Propiedad conectada. Cargando datos…</p>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="h-48 flex flex-col items-center justify-center gap-4">
        <div className="p-3 rounded-full bg-primary/10 border border-primary/20">
          <BarChart2 className="h-6 w-6 text-primary" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">Google Analytics 4 no conectado</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Conecta la propiedad GA4 de este cliente para ver datos reales
          </p>
        </div>
        <button
          onClick={handleLoad}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-xs font-mono rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart2 className="h-3.5 w-3.5" />}
          {loading ? "Cargando propiedades…" : "Conectar Analytics 4"}
        </button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  if (manual) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">Ingresar propiedad manualmente</p>
        <input
          type="text"
          autoFocus
          value={manualValue}
          onChange={(e) => setManualValue(e.target.value)}
          placeholder="properties/123456789"
          className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground/50"
        />
        <p className="text-[10px] font-mono text-muted-foreground/60">
          Formato: properties/XXXXXXXXX
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => handleConnect(manualValue.trim())}
            disabled={!manualValue.trim() || isPending}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-xs font-mono rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors"
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Guardar
          </button>
          <button
            onClick={() => setManual(false)}
            className="px-4 py-2 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancelar
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">Selecciona la propiedad de este cliente</p>
      <div className="relative">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full appearance-none border border-border rounded-lg px-3 py-2 pr-8 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary bg-card"
        >
          <option value="">{properties.length ? "— Elige una propiedad —" : "— Sin propiedades en esta cuenta —"}</option>
          {properties.map((p) => (
            <option key={p.propertyId} value={p.propertyId}>
              {p.displayName} ({p.propertyId})
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
      </div>
      <div className="flex items-center gap-4">
        <button
          onClick={() => handleConnect(selected)}
          disabled={!selected || isPending}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-xs font-mono rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors"
        >
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Guardar propiedad
        </button>
        <button
          onClick={() => setManual(true)}
          className="text-[10px] font-mono text-muted-foreground/60 hover:text-primary transition-colors"
        >
          ¿No aparece? Ingresar manualmente →
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
