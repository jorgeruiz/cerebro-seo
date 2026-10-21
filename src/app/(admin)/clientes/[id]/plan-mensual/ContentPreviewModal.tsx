"use client";

import { useState, useEffect, useTransition } from "react";
import Image from "next/image";
import { X, AlertTriangle, Link as LinkIcon, Loader2, WrapText, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { actionFetchContentPreview, actionFixBorrador, type ContentPreviewData } from "./content-preview-action";

interface Props {
  taskId: string;
  taskTitle: string;
  planPreviewUrl: string | null;
  onClose: () => void;
}

export function ContentPreviewModal({ taskId, taskTitle, planPreviewUrl, onClose }: Props) {
  const [data, setData] = useState<ContentPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fixMsg, setFixMsg] = useState<string | null>(null);
  const [isLoading, startLoad] = useTransition();
  const [isFixing, startFix] = useTransition();

  useEffect(() => {
    startLoad(async () => {
      const result = await actionFetchContentPreview(taskId);
      if (result.ok) {
        setData(result.data);
      } else {
        setError(result.error);
      }
    });
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleFix() {
    startFix(async () => {
      setFixMsg(null);
      const result = await actionFixBorrador(taskId);
      if (result.ok) {
        setFixMsg("Corregido. Recarga el modal para verificar.");
        setData((prev) => prev ? { ...prev, hasBorrador: false } : prev);
      } else {
        setFixMsg(`Error: ${result.error}`);
      }
    });
  }

  // Build Google-like preview URL
  const previewRoute = data?.route ?? "";
  const siteLabel = planPreviewUrl
    ? `${planPreviewUrl.replace(/\/$/, "")}${previewRoute}`
    : previewRoute;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <WrapText className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground truncate max-w-md">{taskTitle}</span>
          </div>
          <div className="flex items-center gap-2">
            {data?.githubUrl && (
              <a
                href={data.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "gap-1.5")}
              >
                <ExternalLink className="h-3 w-3" /> Ver en GitHub
              </a>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Leyendo desde GitHub…</span>
            </div>
          )}

          {error && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          {data && (
            <>
              {/* Landing page — no es MDX */}
              {data.isCode && (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    Esta tarea es una <strong>landing page</strong> (.tsx) — no tiene frontmatter MDX.
                    El contenido se generó como código React. Usa <strong>Ver en sitio</strong> para revisar el resultado visual.
                  </p>
                </div>
              )}

              {/* borrador warning */}
              {data.hasBorrador && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-yellow-600">
                      borrador: true detectado en frontmatter
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Este campo no existe en Next.js — el artículo no se publicará correctamente.
                      {fixMsg && <span className="ml-1 text-emerald-600">{fixMsg}</span>}
                    </p>
                  </div>
                  <button
                    onClick={handleFix}
                    disabled={isFixing}
                    className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "shrink-0 gap-1")}
                  >
                    {isFixing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    Fix
                  </button>
                </div>
              )}

              {/* Frontmatter raw — cuando no se detectan title/description */}
              {(!data.title || !data.description) && !data.isCode && data.frontmatterRaw && (
                <div>
                  <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground mb-2">
                    Frontmatter detectado
                  </p>
                  <pre className="font-mono text-[0.65rem] bg-muted/30 border border-border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap text-muted-foreground">
                    {data.frontmatterRaw}
                  </pre>
                </div>
              )}

              {/* Google Search preview */}
              <div>
                <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground mb-2">
                  Cómo se verá en Google
                </p>
                <div className="border border-border rounded-xl p-4 bg-background space-y-1 max-w-xl">
                  {data.coverImage && (
                    <Image
                      src={data.coverImage}
                      alt="Portada"
                      width={600}
                      height={128}
                      className="w-full h-32 object-cover rounded-lg mb-3"
                      unoptimized
                    />
                  )}
                  <p className="text-[0.65rem] text-green-700 truncate">{siteLabel}</p>
                  <a
                    href={planPreviewUrl ? siteLabel : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "text-[1.05rem] font-medium leading-tight block",
                      planPreviewUrl ? "text-blue-700 hover:underline" : "text-blue-700"
                    )}
                  >
                    {data.title || "(sin title)"}
                  </a>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {data.description || "(sin meta description)"}
                  </p>
                </div>
              </div>

              {/* Body preview */}
              {data.bodyPreview && (
                <div>
                  <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground mb-2">
                    Vista previa del contenido
                  </p>
                  <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap font-mono bg-muted/20 rounded-lg p-3 max-h-40 overflow-y-auto">
                    {data.bodyPreview}…
                  </p>
                </div>
              )}

              {/* Internal links */}
              {data.internalLinks.length > 0 && (
                <div>
                  <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground mb-2">
                    Enlaces internos ({data.internalLinks.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.internalLinks.map((link) => (
                      <a
                        key={link}
                        href={planPreviewUrl ? `${planPreviewUrl.replace(/\/$/, "")}${link}` : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[0.65rem] bg-muted/30 border border-border rounded px-1.5 py-0.5 flex items-center gap-0.5 hover:bg-muted/60 transition-colors"
                      >
                        <LinkIcon className="h-2.5 w-2.5 text-muted-foreground" />
                        {link}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* File path */}
              <p className="font-mono text-[0.6rem] text-muted-foreground/60">
                {data.filePath}
              </p>

              {/* Frontmatter debug — muestra si title/description están vacíos */}
              {(!data.title || !data.description) && data.frontmatterKeys.length > 0 && (
                <p className="font-mono text-[0.55rem] text-muted-foreground/40">
                  campos: {data.frontmatterKeys.join(", ")}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
