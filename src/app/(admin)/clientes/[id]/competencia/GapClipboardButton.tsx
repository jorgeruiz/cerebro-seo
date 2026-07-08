"use client";

import { Plus, Check } from "lucide-react";
import { useClipboard } from "../ClipboardContext";
import { cn } from "@/lib/utils";

interface Props {
  keyword: string;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  intent: string | null;
  competitorDomain: string;
  competitorPosition: number;
}

export function GapClipboardButton({
  keyword,
  searchVolume,
  keywordDifficulty,
  intent,
  competitorDomain,
  competitorPosition,
}: Props) {
  const { toggleItem, hasItem } = useClipboard();
  const added = hasItem(keyword, "competitor_gap");

  const metrics: string[] = [];
  if (searchVolume != null) metrics.push(`vol: ${searchVolume.toLocaleString("es-MX")}/mes`);
  if (keywordDifficulty != null) metrics.push(`KD: ${keywordDifficulty}`);
  if (intent) metrics.push(`intent: ${intent}`);

  const payload = [
    `- **${keyword}** — ${competitorDomain} rankea #${competitorPosition}`,
    metrics.length > 0 ? `  ${metrics.join(" · ")}` : null,
    `  → Crear contenido para competir por esta keyword`,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <button
      onClick={() =>
        toggleItem({ type: "competitor_gap", label: keyword, payload })
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
