"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import {
  Bot, User, Settings2, FileText, Code, Info,
  ChevronDown, ChevronRight, Loader2,
  Play, CheckCircle2, XCircle,
  Clock, Ban, RotateCcw, RefreshCw, Terminal,
  ExternalLink, GitMerge, Send, DollarSign, Eye, Archive, WrapText, AlertTriangle,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getPlanData,
  actionExecuteTask,
  actionCompleteHumanStep,
  actionVoidTask,
  actionResetTask,
  actionArchivePlan,
  actionActivatePlan,
  actionRunWatchdog,
  actionSubmitForReview,
  actionMergePlan,
  actionPublishNextjsBlog,
  type PlanFullView,
  type PlanTaskFullView,
  type PlanStepView,
  type PlanMonthOption,
} from "./actions";
import { TerminalPanel } from "./TerminalPanel";
import { ContentPreviewModal } from "./ContentPreviewModal";

// ─── Constants ──────────────────────────────────────────────────────────────

const MODE_BADGE: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  AI:     { label: "IA",      icon: Bot,      color: "text-ds-blue bg-ds-blue/10 border-ds-blue/30" },
  HYBRID: { label: "Hibrido", icon: User,     color: "text-purple-500 bg-purple-500/10 border-purple-500/30" },
  HUMAN:  { label: "Manual",  icon: User,     color: "text-orange-500 bg-orange-500/10 border-orange-500/30" },
};

const KIND_ICON: Record<string, React.ElementType> = {
  CONTENT: FileText,
  CODE: Code,
  SETUP: Settings2,
};

const TASK_STATUS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  PLANNING:      { label: "Generando pasos...", icon: Loader2,        color: "text-yellow-500" },
  READY:         { label: "Listo",              icon: CheckCircle2,   color: "text-green-500" },
  RUNNING:       { label: "Ejecutando...",      icon: Loader2,        color: "text-ds-blue" },
  WAITING_HUMAN: { label: "Esperando humano",   icon: Clock,          color: "text-orange-500" },
  DONE:          { label: "Completado",         icon: CheckCircle2,   color: "text-emerald-500" },
  FAILED:        { label: "Error",              icon: XCircle,        color: "text-destructive" },
  VOIDED:        { label: "Anulado",            icon: Ban,            color: "text-muted-foreground" },
};

const STEP_STATUS: Record<string, { label: string; color: string }> = {
  PENDING:       { label: "Pendiente",     color: "text-muted-foreground" },
  RUNNING:       { label: "Ejecutando",    color: "text-ds-blue" },
  DONE:          { label: "Hecho",         color: "text-emerald-500" },
  FAILED:        { label: "Error",         color: "text-destructive" },
  WAITING_HUMAN: { label: "Pendiente",     color: "text-orange-500" },
  SKIPPED:       { label: "Omitido",       color: "text-muted-foreground" },
};

const EFFORT_LABEL: Record<string, string> = { LOW: "Bajo", MEDIUM: "Medio", HIGH: "Alto" };

// ─── Progress helpers ───────────────────────────────────────────────────────

function taskProgress(task: PlanTaskFullView): number {
  if (task.status === "DONE") return 100;
  if (task.status === "VOIDED") return 100;
  if (task.steps.length === 0) return 0;
  const done = task.steps.filter((s) => s.status === "DONE" || s.status === "SKIPPED").length;
  return Math.round((done / task.steps.length) * 100);
}

function planProgress(tasks: PlanTaskFullView[]): number {
  if (tasks.length === 0) return 0;
  const active = tasks.filter((t) => t.status !== "VOIDED");
  if (active.length === 0) return 100;
  const done = active.filter((t) => t.status === "DONE").length;
  return Math.round((done / active.length) * 100);
}

function hasActiveWork(tasks: PlanTaskFullView[]): boolean {
  return tasks.some((t) => t.status === "RUNNING" || t.status === "PLANNING");
}

// ─── Month Selector ─────────────────────────────────────────────────────────

