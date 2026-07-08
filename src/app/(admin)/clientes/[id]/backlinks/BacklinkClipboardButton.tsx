"use client";

import { Plus, Check } from "lucide-react";
import { useClipboard } from "../ClipboardContext";
import { cn } from "@/lib/utils";

interface Props {
  sourceDomain: string;
  domainAuthority: number | null;
  anchorText: string | null;
  status: "lost" | "gained";
}

export function BacklinkClipboardButton({
  sourceDomain,
  domainAuthority,
  anchorText,
  status,
}: Props) {
  const { toggleItem, hasItem } = useClipboard();
  const label = `${status === "lost" ? "Recuperar" : "Monitorear"}: ${sourceDomain}`;
  const added = hasItem(label, "backlink_action");

  const lines: string[] = [];
  if (status === "lost") {
    lines.push(`- **Recuperar backlink perdido:** ${sourceDomain}`);
    if (domainAuthority != null) lines.push(`  DA: ${domainAuthority}`);
    if (anchorText) lines.push(`  Anchor: "${anchorText}"`);
    lines.push(`  → Contactar webmaster o encontrar enlace alternativo`);
  } else {
    lines.push(`- **Nuevo backlink ganado:** ${sourceDomain}`);
    if (domainAuthority != null) lines.push(`  DA: ${domainAuthority}`);
    if (anchorText) lines.push(`  Anchor: "${anchorText}"`);
    lines.push(`  → Verificar que el enlace sea dofollow y relevante`);
  }

  const payload = lines.join("\n");

  return (
    <button
      onClick={() =>
        toggleItem({ type: "backlink_action", label, payload })
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
