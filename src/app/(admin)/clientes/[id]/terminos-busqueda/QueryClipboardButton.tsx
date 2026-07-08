"use client";

import { Plus, Check } from "lucide-react";
import { useClipboard } from "../ClipboardContext";
import { cn } from "@/lib/utils";

interface Props {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export function QueryClipboardButton({
  query,
  clicks,
  impressions,
  ctr,
  position,
}: Props) {
  const { toggleItem, hasItem } = useClipboard();
  const added = hasItem(query, "search_term");

  const payload = `- **"${query}"** — pos #${position.toFixed(1)}, ${impressions.toLocaleString("es-MX")} imp, ${clicks.toLocaleString("es-MX")} clics, CTR ${ctr.toFixed(1)}%\n  → Optimizar title/meta description para mejorar CTR`;

  return (
    <button
      onClick={() =>
        toggleItem({ type: "search_term", label: query, payload })
      }
      title={added ? "Quitar del plan" : "Añadir al plan de trabajo"}
      className={cn(
        "h-6 w-6 rounded border flex items-center justify-center transition-colors shrink-0",
        added
          ? "bg-ds-green/10 border-ds-green/30 text-ds-green"
          : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground"
      )}
    >
      {added ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
    </button>
  );
}
