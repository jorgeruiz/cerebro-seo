"use client";

import { Plus, Check } from "lucide-react";
import { useClipboard } from "../ClipboardContext";
import { cn } from "@/lib/utils";

interface Props {
  keyword: string;
  volume: number | null;
  kd: number | null;
  intent: string | null;
}

function fmtVol(n: number | null): string {
  if (n == null) return "—";
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function KeywordClipboardButton({ keyword, volume, kd, intent }: Props) {
  const { toggleItem, hasItem } = useClipboard();
  const added = hasItem(keyword, "keyword");

  const payload = `- ${keyword} (vol: ${fmtVol(volume)}/mes, KD: ${kd ?? "—"}, intención: ${intent ?? "—"})`;

  return (
    <button
      onClick={() => toggleItem({ type: "keyword", label: keyword, payload })}
      title={added ? "Quitar del portapapeles" : "Añadir al portapapeles"}
      className={cn(
        "h-6 w-6 rounded border flex items-center justify-center transition-colors shrink-0",
        added
          ? "bg-ds-green/10 border-ds-green/30 text-ds-green"
          : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground"
      )}
    >
      {added ? (
        <Check className="h-3 w-3" />
      ) : (
        <Plus className="h-3 w-3" />
      )}
    </button>
  );
}
