"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ClipboardList,
  Copy,
  Check,
  Trash2,
  X,
  AlertTriangle,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui-darkui";
import { useClipboard, type ClipboardItem } from "../ClipboardContext";
import { cn } from "@/lib/utils";

// ─── Helpers ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  keyword:      "Keywords",
  aeo_cluster:  "Temas AEO/GEO",
  content_idea: "Ideas de contenido",
};

function buildMarkdown(items: ClipboardItem[]): string {
  const keywords = items.filter((i) => i.type === "keyword");
  const clusters = items.filter((i) => i.type === "aeo_cluster");
  const ideas    = items.filter((i) => i.type === "content_idea");
  const parts: string[] = [];

  if (keywords.length > 0) {
    parts.push(
      `## Keywords identificadas\n\n${keywords.map((i) => i.payload).join("\n")}`
    );
  }
  if (clusters.length > 0) {
    parts.push(
      `## Temas AEO/GEO\n\n${clusters.map((i) => i.payload).join("\n\n")}`
    );
  }
  if (ideas.length > 0) {
    parts.push(
      `## Ideas de contenido\n\n${ideas.map((i) => i.payload).join("\n\n")}`
    );
  }

  return parts.join("\n\n---\n\n");
}

// ─── ItemRow ────────────────────────────────────────────────────────────────

function ItemRow({ item, onRemove }: { item: ClipboardItem; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="font-mono text-[0.82rem] text-foreground truncate">{item.label}</p>
      </div>
      <button
        onClick={onRemove}
        title="Quitar del portapapeles"
        className="shrink-0 h-5 w-5 flex items-center justify-center rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─── PortapapelesPanel ──────────────────────────────────────────────────────

interface Props {
  clientId: string;
  clientName: string;
}

export function PortapapelesPanel({ clientId, clientName }: Props) {
  const { items, removeItem, clear, count } = useClipboard();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const text = buildMarkdown(items);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback para contextos sin permisos de clipboard
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  const grouped = [
    { key: "keyword",      label: TYPE_LABELS.keyword,      items: items.filter((i) => i.type === "keyword") },
    { key: "aeo_cluster",  label: TYPE_LABELS.aeo_cluster,  items: items.filter((i) => i.type === "aeo_cluster") },
    { key: "content_idea", label: TYPE_LABELS.content_idea, items: items.filter((i) => i.type === "content_idea") },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="min-h-full">
      <div className="p-8 space-y-8">

        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link
              href={`/clientes/${clientId}`}
              className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "gap-1.5")}
            >
              <ArrowLeft className="h-3 w-3" />
              {clientName}
            </Link>
          </div>
          <h1 className="font-display font-extrabold text-[clamp(1.6rem,2.5vw,2.4rem)] tracking-tight leading-[1.05] text-foreground flex items-center gap-3">
            <ClipboardList className="h-6 w-6 text-ds-orange shrink-0" />
            Portapapeles
          </h1>
          <p className="font-mono text-[0.75rem] text-muted-foreground mt-1">
            {count} elemento{count !== 1 ? "s" : ""} seleccionado{count !== 1 ? "s" : ""} · para copiar a Cerebro
          </p>
        </div>

        {/* Warning */}
        <div
          className="bg-card rounded-xl border border-border p-5 flex items-start gap-3"
          style={{ borderLeft: "3px solid #e8c44a" }}
        >
          <AlertTriangle className="h-4 w-4 text-ds-yellow shrink-0 mt-0.5" />
          <div>
            <p className="font-mono text-[0.75rem] font-semibold text-ds-yellow uppercase tracking-wide mb-1">
              El portapapeles es temporal
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Se guarda solo mientras tienes esta pestaña abierta. Se pierde al cerrar el navegador, recargar la página o salir del cliente. Cópialo a Cerebro antes de salir.
            </p>
          </div>
        </div>

        {count === 0 ? (
          /* Empty state */
          <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center gap-4 text-center">
            <ClipboardList className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="text-base font-medium text-foreground mb-1">El portapapeles está vacío</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                Marca keywords, temas AEO o ideas de contenido desde los módulos de research y aquí podrás copiarlos estructurados para pegarlos en Cerebro.
              </p>
            </div>
            <div className="flex gap-2 flex-wrap justify-center">
              <Link
                href={`/clientes/${clientId}/keyword-ideas`}
                className={buttonVariants({ variant: "outline-mono", size: "sm" })}
              >
                Keyword Ideas
              </Link>
              <Link
                href={`/clientes/${clientId}/aeo-research`}
                className={buttonVariants({ variant: "outline-mono", size: "sm" })}
              >
                AEO Research
              </Link>
              <Link
                href={`/clientes/${clientId}/contenido`}
                className={buttonVariants({ variant: "outline-mono", size: "sm" })}
              >
                Plan de Contenido
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* Acciones principales */}
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handleCopy}
                className={cn(buttonVariants({ variant: "default", size: "sm" }), "gap-2")}
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copiar todo a portapapeles
                  </>
                )}
              </button>
              <button
                onClick={clear}
                className={cn(
                  buttonVariants({ variant: "outline-mono", size: "sm" }),
                  "gap-2 text-destructive border-destructive/30 hover:bg-destructive/10"
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Vaciar
              </button>
            </div>

            {/* Items agrupados por tipo */}
            {grouped.map(({ key, label, items: groupItems }) => (
              <section key={key}>
                <SectionHeader>
                  <span className="flex items-center gap-2">
                    {label}
                    <span className="font-mono text-[0.7rem] bg-muted border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                      {groupItems.length}
                    </span>
                  </span>
                </SectionHeader>
                <div className="space-y-2">
                  {groupItems.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      onRemove={() => removeItem(item.id)}
                    />
                  ))}
                </div>
              </section>
            ))}

            {/* Vista previa del markdown */}
            <section>
              <SectionHeader>Vista previa del texto a copiar</SectionHeader>
              <pre className="bg-muted/20 border border-border rounded-xl p-5 font-mono text-[0.78rem] text-muted-foreground leading-relaxed overflow-x-auto whitespace-pre-wrap">
                {buildMarkdown(items)}
              </pre>
            </section>
          </>
        )}

      </div>
    </div>
  );
}
