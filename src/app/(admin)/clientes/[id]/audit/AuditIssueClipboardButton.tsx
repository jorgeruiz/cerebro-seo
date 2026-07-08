"use client";

import { Plus, Check } from "lucide-react";
import { useClipboard } from "../ClipboardContext";
import { cn } from "@/lib/utils";

interface Props {
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

export function AuditIssueClipboardButton({
  title,
  description,
  severity,
  category,
  affectedUrl,
  count,
}: Props) {
  const { toggleItem, hasItem } = useClipboard();
  const added = hasItem(title, "audit_issue");

  const lines: string[] = [
    `- **[${SEVERITY_LABEL[severity] ?? severity}]** ${title}`,
  ];
  if (description) lines.push(`  ${description}`);
  if (affectedUrl) lines.push(`  URL: ${affectedUrl}`);
  if (count > 1) lines.push(`  Afecta ${count} páginas`);
  lines.push(`  Categoría: ${CATEGORY_LABEL[category] ?? category}`);

  const payload = lines.join("\n");

  return (
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
  );
}
