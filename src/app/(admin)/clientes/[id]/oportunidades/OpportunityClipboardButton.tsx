"use client";

import { Plus, Check } from "lucide-react";
import { useClipboard } from "../ClipboardContext";
import { cn } from "@/lib/utils";

interface Props {
  clientId: string;
  oppType: string;
  label: string;
  action: string;
  priority: string;
  keyword?: string;
  url?: string;
  position?: number;
  impressions?: number;
  clicks?: number;
  ctr?: number;
}

export function OpportunityClipboardButton({
  oppType: _oppType,
  clientId: _clientId,
  label,
  action,
  priority,
  keyword,
  url,
  position,
  impressions,
  ctr,
}: Props) {
  const { toggleItem, hasItem } = useClipboard();

  const displayLabel = keyword ? `"${keyword}"` : url ?? label;
  const added = hasItem(displayLabel, "opportunity");

  const metrics: string[] = [];
  if (position != null) metrics.push(`pos #${Math.round(position)}`);
  if (impressions != null) metrics.push(`${impressions.toLocaleString("es-MX")} imp`);
  if (ctr != null) metrics.push(`CTR ${ctr.toFixed(1)}%`);

  const clipboardPayload = [
    `- **[${priority.toUpperCase()}]** ${displayLabel}`,
    metrics.length > 0 ? `  ${metrics.join(" · ")}` : null,
    `  → ${action}`,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <button
      onClick={() =>
        toggleItem({ type: "opportunity", label: displayLabel, payload: clipboardPayload })
      }
      title={added ? "Quitar del plan" : "Agregar al Plan del Mes"}
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