function MonthSelector({
  months,
  selected,
  onSelect,
}: {
  months: PlanMonthOption[];
  selected: string;
  onSelect: (m: string) => void;
}) {
  if (months.length <= 1) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[0.65rem] text-muted-foreground uppercase">Mes:</span>
      <select
        value={selected}
        onChange={(e) => onSelect(e.target.value)}
        className="font-mono text-xs bg-card border border-border rounded px-2 py-1 text-foreground"
      >
        {months.map((m) => (
          <option key={m.month} value={m.month}>
            {m.month} ({m.taskCount} tareas){m.status === "ARCHIVED" ? " — archivado" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Progress Bar ───────────────────────────────────────────────────────────

function ProgressBar({ percent, size = "lg" }: { percent: number; size?: "sm" | "lg" }) {
  return (
    <div className={cn("w-full bg-muted rounded-full overflow-hidden", size === "lg" ? "h-3" : "h-1.5")}>
      <div
        className="h-full bg-gradient-to-r from-[#6366f1] via-[#3b82f6] to-[#ec4899] transition-all duration-500 ease-out rounded-full"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

// ─── Content Package Block ───────────────────────────────────────────────────

interface ContentSection { h2: string; h3s?: string[]; text: string; table?: { headers: string[]; rows: string[][] } }
interface ContentFaq { q: string; a: string }
interface ContentLink { anchor: string; url: string; context: string }
interface OptimizationWidget { section: string; widget_type: string; before: string; after: string }
interface OptimizationChange { page_title: string; page_id: number; widgets: OptimizationWidget[] }
interface ContentPackage {
  type: "content_package";
  kind: "blog" | "landing" | "optimization";
  keyword: string;
  page_title: string;
  h1: string;
  sections: ContentSection[];
  meta_title: string;
  meta_description: string;
  schema_jsonld?: Record<string, unknown>;
  internal_links?: ContentLink[];
  faq?: ContentFaq[];
  cta?: string;
  image_brief?: string;
  optimization_changes?: OptimizationChange[];
}

function CopyableBlock({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group/block relative">
      <p className="font-mono text-[0.55rem] text-indigo-400/70 mb-0.5">{label}</p>
      <div className="bg-zinc-950 rounded px-2.5 py-2">
        <pre className={cn("whitespace-pre-wrap leading-relaxed text-zinc-200", mono ? "font-mono text-[0.6rem]" : "font-sans text-xs")}>{value}</pre>
        <button
          onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="absolute top-1 right-1 opacity-0 group-hover/block:opacity-100 transition-opacity font-mono text-[0.5rem] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded hover:text-zinc-200"
        >
          {copied ? "✓" : "Copiar"}
        </button>
      </div>
    </div>
  );
}

function ContentPackageBlock({ pkg }: { pkg: ContentPackage }) {
  const structureText = [
    `H1: ${pkg.h1}`,
    ...(pkg.sections ?? []).map((s: ContentSection) => [
      `H2: ${s.h2}`,
      ...(s.h3s ?? []).map((h3) => `  H3: ${h3}`),
    ].join("\n")),
  ].join("\n");

  const fullTextBlocks = (pkg.sections ?? []).map((s: ContentSection) =>
    [`## ${s.h2}`, ...(s.h3s ?? []).map((h: string) => `### ${h}`), s.text].join("\n")
  ).join("\n\n");

  const faqText = (pkg.faq ?? []).map((f: ContentFaq) => `Q: ${f.q}\nA: ${f.a}`).join("\n\n");
  const linksText = (pkg.internal_links ?? []).map((l: ContentLink) => `- ${l.anchor} → ${l.url} (${l.context})`).join("\n");
  const schemaText = JSON.stringify(pkg.schema_jsonld ?? {}, null, 2);

  return (
    <div className="mt-2 border border-indigo-500/30 rounded-md bg-indigo-500/5 p-3 space-y-2.5">
      <p className="font-mono text-[0.6rem] font-semibold text-indigo-400 flex items-center gap-1.5">
        <FileText className="h-3 w-3" />
        Paquete de contenido — {pkg.kind} · {pkg.keyword}
      </p>

      <CopyableBlock label="H1" value={pkg.h1} />
      <CopyableBlock label="Estructura (H2 / H3)" value={structureText} />
      <CopyableBlock label="Meta title" value={pkg.meta_title} />
      <CopyableBlock label="Meta description" value={pkg.meta_description} />
      <CopyableBlock label="CTA" value={pkg.cta ?? ""} />

      {faqText && <CopyableBlock label={`FAQ (${pkg.faq?.length ?? 0})`} value={faqText} />}
      {linksText && <CopyableBlock label="Enlaces internos" value={linksText} />}
      {pkg.image_brief && <CopyableBlock label="Brief de imagen" value={pkg.image_brief} />}
      {schemaText !== "{}" && <CopyableBlock label="Schema JSON-LD" value={schemaText} />}

      <details className="group/content">
        <summary className="font-mono text-[0.6rem] text-indigo-400 cursor-pointer hover:underline flex items-center gap-1">
          <ChevronRight className="h-2.5 w-2.5 group-open/content:rotate-90 transition-transform" />
          Ver textos completos por sección
        </summary>
        <div className="mt-2">
          <CopyableBlock label="Contenido completo" value={fullTextBlocks} />
        </div>
      </details>

      {pkg.optimization_changes && pkg.optimization_changes.length > 0 && (
        <div className="space-y-2">
          <p className="font-mono text-[0.55rem] text-indigo-400/70 font-semibold">Cambios antes → después:</p>
          {pkg.optimization_changes.map((change: OptimizationChange, ci: number) => (
            <div key={ci} className="space-y-1.5">
              <p className="font-mono text-[0.55rem] text-zinc-400">{change.page_title}</p>
              {change.widgets.map((w: OptimizationWidget, wi: number) => (
                <div key={wi} className="bg-zinc-900 rounded p-2 space-y-1">
                  <p className="font-mono text-[0.55rem] text-zinc-500">{w.section} · {w.widget_type}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <p className="font-mono text-[0.5rem] text-red-400/70 mb-0.5">Antes:</p>
                      <div className="bg-red-950/30 rounded px-1.5 py-1">
                        <p className="font-mono text-[0.55rem] text-red-200/80 whitespace-pre-wrap">{w.before}</p>
                      </div>
                    </div>
                    <div>
                      <p className="font-mono text-[0.5rem] text-emerald-400/70 mb-0.5">Después:</p>
                      <div className="bg-emerald-950/30 rounded px-1.5 py-1 relative group/after">
                        <p className="font-mono text-[0.55rem] text-emerald-200/80 whitespace-pre-wrap">{w.after}</p>
                        <button
                          onClick={() => navigator.clipboard.writeText(w.after)}
                          className="absolute top-0.5 right-0.5 opacity-0 group-hover/after:opacity-100 font-mono text-[0.45rem] bg-zinc-800 text-zinc-400 px-1 py-0.5 rounded"
                        >
                          Copiar
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Step Row ───────────────────────────────────────────────────────────────

function StepRow({
  step,
  stepResult,
  onComplete,
  isCompleting,
  isWordPress = false,
  isActionable = true,
}: {
  step: PlanStepView;
  stepResult: string | null;
  onComplete: (stepId: string) => void;
  isCompleting: boolean;
  isWordPress?: boolean;
  /** true if this step is the first pending step (can be acted on) */
  isActionable?: boolean;
}) {
  const statusCfg = STEP_STATUS[step.status] ?? STEP_STATUS.PENDING;
  const isHumanPending = step.type === "HUMAN" && (step.status === "PENDING" || step.status === "WAITING_HUMAN") && isActionable;

  return (
    <div className="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-muted/30 group">
      <span className="font-mono text-[0.65rem] text-muted-foreground w-5 shrink-0 pt-0.5 text-right">
        {step.order}.
      </span>

      <span
        className={cn(
          "font-mono text-[0.6rem] px-1 py-0.5 rounded shrink-0 mt-0.5",
          step.type === "AI"
            ? "bg-ds-blue/10 text-ds-blue"
            : "bg-orange-500/10 text-orange-500"
        )}
      >
        {step.type === "AI" ? "IA" : "HT"}
      </span>

      <div className="flex-1 min-w-0">
        <p className="text-xs text-foreground leading-snug">{step.title}</p>

        {/* Human step instructions */}
        {step.type === "HUMAN" && isHumanPending && (
          <div className="mt-1.5 bg-orange-500/5 border border-orange-500/20 rounded px-2.5 py-2 space-y-2">
            <p className="font-mono text-[0.6rem] font-semibold text-orange-400">Que hacer:</p>
            {step.acceptanceCriteria.length > 0 && (
              <ul className="space-y-0.5">
                {step.acceptanceCriteria.map((c, i) => (
                  <li key={i} className="font-mono text-[0.6rem] text-muted-foreground pl-2 border-l border-orange-500/30">
                    {c}
                  </li>
                ))}
              </ul>
            )}
            {step.prompt && (
              <div className="space-y-1">
                <p className="font-mono text-[0.55rem] text-orange-400/70">
                  {isWordPress ? "Instrucciones:" : "Prompt para la terminal:"}
                </p>
                <div className="bg-zinc-950 rounded px-2.5 py-2 relative group/prompt">
                  <pre className="font-mono text-[0.6rem] text-zinc-300 whitespace-pre-wrap leading-relaxed">{step.prompt}</pre>
                  <button
                    onClick={() => navigator.clipboard.writeText(step.prompt!)}
                    className="absolute top-1 right-1 opacity-0 group-hover/prompt:opacity-100 transition-opacity font-mono text-[0.5rem] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded hover:text-zinc-200"
                  >
                    Copiar
                  </button>
                </div>
              </div>
            )}
            <p className="font-mono text-[0.55rem] text-muted-foreground/60">
              {isWordPress
                ? step.prompt
                  ? "Sigue las instrucciones. Cuando termines en WordPress Admin, marca como hecho."
                  : "Haz el cambio en WordPress Admin. Cuando termines, marca como hecho."
                : step.prompt
                ? "Copia el prompt y pégalo en la terminal. Cuando termines, marca como hecho."
                : "Usa la terminal para hacer los cambios, o trabaja fuera y marca como hecho."}
            </p>
          </div>
        )}

        {/* Acceptance criteria for non-human or completed steps */}
        {!(step.type === "HUMAN" && isHumanPending) && step.acceptanceCriteria.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {step.acceptanceCriteria.map((c, i) => (
              <li key={i} className="font-mono text-[0.6rem] text-muted-foreground/70 pl-2 border-l border-border">
                {c}
              </li>
            ))}
          </ul>
        )}

        {/* Content package block — shown when AI content_package step is DONE */}
        {step.status === "DONE" &&
          (step.stagedChange as { type?: string } | null)?.type === "content_package" && (
          <ContentPackageBlock pkg={step.stagedChange as ContentPackage} />
        )}

        {/* Keyword research table — shown when keyword_research step is DONE */}
        {step.status === "DONE" &&
          (step.stagedChange as { type?: string } | null)?.type === "keyword_research" && (
          <KeywordResearchTable data={step.stagedChange as KeywordResearchStaged} />
        )}

        {/* Step result (from AI step runs) — expandable */}
        {stepResult && step.status === "DONE" &&
          (step.stagedChange as { type?: string } | null)?.type !== "content_package" && (
          <details className="mt-2 group/result">
            <summary className="font-mono text-[0.6rem] text-ds-blue cursor-pointer hover:underline flex items-center gap-1">
              <ChevronRight className="h-2.5 w-2.5 group-open/result:rotate-90 transition-transform" />
              Ver resultado del agente
            </summary>
            <div className="mt-1 bg-muted/20 rounded px-3 py-2 max-h-[300px] overflow-y-auto">
              <pre className="font-mono text-[0.6rem] text-muted-foreground whitespace-pre-wrap leading-relaxed">{stepResult}</pre>
            </div>
          </details>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <span className={cn("font-mono text-[0.6rem]", statusCfg.color)}>
          {statusCfg.label}
        </span>

        {isHumanPending && (
          <button
            onClick={() => onComplete(step.id)}
            disabled={isCompleting}
            className={cn(
              buttonVariants({ variant: "default", size: "sm" }),
              "h-6 text-[0.6rem] px-2 gap-1"
            )}
          >
            {isCompleting ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <><CheckCircle2 className="h-2.5 w-2.5" /> Hecho</>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Keyword Research Table ──────────────────────────────────────────────────

interface KeywordResearchStaged {
  type: "keyword_research";
  rows: Array<{
    keyword: string;
    category: string;
    searchVolume: number | null;
    keywordDifficulty: number | null;
    cpc: number | null;
    intent: string | null;
    gscClicks: number;
    gscImpressions: number;
    gscPosition: number | null;
    targetUrl: string | null;
    priority: number;
  }>;
  criteria: { total: number };
  costUsd: number;
}

function KeywordResearchTable({ data }: { data: KeywordResearchStaged }) {
  const sorted = [...data.rows].sort((a, b) => a.priority - b.priority);
  return (
    <div className="mt-2 border border-border rounded overflow-hidden">
      <div className="px-3 py-2 bg-muted/20 flex items-center justify-between">
        <span className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
          Keywords seleccionadas ({data.rows.length}/{data.criteria.total})
        </span>
        <span className="font-mono text-[0.55rem] text-muted-foreground">
          ${data.costUsd.toFixed(4)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[0.65rem] font-mono">
          <thead>
            <tr className="border-b border-border bg-muted/10">
              <th className="px-2 py-1.5 text-left text-muted-foreground">P</th>
              <th className="px-2 py-1.5 text-left text-muted-foreground">Keyword</th>
              <th className="px-2 py-1.5 text-left text-muted-foreground">Cat.</th>
              <th className="px-2 py-1.5 text-right text-muted-foreground">Vol</th>
              <th className="px-2 py-1.5 text-right text-muted-foreground">KD</th>
              <th className="px-2 py-1.5 text-right text-muted-foreground">GSC</th>
              <th className="px-2 py-1.5 text-left text-muted-foreground">URL</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-muted/10">
                <td className="px-2 py-1 text-muted-foreground">{row.priority}</td>
                <td className="px-2 py-1 font-medium text-foreground">{row.keyword}</td>
                <td className="px-2 py-1 text-muted-foreground">{row.category}</td>
                <td className="px-2 py-1 text-right">{row.searchVolume?.toLocaleString() ?? "—"}</td>
                <td className="px-2 py-1 text-right">
                  <span className={
                    (row.keywordDifficulty ?? 100) <= 30 ? "text-emerald-500" :
                    (row.keywordDifficulty ?? 100) <= 60 ? "text-yellow-500" : "text-destructive"
                  }>
                    {row.keywordDifficulty ?? "—"}
                  </span>
                </td>
                <td className="px-2 py-1 text-right text-muted-foreground">
                  {row.gscClicks > 0 ? `${row.gscClicks}c/${row.gscImpressions}i` : "—"}
                </td>
                <td className="px-2 py-1 text-muted-foreground truncate max-w-[200px]">
                  {row.targetUrl ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Next.js Blog Publish Block ─────────────────────────────────────────────

function NextjsBlogPublishBlock({ task }: { task: PlanTaskFullView }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const blogStep = task.steps.find(
    (s) => (s.stagedChange as { type?: string } | null)?.type === "nextjs_blog"
  );
  if (!blogStep) return null;

  const staged = blogStep.stagedChange as {
    type: "nextjs_blog";
    titulo: string;
    slug: string;
    categoria: string;
    tags: string[];
    extracto: string;
    cuerpo: string;
    autor: string;
  };

  const handlePublish = () => {
    setError(null);
    startTransition(async () => {
      const result = await actionPublishNextjsBlog(task.id);
      if (!result.ok) {
        setError(result.error);
      } else {
        setSuccess(`Publicado: ${result.url} (sha: ${result.sha.slice(0, 7)})`);
      }
    });
  };

  return (
    <div className="border-t border-border">
      <div className="px-4 py-3 bg-emerald-500/5">
        <p className="font-mono text-[0.6rem] uppercase tracking-wider text-emerald-600 mb-2">
          Artículo listo para publicar
        </p>
        <div className="space-y-1 mb-3">
          <p className="text-sm font-semibold">{staged.titulo}</p>
          <p className="font-mono text-[0.65rem] text-muted-foreground">
            /blog/{staged.slug} · {staged.categoria} · {staged.autor}
          </p>
          {staged.tags.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {staged.tags.map((tag) => (
                <span key={tag} className="font-mono text-[0.55rem] px-1.5 py-0.5 bg-muted rounded">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <p className="text-[0.7rem] text-muted-foreground mt-1">{staged.extracto}</p>
          <details className="mt-2">
            <summary className="font-mono text-[0.6rem] text-ds-blue cursor-pointer hover:underline">
              Ver cuerpo del artículo ({staged.cuerpo.length} chars)
            </summary>
            <pre className="mt-1 text-[0.65rem] text-muted-foreground whitespace-pre-wrap max-h-60 overflow-y-auto bg-muted/30 p-2 rounded">
              {staged.cuerpo}
            </pre>
          </details>
        </div>

        {error && (
          <p className="font-mono text-[0.65rem] text-destructive mb-2">{error}</p>
        )}
        {success && (
          <p className="font-mono text-[0.65rem] text-emerald-600 mb-2">{success}</p>
        )}

        {!success && (
          <button
            onClick={handlePublish}
            disabled={isPending}
            className={cn(buttonVariants({ variant: "default", size: "sm" }), "gap-1.5")}
          >
            {isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <><Send className="h-3 w-3" /> Publicar en main</>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Task Card ──────────────────────────────────────────────────────────────

function TaskCard({
  task,
  planPreviewUrl,
  isWordPress,
  onExecute,
  onVoid,
  onRetry,
  onRedo,
  onCompleteStep,
  isActing,
}: {
  task: PlanTaskFullView;
  planPreviewUrl?: string | null;
  isWordPress?: boolean;
  onExecute: (taskId: string) => void;
  onVoid: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  onRedo: (taskId: string) => void;
  onCompleteStep: (stepId: string) => void;
  isActing: boolean;
}) {
  const [open, setOpen] = useState(
    task.status === "RUNNING" || task.status === "WAITING_HUMAN"
  );
  const [showContentPreview, setShowContentPreview] = useState(false);
  const statusCfg = TASK_STATUS[task.status] ?? TASK_STATUS.PLANNING;
  const StatusIcon = statusCfg.icon;
  const badge = MODE_BADGE[task.mode] ?? MODE_BADGE.HUMAN;
  const BadgeIcon = badge.icon;
  const KindIcon = KIND_ICON[task.kind] ?? Code;
  const progress = taskProgress(task);
  const isVoided = task.status === "VOIDED";

  return (
    <div
      className={cn(
        "bg-card rounded-xl border overflow-hidden transition-colors",
        task.status === "RUNNING" ? "border-ds-blue/40" :
        task.status === "DONE" ? "border-emerald-500/30" :
        task.status === "FAILED" ? "border-destructive/30" :
        task.status === "VOIDED" ? "border-border opacity-60" :
        "border-border"
      )}
    >
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left flex items-center gap-3 p-4 hover:bg-muted/20 transition-colors"
      >
        <StatusIcon
          className={cn(
            "h-4 w-4 shrink-0",
            statusCfg.color,
            (task.status === "PLANNING" || task.status === "RUNNING") && "animate-spin"
          )}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground leading-snug">
              {task.title}
            </span>
            <span className={cn("font-mono text-[0.6rem] uppercase px-1.5 py-0.5 rounded border flex items-center gap-0.5", badge.color)}>
              <BadgeIcon className="h-2.5 w-2.5" />
              {badge.label}
              {task.modeReason && (
                <span title={task.modeReason} className="cursor-help leading-none">
                  <Info className="h-2.5 w-2.5 opacity-60" />
                </span>
              )}
            </span>
            <span className="font-mono text-[0.6rem] text-muted-foreground border border-border rounded px-1.5 py-0.5 flex items-center gap-0.5">
              <KindIcon className="h-2.5 w-2.5" />
              {task.kind}
            </span>
            <span className="font-mono text-[0.6rem] text-muted-foreground">
              P{task.priority} · {EFFORT_LABEL[task.effort] ?? task.effort}
            </span>
          </div>
          {task.steps.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <ProgressBar percent={progress} size="sm" />
              <span className="font-mono text-[0.6rem] text-muted-foreground shrink-0">
                {progress}%
              </span>
            </div>
          )}
        </div>

        <span className={cn("font-mono text-[0.65rem] shrink-0", statusCfg.color)}>
          {statusCfg.label}
        </span>

        {task.steps.length > 0 && (
          open
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      {open && (
        <div className="border-t border-border">
          {/* Objective */}
          <div className="px-4 py-3 bg-muted/10">
            <p className="font-mono text-[0.65rem] text-muted-foreground leading-relaxed">
              {task.objective}
            </p>
          </div>

          {/* Steps */}
          {task.steps.length > 0 && (
            <div className="px-2 py-2 space-y-0.5">
              <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground/60 px-2 pb-1">
                Pasos ({task.steps.filter((s) => s.status === "DONE").length}/{task.steps.length})
              </p>
              {(() => {
                const firstPendingIdx = task.steps.findIndex(
                  (s) => s.status !== "DONE" && s.status !== "SKIPPED"
                );
                return task.steps.map((step, idx) => {
                  const stepRun = task.runs.find((r) => r.stepId === step.id && r.status === "SUCCEEDED");
                  return (
                    <StepRow
                      key={step.id}
                      step={step}
                      stepResult={stepRun?.logTail ?? null}
                      onComplete={onCompleteStep}
                      isCompleting={isActing}
                      isWordPress={isWordPress}
                      isActionable={idx === firstPendingIdx}
                    />
                  );
                });
              })()}
            </div>
          )}

          {/* Failure reason */}
          {task.failureReason && (
            <div className="px-4 py-2 bg-destructive/5 border-t border-destructive/20">
              <p className="font-mono text-[0.65rem] text-destructive">
                Error: {task.failureReason}
              </p>
            </div>
          )}

          {/* Void reason */}
          {task.voidReason && (
            <div className="px-4 py-2 bg-muted/10 border-t border-border">
              <p className="font-mono text-[0.65rem] text-muted-foreground">
                Anulado: {task.voidReason}
              </p>
            </div>
          )}

          {/* DONE — Ver en sitio + Ver contenido */}
          {task.status === "DONE" && (() => {
            const routes = Array.from(new Set(task.runs.flatMap((r) => r.changedRoutes)));
            const isContent = task.kind === "CONTENT";
            if (routes.length === 0 && !isContent) return null;
            return (
              <div className="px-4 py-3 border-t border-border flex items-center gap-2 flex-wrap">
                {routes.length > 0 && routes.map((route) => (
                  planPreviewUrl ? (
                    <a
                      key={route}
                      href={`${planPreviewUrl.replace(/\/$/, "")}${route}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "gap-1.5")}
                    >
                      <ExternalLink className="h-3 w-3" /> Ver en sitio
                    </a>
                  ) : (
                    <span key={route} className="font-mono text-[0.65rem] text-muted-foreground">{route} (sin preview)</span>
                  )
                ))}
                {isContent && (
                  <button
                    onClick={() => setShowContentPreview(true)}
                    className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "gap-1.5")}
                  >
                    <WrapText className="h-3 w-3" /> Ver contenido
                  </button>
                )}
              </div>
            );
          })()}

          {/* Last run info */}
          {task.runs.length > 0 && (
            <div className="px-4 py-2 bg-muted/5 border-t border-border">
              {task.runs.slice(0, 1).map((run) => (
                <div key={run.id} className="flex items-center gap-3 font-mono text-[0.6rem] text-muted-foreground">
                  <span>Run: {run.status}</span>
                  {run.costUsd != null && <span>${run.costUsd.toFixed(4)}</span>}
                  {run.buildPassed != null && (
                    <span className={run.buildPassed ? "text-emerald-500" : "text-destructive"}>
                      Build: {run.buildPassed ? "OK" : "FAIL"}
                    </span>
                  )}
                  {run.changedRoutes.length > 0 && (
                    <span className="flex items-center gap-1 flex-wrap">
                      {run.changedRoutes.map((route) =>
                        planPreviewUrl ? (
                          <a
                            key={route}
                            href={`${planPreviewUrl.replace(/\/$/, "")}${route}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-500 hover:underline flex items-center gap-0.5"
                          >
                            <ExternalLink className="h-2.5 w-2.5" />{route}
                          </a>
                        ) : (
                          <span key={route}>{route}</span>
                        )
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Next.js blog preview + publish */}
          {task.status === "WAITING_HUMAN" &&
            task.steps.some((s) => (s.stagedChange as { type?: string } | null)?.type === "nextjs_blog") && (
            <NextjsBlogPublishBlock task={task} />
          )}

          {/* Actions */}
          {!isVoided && task.status !== "RUNNING" && (
            <div className="px-4 py-3 border-t border-border flex items-center gap-2 flex-wrap">
              {(task.status === "READY" || task.status === "WAITING_HUMAN") &&
                task.steps.some((s) => s.type === "AI" && (s.status === "PENDING" || s.status === "WAITING_HUMAN")) &&
                (() => {
                  // Only show if the FIRST pending step is AI
                  const firstPending = task.steps.find((s) => s.status !== "DONE" && s.status !== "SKIPPED");
                  return firstPending?.type === "AI";
                })() && (
                <button
                  onClick={() => onExecute(task.id)}
                  disabled={isActing}
                  className={cn(buttonVariants({ variant: "default", size: "sm" }), "gap-1.5")}
                >
                  {isActing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <><Play className="h-3 w-3" /> Ejecutar</>
                  )}
                </button>
              )}

              {/* Reintentar desde el paso fallido — mantiene pasos DONE */}
              {(task.status === "FAILED" || task.status === "WAITING_HUMAN" || task.status === "PLANNING") && (
                <button
                  onClick={() => onRetry(task.id)}
                  disabled={isActing}
                  className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "gap-1.5")}
                  title="Continúa desde el paso donde falló, conservando los pasos ya completados"
                >
                  <RotateCcw className="h-3 w-3" /> Reintentar
                </button>
              )}

              {/* Rehacer — reset completo: borra pasos y runs, vuelve a descomponer */}
              {(task.status === "FAILED" || task.status === "DONE" || task.status === "WAITING_HUMAN") && (
                <button
                  onClick={() => onRedo(task.id)}
                  disabled={isActing}
                  className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "gap-1.5")}
                  title="Reinicio completo: borra todos los pasos y empieza desde cero"
                >
                  <RefreshCw className="h-3 w-3" /> Rehacer
                </button>
              )}

              {task.status !== "PLANNING" && (
                <button
                  onClick={() => onVoid(task.id)}
                  disabled={isActing}
                  className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "gap-1.5 text-muted-foreground")}
                >
                  <Ban className="h-3 w-3" /> Anular
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {showContentPreview && (
        <ContentPreviewModal
          taskId={task.id}
          taskTitle={task.title}
          planPreviewUrl={planPreviewUrl ?? null}
          onClose={() => setShowContentPreview(false)}
        />
      )}
    </div>
  );
}

// ─── Task Group ─────────────────────────────────────────────────────────────

function TaskGroup({
  mode,
  tasks,
  planPreviewUrl,
  isWordPress,
  onExecute,
  onVoid,
  onRetry,
  onRedo,
  onCompleteStep,
  isActing,
}: {
  mode: string;
  tasks: PlanTaskFullView[];
  planPreviewUrl?: string | null;
  isWordPress?: boolean;
  onExecute: (taskId: string) => void;
  onVoid: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  onRedo: (taskId: string) => void;
  onCompleteStep: (stepId: string) => void;
  isActing: boolean;
}) {
  const badge = MODE_BADGE[mode] ?? MODE_BADGE.HUMAN;
  const done = tasks.filter((t) => t.status === "DONE").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className={cn("font-mono text-[0.7rem] uppercase tracking-wider px-2 py-0.5 rounded border", badge.color)}>
          {badge.label}
        </span>
        <span className="font-mono text-[0.65rem] text-muted-foreground">
          {done}/{tasks.length} completadas
        </span>
      </div>
      <div className="space-y-2">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            planPreviewUrl={planPreviewUrl}
            isWordPress={isWordPress}
            onExecute={onExecute}
            onVoid={onVoid}
            onRetry={onRetry}
            onRedo={onRedo}
            onCompleteStep={onCompleteStep}
            isActing={isActing}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Plan Status Banner ─────────────────────────────────────────────────────

function PlanStatusBanner({
  plan,
  onActivate,
  onWatchdog,
  onSubmitReview,
  onMerge,
  isActing,
}: {
  plan: PlanFullView;
  onActivate: () => void;
  onWatchdog: () => void;
  onSubmitReview: () => void;
  onMerge: () => void;
  isActing: boolean;
}) {
  if (plan.status === "PLANNING") {
    const allReady = plan.tasks.every((t) => t.status !== "PLANNING");
    const hasFailed = plan.tasks.some((t) => t.status === "FAILED");
    const planningCount = plan.tasks.filter((t) => t.status === "PLANNING").length;
    return (
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Plan en preparacion</p>
          <p className="font-mono text-[0.65rem] text-muted-foreground mt-0.5">
            {allReady && !hasFailed
              ? "Todas las tareas tienen pasos generados. Activa el plan para comenzar a ejecutar."
              : hasFailed
              ? "Algunas tareas fallaron al generar pasos. Reintenta o anula las fallidas."
              : `${planningCount} tarea(s) generando pasos. Espera o ejecuta el watchdog si llevan mas de 10 min.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {planningCount > 0 && (
            <button onClick={onWatchdog} disabled={isActing}
              className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "gap-1.5")}>
              <RotateCcw className="h-3 w-3" /> Watchdog
            </button>
          )}
          {allReady && !hasFailed && (
            <button onClick={onActivate} disabled={isActing}
              className={cn(buttonVariants({ variant: "default", size: "sm" }), "gap-1.5")}>
              {isActing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              Activar plan
            </button>
          )}
        </div>
      </div>
    );
  }

  const allTerminal = plan.tasks.every((t) => ["DONE", "VOIDED", "FAILED"].includes(t.status));
  const remaining = plan.tasks.filter((t) => !["DONE", "VOIDED", "FAILED"].includes(t.status)).length;

  // ACTIVE + not done yet — show progress hint
  if (plan.status === "ACTIVE" && !allTerminal) {
    const doneTasks = plan.tasks.filter((t) => t.status === "DONE");
    const missingPreview = !plan.previewUrl && doneTasks.some((t) =>
      t.runs.some((r) => r.changedRoutes.length > 0)
    );
    return (
      <div className="space-y-2">
        <div className="bg-muted/20 border border-border rounded-xl px-4 py-3">
          <p className="font-mono text-[0.65rem] text-muted-foreground">
            {remaining} tarea{remaining !== 1 ? "s" : ""} restante{remaining !== 1 ? "s" : ""} para Pasar a revisión
          </p>
        </div>
        {missingPreview && (
          <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-4 py-2 flex items-center gap-2">
            <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />
            <p className="font-mono text-[0.6rem] text-muted-foreground">
              Sin preview URL — el worker no recibió la URL de Vercel. Verifica que VERCEL_TOKEN esté configurado en el worker.
            </p>
          </div>
        )}
      </div>
    );
  }

  if (plan.status === "ACTIVE" && allTerminal) {
    // Soft check: code/design tasks without changed routes
    const codeWithoutPreview = plan.tasks.filter(
      (t) => t.status === "DONE" && (t.kind === "CODE") && t.runs.every((r) => r.changedRoutes.length === 0)
    );
    return (
      <div className="space-y-2">
        {codeWithoutPreview.length > 0 && (
          <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-4 py-2 flex items-center gap-2">
            <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />
            <p className="font-mono text-[0.6rem] text-muted-foreground">
              {codeWithoutPreview.length} tarea{codeWithoutPreview.length !== 1 ? "s" : ""} de código sin rutas de preview registradas. Verifica antes de hacer merge.
            </p>
          </div>
        )}
        {!plan.previewUrl && (
          <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-4 py-2 flex items-center gap-2">
            <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />
            <p className="font-mono text-[0.6rem] text-muted-foreground">
              Sin preview URL — verifica que VERCEL_TOKEN esté configurado en el worker.
            </p>
          </div>
        )}
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Plan al 100%</p>
            <p className="font-mono text-[0.65rem] text-muted-foreground mt-0.5">
              Todas las tareas terminadas. Pasa a revision para ver el preview y hacer merge.
            </p>
          </div>
          <button onClick={onSubmitReview} disabled={isActing}
            className={cn(buttonVariants({ variant: "default", size: "sm" }), "gap-1.5")}>
            {isActing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Pasar a revision
          </button>
        </div>
      </div>
    );
  }

  if (plan.status === "IN_REVIEW") {
    return (
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Eye className="h-4 w-4 text-blue-500" /> En revision
            </p>
            <p className="font-mono text-[0.65rem] text-muted-foreground mt-0.5">
              Revisa el preview y haz merge cuando estes listo.
            </p>
          </div>
          <button onClick={onMerge} disabled={isActing}
            className={cn(buttonVariants({ variant: "default", size: "sm" }), "gap-1.5")}>
            {isActing ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitMerge className="h-3 w-3" />}
            Merge a produccion
          </button>
        </div>
        <div className="flex items-center gap-4 font-mono text-[0.6rem]">
          {plan.prUrl && (
            <a href={plan.prUrl} target="_blank" rel="noopener noreferrer"
              className="text-blue-500 hover:underline flex items-center gap-1">
              <ExternalLink className="h-2.5 w-2.5" /> PR #{plan.prNumber}
            </a>
          )}
          {plan.previewUrl && (
            <a href={plan.previewUrl} target="_blank" rel="noopener noreferrer"
              className="text-emerald-500 hover:underline flex items-center gap-1">
              <ExternalLink className="h-2.5 w-2.5" /> Preview
            </a>
          )}
        </div>
      </div>
    );
  }

  if (plan.status === "PUBLISHED") {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
        <p className="text-sm font-semibold text-emerald-600 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> Plan publicado
        </p>
        <p className="font-mono text-[0.65rem] text-muted-foreground mt-0.5">
          Merge completado{plan.mergedAt ? ` el ${new Date(plan.mergedAt).toLocaleDateString("es-MX")}` : ""}.
        </p>
      </div>
    );
  }

  if (plan.status === "ARCHIVED") {
    return (
      <div className="bg-muted/40 border border-border rounded-xl p-4">
        <p className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
          <Archive className="h-4 w-4" /> Plan archivado
        </p>
        <p className="font-mono text-[0.65rem] text-muted-foreground mt-0.5">
          Este plan fue archivado para auditoría. Puedes rehacer tareas individuales si es necesario.
        </p>
      </div>
    );
  }

  return null;
}

// ─── Empty State ────────────────────────────────────────────────────────────

function EmptyState({ clientId }: { clientId: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
        <Terminal className="h-8 w-8 text-muted-foreground/40" />
      </div>
      <p className="text-sm font-semibold text-foreground mb-1">Sin plan mensual</p>
      <p className="font-mono text-[0.65rem] text-muted-foreground max-w-sm">
        Ejecuta un Analisis Claude para generar candidatas y enviarlas al plan del mes.
      </p>
      <a
        href={`/clientes/${clientId}/analisis`}
        className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "mt-4")}
      >
        Ir a Analisis Claude
      </a>
    </div>
  );
}

// ─── Main Panel ─────────────────────────────────────────────────────────────

interface Props {
  clientId: string;
  initialPlan: PlanFullView | null;
  initialMonths: PlanMonthOption[];
}

export function PlanMensualPanel({ clientId, initialPlan, initialMonths }: Props) {
  const [plan, setPlan] = useState<PlanFullView | null>(initialPlan);
  const [months, setMonths] = useState<PlanMonthOption[]>(initialMonths);
  const [selectedMonth, setSelectedMonth] = useState(initialPlan?.month ?? initialMonths[0]?.month ?? "");
  const [isActing, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mergeWarnings, setMergeWarnings] = useState<string[]>([]);

  // Refresh data
  const refresh = useCallback(async (month?: string) => {
    const data = await getPlanData(clientId, month ?? selectedMonth);
    setPlan(data.plan);
    setMonths(data.months);
  }, [clientId, selectedMonth]);

  // Polling every 15s when there's active work
  useEffect(() => {
    if (!plan || !hasActiveWork(plan.tasks)) return;
    const interval = setInterval(() => refresh(), 15_000);
    return () => clearInterval(interval);
  }, [plan, refresh]);

  function handleMonthChange(month: string) {
    setSelectedMonth(month);
    startTransition(async () => {
      await refresh(month);
    });
  }

  function handleAction(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok && "error" in result) {
        setError(result.error ?? "Error desconocido");
      }
      await refresh();
    });
  }

  function handleExecute(taskId: string) {
    handleAction(() => actionExecuteTask(taskId));
  }

  function handleVoid(taskId: string) {
    const reason = prompt("Razon para anular esta tarea:");
    if (!reason) return;
    handleAction(() => actionVoidTask(taskId, reason));
  }

  function handleRetry(taskId: string) {
    handleAction(() => actionResetTask(taskId, "resume"));
  }

  function handleRedo(taskId: string) {
    if (!confirm("¿Rehacer la tarea desde cero? Se borrarán todos los pasos y ejecuciones anteriores.")) return;
    handleAction(() => actionResetTask(taskId, "redo"));
  }

  function handleArchive() {
    if (!plan) return;
    if (!confirm("¿Archivar este plan? Se conserva para auditoría pero no se puede ejecutar más.")) return;
    handleAction(() => actionArchivePlan(plan.id));
  }

  function handleCompleteStep(stepId: string) {
    handleAction(() => actionCompleteHumanStep(stepId));
  }

  function handleActivate() {
    if (!plan) return;
    handleAction(() => actionActivatePlan(plan.id));
  }

  function handleWatchdog() {
    if (!plan) return;
    handleAction(() => actionRunWatchdog(plan.id));
  }

  function handleSubmitReview() {
    if (!plan) return;
    handleAction(() => actionSubmitForReview(plan.id));
  }

  function handleMerge() {
    if (!plan) return;
    if (!confirm("¿Merge a producción? Esta acción no se puede deshacer.")) return;
    setError(null);
    setMergeWarnings([]);
    startTransition(async () => {
      const result = await actionMergePlan(plan.id);
      if (!result.ok) {
        setError(result.error ?? "Error desconocido");
      } else if (result.warnings.length > 0) {
        setMergeWarnings(result.warnings);
      }
      await refresh();
    });
  }

  // Group tasks by mode
  const grouped = plan
    ? (["AI", "HYBRID", "HUMAN"] as const)
        .map((mode) => ({
          mode,
          tasks: plan.tasks.filter((t) => t.mode === mode),
        }))
        .filter((g) => g.tasks.length > 0)
    : [];

  const isWordPress = plan?.platform === "WORDPRESS" || plan?.platform === "MIGRACION";

  const progress = plan ? planProgress(plan.tasks) : 0;

  return (
    <div className="flex gap-6">
      {/* Left column — main content */}
      <div className="flex-1 min-w-0 space-y-6">
        {/* Controls */}
        <div className="flex items-center justify-between gap-4">
          <MonthSelector
            months={months}
            selected={selectedMonth}
            onSelect={handleMonthChange}
          />
          <div className="flex items-center gap-2">
            {plan && hasActiveWork(plan.tasks) && (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-ds-blue" />
                <span className="font-mono text-[0.6rem] text-ds-blue">En vivo</span>
              </>
            )}
            {plan && !["PUBLISHED", "ARCHIVED"].includes(plan.status) && (
              <button
                onClick={handleArchive}
                disabled={isActing}
                className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "gap-1.5 text-muted-foreground")}
                title="Archivar plan (conserva datos para auditoría)"
              >
                <Archive className="h-3 w-3" /> Archivar
              </button>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}

        {/* Merge warnings (Vercel preflight) */}
        {mergeWarnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 space-y-1">
            <p className="text-xs font-semibold text-amber-800">⚠️ Advertencias post-merge</p>
            {mergeWarnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-700">{w}</p>
            ))}
          </div>
        )}

        {!plan ? (
          <EmptyState clientId={clientId} />
        ) : (
          <>
            {/* Overall progress */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-wider">
                  Progreso del plan
                </span>
                <span className="font-mono text-sm font-bold text-foreground">
                  {progress}%
                </span>
              </div>
              <ProgressBar percent={progress} />
              <div className="flex items-center gap-4 font-mono text-[0.6rem] text-muted-foreground flex-wrap">
                <span>{plan.tasks.length} tareas</span>
                <span>{plan.tasks.filter((t) => t.status === "DONE").length} completadas</span>
                <span>{plan.tasks.filter((t) => t.status === "FAILED").length} fallidas</span>
                <span>{plan.tasks.filter((t) => t.status === "VOIDED").length} anuladas</span>
                {plan.totalCostUsd > 0 && (
                  <span className="flex items-center gap-0.5">
                    <DollarSign className="h-2.5 w-2.5" />
                    {plan.totalCostUsd.toFixed(4)} USD
                  </span>
                )}
                {plan.prUrl && (
                  <a href={plan.prUrl} target="_blank" rel="noopener noreferrer"
                    className="text-blue-500 hover:underline flex items-center gap-0.5">
                    <ExternalLink className="h-2.5 w-2.5" /> PR #{plan.prNumber}
                  </a>
                )}
                {plan.previewUrl && (
                  <a href={plan.previewUrl} target="_blank" rel="noopener noreferrer"
                    className="text-emerald-500 hover:underline flex items-center gap-0.5">
                    <ExternalLink className="h-2.5 w-2.5" /> Preview
                  </a>
                )}
              </div>
            </div>

            {/* Plan status banner */}
            <PlanStatusBanner plan={plan} onActivate={handleActivate} onWatchdog={handleWatchdog} onSubmitReview={handleSubmitReview} onMerge={handleMerge} isActing={isActing} />

            {/* Task groups */}
            <div className="space-y-8">
              {grouped.map((g) => (
                <TaskGroup
                  key={g.mode}
                  mode={g.mode}
                  tasks={g.tasks}
                  planPreviewUrl={plan.previewUrl}
                  isWordPress={isWordPress}
                  onExecute={handleExecute}
                  onVoid={handleVoid}
                  onRetry={handleRetry}
                  onRedo={handleRedo}
                  onCompleteStep={handleCompleteStep}
                  isActing={isActing}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Right column — Terminal */}
      <div className="hidden xl:flex w-96 shrink-0 flex-col">
        <TerminalPanel
          planId={plan?.id ?? ""}
          taskId={null}
          isAdmin={true}
          planLocked={plan ? hasActiveWork(plan.tasks) : false}
        />
      </div>
    </div>
  );
}
