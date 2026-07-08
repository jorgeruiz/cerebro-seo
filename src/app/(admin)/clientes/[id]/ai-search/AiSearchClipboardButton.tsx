"use client";

import { Plus, Check } from "lucide-react";
import { useClipboard } from "../ClipboardContext";
import { cn } from "@/lib/utils";

interface Props {
  query: string;
  mentioned: boolean;
  position: number | null;
  context: string | null;
}

export function AiSearchClipboardButton({
  query,
  mentioned,
  position,
  context,
}: Props) {
  const { toggleItem, hasItem } = useClipboard();
  const added = hasItem(query, "ai_visibility");

  const lines: string[] = [];
  if (!mentioned) {
    lines.push(`- **Sin mención en IA:** "${query}"`);
    lines.push(`  → Crear contenido optimizado para que LLMs citen al cliente en esta query`);
  } else {
    lines.push(`- **Mención en IA (pos #${position ?? "?"}):** "${query}"`);
    if (context) lines.push(`  Contexto: ${context}`);
    lines.push(`  → Mejorar posición: reforzar contenido autoritativo sobre este tema`);
  }

  const payload = lines.join("\n");

  return (
    <button
      onClick={() =>
        toggleItem({ type: "ai_visibility", label: query, payload })
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
