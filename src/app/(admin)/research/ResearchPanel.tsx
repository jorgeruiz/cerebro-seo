"use client";

import { useState, useTransition } from "react";
import {
  Loader2,
  TrendingUp,
  Brain,
  Mic,
  Cpu,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Search,
  Globe,
  MessageSquare,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { KpiCard } from "@/components/ui-darkui";
import {
  actionResearchKeywords,
  actionResearchDomain,
  type KeywordResearchResult,
  type DomainResearchResult,
} from "./actions";
import type { AeoCluster } from "@/lib/aeo-classify";
import type { KeywordIdea } from "@/server/providers/dataforseo";

// ─── Helpers visuales (mismo estilo que keyword-ideas/page.tsx) ────────────

function kdBadge(kd: number | null) {
  if (kd == null) return "text-muted-foreground bg-muted border-border";
  if (kd <= 30) return "text-ds-green bg-ds-green/10 border-ds-green/30";
  if (kd <= 60) return "text-ds-yellow bg-ds-yellow/10 border-ds-yellow/30";
  return "text-destructive bg-destructive/10 border-destructive/30";
}

function intentBadge(intent: string | null) {
  if (!intent) return "text-muted-foreground bg-muted border-border";
  const map: Record<string, string> = {
    informational: "text-ds-blue bg-ds-blue/10 border-ds-blue/30",
    commercial:    "text-ds-yellow bg-ds-yellow/10 border-ds-yellow/30",
    transactional: "text-ds-green bg-ds-green/10 border-ds-green/30",
    navigational:  "text-muted-foreground bg-muted border-border",
  };
  return map[intent] ?? "text-muted-foreground bg-muted border-border";
}

function fmtVol(n: number | null) {
  if (n == null) return "—";
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000)  return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtCpc(n: number | null) {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

// ─── Keyword Ideas Table ───────────────────────────────────────────────────

function KeywordTable({ ideas }: { ideas: KeywordIdea[] }) {
  if (ideas.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2.5 font-mono text-[0.6rem] text-muted-foreground uppercase tracking-[0.1em]">
        <span className="text-primary">{"//"}</span>
        <span>
          Keyword ideas
          <span className="ml-2 bg-muted border border-border rounded px-1.5 py-0.5">
            {ideas.length}
          </span>
        </span>
        <span className="flex-1 h-px bg-border" />
      </div>
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="text-left px-4 py-2.5 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">Keyword</th>
              <th className="text-right px-4 py-2.5 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">Vol/mes</th>
              <th className="text-center px-4 py-2.5 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">KD</th>
              <th className="text-right px-4 py-2.5 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground hidden lg:table-cell">CPC</th>
              <th className="text-center px-4 py-2.5 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Intención</th>
            </tr>
          </thead>
          <tbody>
            {ideas.slice(0, 200).map((idea, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    {(idea.searchVolume ?? 0) >= 1000 && (
                      <TrendingUp className="h-3 w-3 text-ds-green shrink-0" />
                    )}
                    <span className="font-mono text-[0.7rem] text-foreground">{idea.keyword}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-[0.65rem] text-foreground">
                  {fmtVol(idea.searchVolume)}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {idea.keywordDifficulty != null ? (
                    <span className={`font-mono text-[0.55rem] px-1.5 py-0.5 rounded border ${kdBadge(idea.keywordDifficulty)}`}>
                      {idea.keywordDifficulty}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-[0.65rem] text-muted-foreground hidden lg:table-cell">
                  {fmtCpc(idea.cpc)}
                </td>
                <td className="px-4 py-2.5 text-center hidden lg:table-cell">
                  {idea.intent && (
                    <span className={`font-mono text-[0.55rem] px-1.5 py-0.5 rounded border ${intentBadge(idea.intent)}`}>
                      {idea.intent.slice(0, 4)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ideas.length > 200 && (
        <p className="font-mono text-[0.6rem] text-muted-foreground text-right">
          Mostrando 200 de {ideas.length} · ajusta las seeds para refinar
        </p>
      )}
    </section>
  );
}

// ─── AEO/GEO Cluster Card ─────────────────────────────────────────────────

function ClusterCard({ cluster, index }: { cluster: AeoCluster; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left flex items-start gap-3 p-5 hover:bg-muted/20 transition-colors"
      >
        <span className="shrink-0 font-mono text-[0.65rem] bg-muted text-muted-foreground border border-border rounded px-1.5 py-0.5 mt-0.5">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground leading-snug">{cluster.tema}</p>
          <p className="font-mono text-[0.6rem] text-muted-foreground mt-0.5">
            {cluster.preguntas.length} preguntas · {cluster.intencion}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {cluster.aeoCandidate && (
            <span className="font-mono text-[0.6rem] uppercase px-1.5 py-0.5 rounded border text-ds-blue bg-ds-blue/10 border-ds-blue/30 flex items-center gap-1">
              <Mic className="h-2.5 w-2.5" /> AEO
            </span>
          )}
          {cluster.geoCandidate && (
            <span className="font-mono text-[0.6rem] uppercase px-1.5 py-0.5 rounded border text-ds-yellow bg-ds-yellow/10 border-ds-yellow/30 flex items-center gap-1">
              <Cpu className="h-2.5 w-2.5" /> GEO
            </span>
          )}
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-1" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-1" />
          )}
        </div>
      </button>
      {open && (
        <div className="border-t border-border px-5 pb-5 pt-4 space-y-4">
          <div className="flex gap-4 flex-wrap">
            <div className="flex items-center gap-1.5">
              {cluster.aeoCandidate ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-ds-blue" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-muted-foreground/40" />
              )}
              <span className="font-mono text-[0.6rem] text-muted-foreground uppercase">Featured Snippet / PAA / Voz</span>
            </div>
            <div className="flex items-center gap-1.5">
              {cluster.geoCandidate ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-ds-yellow" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-muted-foreground/40" />
              )}
              <span className="font-mono text-[0.6rem] text-muted-foreground uppercase">ChatGPT / Gemini / Perplexity</span>
            </div>
          </div>
          <div>
            <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground mb-2">Preguntas del cluster</p>
            <ul className="space-y-1">
              {cluster.preguntas.map((q, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                  <span className="text-muted-foreground/40 font-mono shrink-0 mt-0.5">·</span>
                  {q}
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-border pt-3">
            <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground mb-1.5">Recomendación</p>
            <p className="text-xs text-foreground leading-relaxed">{cluster.recomendacion}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Keyword Research Results ─────────────────────────────────────────────

function KeywordResults({ data }: { data: KeywordResearchResult }) {
  const clusters = Array.isArray(data.aeo.clusters) ? data.aeo.clusters : [];
  const aeoCount = clusters.filter((c) => c.aeoCandidate).length;
  const geoCount = clusters.filter((c) => c.geoCandidate).length;

  return (
    <div className="space-y-6">
      {/* Meta */}
      <div className="flex items-center gap-3 font-mono text-[0.6rem] text-muted-foreground flex-wrap">
        <span>Seeds: {data.seeds.join(", ")}</span>
        {data.cost > 0 && <span>${data.cost.toFixed(4)} USD (Claude)</span>}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Ideas encontradas" value={String(data.ideas.length)} />
        <KpiCard label="Preguntas" value={String(data.questionCount)} />
        <KpiCard label="Clusters AEO" value={String(aeoCount)} valueColor="blue" />
        <KpiCard label="Clusters GEO" value={String(geoCount)} valueColor="orange" />
      </div>

      {/* AEO Resumen */}
      {data.aeo.resumen && (
        <div className="bg-card rounded-xl border border-border p-6">
          <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground mb-3">Perfil AEO/GEO</p>
          <p className="text-sm text-foreground leading-relaxed">{data.aeo.resumen}</p>
        </div>
      )}

      {/* Clusters */}
      {clusters.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2.5 font-mono text-[0.6rem] text-muted-foreground uppercase tracking-[0.1em]">
            <span className="text-primary">{"//"}</span>
            <span>Clusters AEO/GEO <span className="ml-1 bg-muted border border-border rounded px-1.5 py-0.5">{clusters.length}</span></span>
            <span className="flex-1 h-px bg-border" />
          </div>
          <div className="space-y-3">
            {clusters.map((cluster, i) => (
              <ClusterCard key={i} cluster={cluster} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* Nota estratégica */}
      {data.aeo.notaEstrategica && (
        <div className="bg-muted/30 rounded-xl border border-border p-6">
          <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground mb-3">Priorización estratégica</p>
          <p className="text-sm text-muted-foreground leading-relaxed">{data.aeo.notaEstrategica}</p>
        </div>
      )}

      {/* Keyword Ideas Table */}
      <KeywordTable ideas={data.ideas} />

      <p className="font-mono text-[0.6rem] text-muted-foreground text-right">
        DataForSEO Labs · caché 7 días · efímero (sin guardar)
      </p>
    </div>
  );
}

// ─── Domain Research Results ──────────────────────────────────────────────

function DomainResults({ data }: { data: DomainResearchResult }) {
  const { overview } = data;

  function fmtNum(n: number) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  }

  return (
    <div className="space-y-6">
      <div className="font-mono text-[0.6rem] text-muted-foreground">
        Dominio analizado: <span className="text-foreground">{data.domain}</span> · caché 7 días
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          label="Domain Rank"
          value={overview.domainRank != null ? String(overview.domainRank) : "—"}
          valueColor="default"
        />
        <KpiCard
          label="Keywords orgánicas"
          value={fmtNum(overview.rankedKeywords)}
          valueColor="blue"
        />
        <KpiCard
          label="Tráfico estimado/mes"
          value={fmtNum(overview.estimatedTraffic)}
          valueColor="green"
        />
      </div>

      <p className="font-mono text-[0.6rem] text-muted-foreground text-right">
        DataForSEO Labs Domain Rank Overview · México / Español · efímero (sin guardar)
      </p>
    </div>
  );
}

// ─── ResearchPanel ────────────────────────────────────────────────────────

type Mode = "keywords" | "domain";

export function ResearchPanel() {
  const [mode, setMode] = useState<Mode>("keywords");

  // Keyword mode state
  const [seedsInput, setSeedsInput] = useState("");
  const [country, setCountry] = useState("MX");
  const [language, setLanguage] = useState("es");
  const [kwResult, setKwResult] = useState<KeywordResearchResult | null>(null);

  // Domain mode state
  const [domainInput, setDomainInput] = useState("");
  const [domResult, setDomResult] = useState<DomainResearchResult | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const inputClass =
    "bg-card border border-border rounded-lg px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 w-full";

  function handleKeywordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setKwResult(null);
    const seeds = seedsInput.split(",").map((s) => s.trim()).filter(Boolean);
    startTransition(async () => {
      const res = await actionResearchKeywords({ seeds, country, language });
      if (res.ok) setKwResult(res.data);
      else setError(res.error);
    });
  }

  function handleDomainSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDomResult(null);
    startTransition(async () => {
      const res = await actionResearchDomain({ domain: domainInput });
      if (res.ok) setDomResult(res.data);
      else setError(res.error);
    });
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setKwResult(null);
    setDomResult(null);
  }

  return (
    <div className="space-y-6">
      {/* Mode tabs */}
      <div className="flex gap-0 border-b border-border">
        {(
          [
            { key: "keywords", label: "Por keyword", icon: Search },
            { key: "domain",   label: "Por dominio", icon: Globe },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => switchMode(key)}
            className={[
              "flex items-center gap-2 px-5 py-2.5 font-mono text-xs border-b-2 transition-colors",
              mode === key
                ? "text-foreground border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground",
            ].join(" ")}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Keyword form */}
      {mode === "keywords" && (
        <form onSubmit={handleKeywordSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="font-mono text-[0.65rem] text-muted-foreground uppercase tracking-wider">
              Keywords seed (separadas por coma, máx 5)
            </label>
            <input
              type="text"
              placeholder="agencia seo, posicionamiento web, marketing digital"
              value={seedsInput}
              onChange={(e) => setSeedsInput(e.target.value)}
              className={inputClass}
              required
            />
            <p className="font-mono text-[0.6rem] text-muted-foreground">
              El análisis buscará preguntas relacionadas y las clasificará como candidatos AEO y GEO
            </p>
          </div>
          <div className="flex gap-4 flex-wrap">
            <div className="space-y-1.5 flex-1 min-w-32">
              <label className="font-mono text-[0.65rem] text-muted-foreground uppercase tracking-wider">País</label>
              <select value={country} onChange={(e) => setCountry(e.target.value)} className={inputClass}>
                <option value="MX">México</option>
                <option value="US">Estados Unidos</option>
                <option value="ES">España</option>
                <option value="AR">Argentina</option>
                <option value="CO">Colombia</option>
              </select>
            </div>
            <div className="space-y-1.5 flex-1 min-w-32">
              <label className="font-mono text-[0.65rem] text-muted-foreground uppercase tracking-wider">Idioma</label>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className={inputClass}>
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={isPending}
            className={buttonVariants({ variant: "default", size: "sm" }) + " gap-2"}
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Analizando keywords... (30–60s)
              </>
            ) : (
              <>
                <Brain className="h-3.5 w-3.5" />
                Analizar keywords
              </>
            )}
          </button>
        </form>
      )}

      {/* Domain form */}
      {mode === "domain" && (
        <form onSubmit={handleDomainSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="font-mono text-[0.65rem] text-muted-foreground uppercase tracking-wider">
              Dominio o URL
            </label>
            <input
              type="text"
              placeholder="ejemplo.com"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              className={inputClass}
              required
            />
            <p className="font-mono text-[0.6rem] text-muted-foreground">
              DataForSEO Labs Domain Rank Overview · México / Español · caché 7 días
            </p>
          </div>
          <button
            type="submit"
            disabled={isPending}
            className={buttonVariants({ variant: "default", size: "sm" }) + " gap-2"}
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Consultando dominio...
              </>
            ) : (
              <>
                <Globe className="h-3.5 w-3.5" />
                Analizar dominio
              </>
            )}
          </button>
        </form>
      )}

      {/* Error */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
          <p className="text-sm text-destructive">Error: {error}</p>
        </div>
      )}

      {/* Loading skeleton */}
      {isPending && (
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-card rounded-xl border border-border p-4 h-20" />
            ))}
          </div>
          <div className="bg-card rounded-xl border border-border p-6 h-24" />
          <div className="bg-card rounded-xl border border-border p-5 h-16" />
          <div className="bg-card rounded-xl border border-border p-5 h-16" />
        </div>
      )}

      {/* Results */}
      {!isPending && kwResult && <KeywordResults data={kwResult} />}
      {!isPending && domResult && <DomainResults data={domResult} />}

      {/* Empty state — primer render */}
      {!isPending && !kwResult && !domResult && !error && (
        <div className="bg-card rounded-xl border border-border p-12 flex flex-col items-center gap-4 text-center">
          <MessageSquare className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="text-base font-medium text-foreground mb-1">
              {mode === "keywords"
                ? "Ingresa keywords seed para comenzar"
                : "Ingresa un dominio para analizarlo"}
            </p>
            <p className="text-sm text-muted-foreground max-w-sm">
              {mode === "keywords"
                ? "Obtén ideas de keywords, preguntas de búsqueda y clusters AEO/GEO sin necesidad de tener un cliente configurado."
                : "Consulta el Domain Rank, estimado de keywords orgánicas y tráfico de cualquier dominio."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
