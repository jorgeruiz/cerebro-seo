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
        // Reload para que el server component muestre los datos reales
        router.refresh();
      } else {
        setError(res.error ?? "Error al guardar");
      }
    });
  }

  if (done) {
    return (
      <div className="h-48 flex flex-col items-center justify-center gap-2">
        <CheckCircle2 className="h-8 w-8 text-green-500" />
        <p className="text-sm text-gray-600">Propiedad conectada. Cargando datos…</p>
      </div>
    );
  }

  if (sites.length === 0) {
    return (
      <div className="h-48 flex flex-col items-center justify-center gap-4">
        <div className="p-3 rounded-full bg-indigo-50">
          <Search className="h-6 w-6 text-indigo-500" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-gray-700">
            Search Console no conectado
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Conecta la propiedad GSC de este cliente para ver datos reales
          </p>
        </div>
        <button
          onClick={handleLoad}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          {loading ? "Cargando propiedades…" : "Conectar Search Console"}
        </button>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="h-48 flex flex-col items-center justify-center gap-4">
      <p className="text-sm font-medium text-gray-700">
        Selecciona la propiedad de este cliente
      </p>
      <div className="relative w-full max-w-sm">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full appearance-none border border-gray-200 rounded-lg px-3 py-2 pr-8 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        >
          <option value="">— Elige una propiedad —</option>
          {sites.map((s) => (
            <option key={s.siteUrl} value={s.siteUrl}>
              {s.siteUrl}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-gray-400 pointer-events-none" />
      </div>
      <button
        onClick={handleConnect}
        disabled={!selected || isPending}
        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors"
      >
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        Guardar propiedad
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
