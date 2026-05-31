"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus, AlertCircle, Globe } from "lucide-react";
import { actionAddCompetitor, actionDeleteCompetitor } from "./actions";

interface Competitor {
  id: string;
  domain: string;
  createdAt: Date;
}

interface Props {
  clientId: string;
  competitors: Competitor[];
}

export function CompetitorsManager({ clientId, competitors: initialCompetitors }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [competitors, setCompetitors] = useState<Competitor[]>(initialCompetitors);

  const [domain, setDomain] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isFull = competitors.length >= 5;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!domain.trim()) return;
    setError("");
    setLoading(true);
    const res = await actionAddCompetitor({ clientId, domain: domain.trim() });
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setDomain("");
    startTransition(() => router.refresh());
    setCompetitors((prev) => [
      ...prev,
      { id: `tmp-${Date.now()}`, domain: domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""), createdAt: new Date() },
    ]);
  }

  async function handleDelete(comp: Competitor) {
    setCompetitors((prev) => prev.filter((c) => c.id !== comp.id));
    const res = await actionDeleteCompetitor({ competitorId: comp.id, clientId });
    if (res.error) {
      setCompetitors((prev) => [...prev, comp]);
      alert(res.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
        <span>{competitors.length}/5 competidores</span>
        {isFull && <span className="text-ds-yellow">Límite alcanzado — elimina uno para agregar otro</span>}
      </div>

      {competitors.length > 0 && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="divide-y divide-border">
            {[...competitors]
              .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
              .map((comp) => (
                <div key={comp.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors group">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                  <span className="flex-1 text-sm text-foreground font-mono">{comp.domain}</span>
                  <button
                    onClick={() => handleDelete(comp)}
                    disabled={isPending}
                    className="shrink-0 text-muted-foreground/20 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                    title="Eliminar competidor"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {competitors.length === 0 && (
        <div className="bg-card rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">Sin competidores configurados.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Agrega hasta 5 dominios de competidores.</p>
        </div>
      )}

      {!isFull && (
        <form onSubmit={handleAdd} className="bg-card rounded-xl border border-border p-4 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Agregar competidor</p>
          <div className="flex items-center gap-2">
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="competidor.com"
              className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <button
              type="submit"
              disabled={loading || !domain.trim()}
              className="flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-mono rounded-lg px-3 py-1.5 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              {loading ? "Guardando..." : "Agregar"}
            </button>
          </div>
          <p className="text-[10px] font-mono text-muted-foreground/60">
            Solo el dominio: sin http://, www/, ni paths. Ej: competidor.com
          </p>
          {error && (
            <p className="flex items-center gap-1.5 text-xs font-mono text-destructive">
              <AlertCircle className="h-3 w-3 shrink-0" />
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
