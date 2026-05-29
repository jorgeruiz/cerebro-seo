"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, ChevronDown, Loader2, CheckCircle2 } from "lucide-react";
import { listGscSites, setClientGscProperty } from "./actions";
import type { GscSite } from "./actions";

interface Props {
  clientId: string;
}

export function GscConnectSection({ clientId }: Props) {
  const router = useRouter();
  const [sites, setSites] = useState<GscSite[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState("");
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLoad() {
    setLoading(true);
    setError(null);
    const result = await listGscSites();
    setSites(result);
    setLoading(false);
  }

  async function handleConnect() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const res = await setClientGscProperty(clientId, selected);
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

  if (sites.length === 0) {
    return (
      <div className="h-48 flex flex-col items-center justify-center gap-4">
        <div className="p-3 rounded-full bg-primary/10 border border-primary/20">
          <Search className="h-6 w-6 text-primary" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">
            Search Console no conectado
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Conecta la propiedad GSC de este cliente para ver datos reales
          </p>
        </div>
        <button
          onClick={handleLoad}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-xs font-mono rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          {loading ? "Cargando propiedades…" : "Conectar Search Console"}
        </button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="h-48 flex flex-col items-center justify-center gap-4">
      <p className="text-sm font-medium text-foreground">
        Selecciona la propiedad de este cliente
      </p>
      <div className="relative w-full max-w-sm">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full appearance-none border border-border rounded-lg px-3 py-2 pr-8 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary bg-card"
        >
          <option value="">— Elige una propiedad —</option>
          {sites.map((s) => (
            <option key={s.siteUrl} value={s.siteUrl}>
              {s.siteUrl}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
      </div>
      <button
        onClick={handleConnect}
        disabled={!selected || isPending}
        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-xs font-mono rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors"
      >
        {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Guardar propiedad
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
