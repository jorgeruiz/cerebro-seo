"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star, Trash2, Plus, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";
import {
  actionCreateKeyword,
  actionToggleKeywordPriority,
  actionDeleteKeyword,
  actionBulkCreateKeywords,
} from "./actions";

interface Keyword {
  id: string;
  term: string;
  country: string;
  language: string;
  isPriority: boolean;
  createdAt: Date;
}

interface Props {
  clientId: string;
  keywords: Keyword[];
}

const COUNTRIES = ["MX", "US", "ES", "CO", "AR"] as const;
const LANGUAGES = ["es", "en"] as const;

export function KeywordsManager({ clientId, keywords: initialKeywords }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Local state for optimistic updates
  const [keywords, setKeywords] = useState<Keyword[]>(initialKeywords);

  // Add single keyword form
  const [addTerm, setAddTerm] = useState("");
  const [addCountry, setAddCountry] = useState<string>("MX");
  const [addLanguage, setAddLanguage] = useState<string>("es");
  const [addPriority, setAddPriority] = useState(false);
  const [addError, setAddError] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  // Bulk add
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkCountry, setBulkCountry] = useState<string>("MX");
  const [bulkLanguage, setBulkLanguage] = useState<string>("es");
  const [bulkPriority, setBulkPriority] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [bulkSuccess, setBulkSuccess] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);

  const priorityCount = keywords.filter((k) => k.isPriority).length;

  // Sorted: priority first, then createdAt desc
  const sorted = [...keywords].sort((a, b) => {
    if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
    return +new Date(b.createdAt) - +new Date(a.createdAt);
  });

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addTerm.trim()) return;
    setAddError("");
    setAddLoading(true);
    const res = await actionCreateKeyword({
      clientId,
      term: addTerm.trim(),
      country: addCountry,
      language: addLanguage,
      isPriority: addPriority,
    });
    setAddLoading(false);
    if (res.error) {
      setAddError(res.error);
      return;
    }
    setAddTerm("");
    setAddPriority(false);
    startTransition(() => router.refresh());
    // Optimistic: add placeholder (will be replaced by router.refresh)
    setKeywords((prev) => [
      ...prev,
      {
        id: `tmp-${Date.now()}`,
        term: addTerm.trim().toLowerCase(),
        country: addCountry,
        language: addLanguage,
        isPriority: addPriority,
        createdAt: new Date(),
      },
    ]);
  }

  async function handleTogglePriority(keyword: Keyword) {
    // Optimistic
    setKeywords((prev) =>
      prev.map((k) => (k.id === keyword.id ? { ...k, isPriority: !k.isPriority } : k))
    );
    const res = await actionToggleKeywordPriority({ keywordId: keyword.id, clientId });
    if (res.error) {
      // Revert
      setKeywords((prev) =>
        prev.map((k) => (k.id === keyword.id ? { ...k, isPriority: keyword.isPriority } : k))
      );
      alert(res.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  async function handleDelete(keyword: Keyword) {
    // Optimistic
    setKeywords((prev) => prev.filter((k) => k.id !== keyword.id));
    const res = await actionDeleteKeyword({ keywordId: keyword.id, clientId });
    if (res.error) {
      // Revert
      setKeywords((prev) => [...prev, keyword]);
      alert(res.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  async function handleBulk(e: React.FormEvent) {
    e.preventDefault();
    setBulkError("");
    setBulkSuccess("");
    setBulkLoading(true);
    const terms = bulkText
      .split(/[\n,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const res = await actionBulkCreateKeywords({
      clientId,
      terms,
      country: bulkCountry,
      language: bulkLanguage,
      isPriority: bulkPriority,
    });
    setBulkLoading(false);
    if (res.error) {
      setBulkError(res.error);
      return;
    }
    setBulkSuccess(`${res.count} keywords agregadas`);
    setBulkText("");
    setBulkPriority(false);
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
        <span>{keywords.length} keywords activas</span>
        <span className="text-primary">{priorityCount}/10 priority</span>
      </div>

      {/* Keyword list */}
      {sorted.length > 0 && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="divide-y divide-border">
            {sorted.map((kw) => (
              <div key={kw.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors group">
                {/* Priority star */}
                <button
                  onClick={() => handleTogglePriority(kw)}
                  disabled={isPending || (!kw.isPriority && priorityCount >= 10)}
                  title={
                    !kw.isPriority && priorityCount >= 10
                      ? "Límite de 10 priority alcanzado"
                      : kw.isPriority
                      ? "Quitar prioridad"
                      : "Marcar como priority"
                  }
                  className={[
                    "shrink-0 transition-colors",
                    kw.isPriority
                      ? "text-ds-yellow"
                      : "text-muted-foreground/30 hover:text-ds-yellow group-hover:text-muted-foreground/60",
                    !kw.isPriority && priorityCount >= 10 ? "opacity-30 cursor-not-allowed" : "cursor-pointer",
                  ].join(" ")}
                >
                  <Star className="h-3.5 w-3.5" fill={kw.isPriority ? "currentColor" : "none"} />
                </button>

                {/* Term */}
                <span className="flex-1 text-sm text-foreground font-mono min-w-0 truncate">{kw.term}</span>

                {/* Country / Language pills */}
                <span className="shrink-0 text-[10px] font-mono text-muted-foreground/60 uppercase">{kw.country}</span>
                <span className="shrink-0 text-[10px] font-mono text-muted-foreground/60">{kw.language}</span>

                {/* Delete */}
                <button
                  onClick={() => handleDelete(kw)}
                  className="shrink-0 text-muted-foreground/20 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                  title="Eliminar keyword"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {sorted.length === 0 && (
        <div className="bg-card rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">Sin keywords configuradas.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Agrega keywords individuales o en lote.</p>
        </div>
      )}

      {/* Add single keyword */}
      <form onSubmit={handleAdd} className="bg-card rounded-xl border border-border p-4 space-y-3">
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Agregar keyword</p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={addTerm}
            onChange={(e) => setAddTerm(e.target.value)}
            placeholder="keyword objetivo"
            maxLength={200}
            className="flex-1 min-w-[180px] bg-background border border-border rounded-lg px-3 py-1.5 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <select
            value={addCountry}
            onChange={(e) => setAddCountry(e.target.value)}
            className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={addLanguage}
            onChange={(e) => setAddLanguage(e.target.value)}
            className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={addPriority}
              onChange={(e) => setAddPriority(e.target.checked)}
              disabled={!addPriority && priorityCount >= 10}
              className="accent-primary"
            />
            Priority
          </label>
          <button
            type="submit"
            disabled={addLoading || !addTerm.trim()}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-mono rounded-lg px-3 py-1.5 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            {addLoading ? "Guardando..." : "Agregar"}
          </button>
        </div>
        {addError && (
          <p className="flex items-center gap-1.5 text-xs font-mono text-destructive">
            <AlertCircle className="h-3 w-3 shrink-0" />
            {addError}
          </p>
        )}
      </form>

      {/* Bulk paste */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setBulkOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>Importar en lote (hasta 100)</span>
          {bulkOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {bulkOpen && (
          <form onSubmit={handleBulk} className="px-4 pb-4 space-y-3 border-t border-border pt-3">
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={"una keyword por línea\no separadas por coma"}
              rows={6}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/40 resize-y focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={bulkCountry}
                onChange={(e) => setBulkCountry(e.target.value)}
                className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select
                value={bulkLanguage}
                onChange={(e) => setBulkLanguage(e.target.value)}
                className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={bulkPriority}
                  onChange={(e) => setBulkPriority(e.target.checked)}
                  disabled={!bulkPriority && priorityCount >= 10}
                  className="accent-primary"
                />
                Priority
              </label>
              <button
                type="submit"
                disabled={bulkLoading || !bulkText.trim()}
                className="flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-mono rounded-lg px-3 py-1.5 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ml-auto"
              >
                {bulkLoading ? "Importando..." : "Importar keywords"}
              </button>
            </div>
            {bulkError && (
              <p className="flex items-center gap-1.5 text-xs font-mono text-destructive">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {bulkError}
              </p>
            )}
            {bulkSuccess && (
              <p className="text-xs font-mono text-ds-green">{bulkSuccess}</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
