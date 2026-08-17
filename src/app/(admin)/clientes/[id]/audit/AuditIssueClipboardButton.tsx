"use client";

import { useState } from "react";
import { Plus, Check, Send, Merge, AlertCircle, Loader2 } from "lucide-react";
import { useClipboard } from "../ClipboardContext";
import { actionSendToOrchestrator } from "../orchestrator-actions";
import { cn } from "@/lib/utils";

interface Props {
  clientId: string;
  title: string;
  description: string | null;
  severity: string;
  category: string;
  affectedUrl: string | null;
  count: number;
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: "CRÍTICO",
  high: "ALTO",
  medium: "MEDIO",
  low: "BAJO",
  info: "INFO",
};

const CATEGORY_LABEL: Record<string, string> = {
  technical: "Técnico",
  performance: "Performance",
  content: "Contenido",
  seo: "SEO",
  accessibility: "Accesibilidad",
};

const SEVERITY_PRIORITY: Record<string, string> = {
  critical: "alta",
  high: "alta",
  medium: "media",
  low: "baja",
  info: "baja",
};

export function AuditIssueClipboardButton({
  clientId,
  title,
  description,
  severity,
  category,
  affectedUrl,
  count,
}: Props) {
  const { toggleItem, hasItem } = useClipboard();
  const added = hasItem(title, "audit_issue");

  const [orchState, setOrchState] = useState<"idle" | "sending" | "sent" | "merged" | "error">("idle");

  const lines: string[] = [
    `- **[${SEVERITY_LABEL[severity] ?? severity}]** ${title}`,
  ];
  if (description) lines.push(`  ${description}`);
  if (affectedUrl) lines.push(`  URL: ${affectedUrl}`);
  if (count > 1) lines.push(`  Afecta ${count} páginas`);
  lines.push(`  Categoría: ${CATEGORY_LABEL[category] ?? category}`);

  const payload = lines.join("\n");

  async function handleSendToOrchestrator(e: React.MouseEvent) {
    e.stopPropagation();
    setOrchState("sending");
    const result = await actionSendToOrchestrator({
      clientId,
      topic: title,
      priority: SEVERITY_PRIORITY[severity] ?? "media",
      actionType: "seo.audit.fix",
      sourceSystem: "cerebro-seo",
      sourceUrl: affectedUrl,
      sourceCategory: CATEGORY_LABEL[category] ?? category,
      payload: {
        title,
        description,
        severity,
        severityLabel: SEVERITY_LABEL[severity] ?? severity,
        category,
        categoryLabel: CATEGORY_LABEL[category] ?? category,
        affectedUrl,
        affectedPageCount: count,
      },
    });
    if (result.ok) {
      setOrchState(result.merged ? "merged" : "sent");
    } else {
      console.error("[orchestrator]", result.error);
      setOrchState("error");
      setTimeout(() => setOrchState("idle"), 4000);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() =>
          toggleItem({ type: "audit_issue", label: title, payload })
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
          : orchState === "error" ? "Error al enviar — reintentar"
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
