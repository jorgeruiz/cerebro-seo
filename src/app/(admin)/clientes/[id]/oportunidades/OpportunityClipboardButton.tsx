"use client";

import { useState } from "react";
import { Plus, Check, Send, Merge, AlertCircle, Loader2 } from "lucide-react";
import { useClipboard } from "../ClipboardContext";
import { actionSendToOrchestrator } from "../orchestrator-actions";
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

const ACTION_TYPE_MAP: Record<string, string> = {
  "ctr-issue-query": "seo.meta.optimize",
  "ctr-issue-page":  "seo.meta.optimize",
  "quick-win":       "seo.content.optimize",
  "no-coverage":     "blog.create",
  "poor-position":   "seo.content.optimize",
};

export function OpportunityClipboardButton({
  clientId,
  oppType,
  label,
  action,
  priority,
  keyword,
  url,
  position,
  impressions,
  clicks,
  ctr,
}: Props) {
  const { toggleItem, hasItem } = useClipboard();

  const displayLabel = keyword ? `"${keyword}"` : url ?? label;
  const added = hasItem(displayLabel, "opportunity");

  const [orchState, setOrchState] = useState<"idle" | "sending" | "sent" | "merged" | "error">("idle");
  const [orchError, setOrchError] = useState<string | null>(null);

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

  async function handleSendToOrchestrator(e: React.MouseEvent) {
    e.stopPropagation();
    setOrchState("sending");
    const result = await actionSendToOrchestrator({
      clientId,
      topic: keyword ?? url ?? label,
      priority,
      actionType: ACTION_TYPE_MAP[oppType],
      sourceSystem: "cerebro-seo",
      sourceUrl: url ?? null,
      sourceCategory: oppType,
      payload: {
        oppType,
        label,
        action,
        keyword: keyword ?? null,
        url: url ?? null,
        position: position ?? null,
        impressions: impressions ?? null,
        clicks: clicks ?? null,
        ctr: ctr ?? null,
      },
    });
    if (result.ok) {
      setOrchState(result.merged ? "merged" : "sent");
    } else {
      console.error("[orchestrator]", result.error);
      setOrchError(result.error);
      setOrchState("error");
      setTimeout(() => { setOrchState("idle"); setOrchError(null); }, 6000);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() =>
          toggleItem({ type: "opportunity", label: displayLabel, payload: clipboardPayload })
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
      <button
        onClick={handleSendToOrchestrator}
        disabled={orchState === "sending" || orchState === "sent" || orchState === "merged"}
        title={
          orchState === "merged" ? "Enviado — merged"
          : orchState === "sent" ? "Enviado al Orquestador"
          : orchState === "sending" ? "Enviando..."
          : orchState === "error" ? (orchError ?? "Error al enviar — reintentar")
          : "Enviar al Orquestador"
        }
        className={cn(
          "h-6 w-6 rounded border flex items-center justify-center transition-colors shrink-0",
          orchState === "merged"
            ? "bg-ds-blue/10 border-ds-blue/30 text-ds-blue"
            : orchState === "sent"
              ? "bg-ds-green/10 border-ds-green/30 text-ds-green"
              : orchState === "error"
                ? "bg-destructive/10 border-destructive/30 text-destructive"
                : orchState === "sending"
                  ? "bg-muted border-border text-muted-foreground cursor-wait"
                  : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground"
        )}
      >
        {orchState === "sending" ? <Loader2 className="h-3 w-3 animate-spin" />
          : orchState === "merged" ? <Merge className="h-3 w-3" />
          : orchState === "sent" ? <Check className="h-3 w-3" />
          : orchState === "error" ? <AlertCircle className="h-3 w-3" />
          : <Send className="h-3 w-3" />}
      </button>
    </div>
  );
}
