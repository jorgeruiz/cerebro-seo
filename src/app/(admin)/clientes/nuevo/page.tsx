"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight, ChevronLeft, Check, Search, BarChart2,
  ChevronDown, Loader2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { listGscSites, listGa4Properties } from "../[id]/actions";
import type { GscSite, Ga4Property } from "../[id]/actions";
import { listClientsForWizard, configureClientSeo } from "./actions";
import type { WizardClient } from "./actions";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface WizardData {
  clientId: string;
  gscProperty: string;
  ga4Property: string;
  keywords: string;
  competitors: string;
}

const STEPS = [
  { label: "Seleccionar cliente" },
  { label: "Propiedades" },
  { label: "Keywords iniciales" },
];

// ---------------------------------------------------------------------------
// Step 1 — Picker de cliente
// ---------------------------------------------------------------------------

function Step1({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (client: WizardClient) => void;
}) {
  const [clients, setClients] = useState<WizardClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    listClientsForWizard().then((list) => {
      setClients(list);
      setLoading(false);
    });
  }, []);

  const filtered = clients.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.domain.toLowerCase().includes(search.toLowerCase())
  );

  // Ordenar: SEO sin configurar primero, luego resto
  const sorted = [...filtered].sort((a, b) => {
    const aReady = a.services.includes("seo") && !a.gscProperty;
    const bReady = b.services.includes("seo") && !b.gscProperty;
    if (aReady && !bReady) return -1;
    if (!aReady && bReady) return 1;
    return a.name.localeCompare(b.name);
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm font-mono">Cargando clientes…</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Buscar por nombre o dominio…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm font-mono bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div className="max-h-80 overflow-y-auto space-y-1.5 pr-1">
        {sorted.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8 font-mono">
            Sin resultados para &ldquo;{search}&rdquo;
          </p>
        )}
        {sorted.map((c) => {
          const isSelected = c.id === selected;
          const hasSeo = c.services.includes("seo");
          const hasGsc = !!c.gscProperty;
          const hasGa4 = !!c.ga4Property;

          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c)}
              className={cn(
                "w-full text-left p-3 rounded-lg border transition-colors",
                isSelected
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/40 hover:bg-muted/30"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                  <p className="text-[11px] font-mono text-muted-foreground truncate">{c.domain}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                  {hasSeo && (
                    <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                      SEO
                    </span>
                  )}
                  <span className={cn("text-[9px] font-mono", hasGsc ? "text-ds-green" : "text-muted-foreground/30")}>
                    GSC
                  </span>
                  <span className={cn("text-[9px] font-mono", hasGa4 ? "text-ds-green" : "text-muted-foreground/30")}>
                    GA4
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-[10px] font-mono text-muted-foreground/50 text-center">
        {clients.length} clientes activos · ✓ GSC · ✓ GA4
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PropertyPicker — reutilizable para GSC y GA4
// ---------------------------------------------------------------------------

function PropertyPicker({
  label, icon: Icon, value, onChange, loadFn, renderOption,
  placeholder, manualPlaceholder, manualHint,
}: {
  label: string;
  icon: React.ElementType;
  value: string;
  onChange: (v: string) => void;
  loadFn: () => Promise<{ id: string; label: string }[]>;
  renderOption: (item: { id: string; label: string }) => string;
  placeholder: string;
  manualPlaceholder: string;
  manualHint: string;
}) {
  const [options, setOptions] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [manual, setManual] = useState(false);

  async function handleLoad() {
    setLoading(true);
    const result = await loadFn();
    setOptions(result);
    setLoaded(true);
    setLoading(false);
  }

  function handleClear() {
    onChange("");
    setLoaded(false);
    setOptions([]);
    setManual(false);
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {value ? (
        <div className="flex items-center gap-2 p-2.5 rounded-lg border border-ds-green/30 bg-ds-green/5">
          <Icon className="h-3.5 w-3.5 text-ds-green flex-shrink-0" />
          <span className="text-xs font-mono text-foreground flex-1 truncate">{value}</span>
          <button type="button" onClick={handleClear} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : manual ? (
        <div className="space-y-1">
          <input
            type="text"
            autoFocus
            placeholder={manualPlaceholder}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground/50"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = (e.currentTarget.value ?? "").trim();
                if (v) onChange(v);
              }
              if (e.key === "Escape") setManual(false);
            }}
            onBlur={(e) => {
              const v = (e.currentTarget.value ?? "").trim();
              if (v) onChange(v);
              else setManual(false);
            }}
          />
          <p className="text-[10px] font-mono text-muted-foreground/60">{manualHint} · Enter para confirmar</p>
        </div>
      ) : !loaded ? (
        <button
          type="button"
          onClick={handleLoad}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 h-10 border border-dashed border-border rounded-lg text-xs font-mono text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
          {loading ? "Cargando…" : `Cargar propiedades de ${label}`}
        </button>
      ) : (
        <div className="space-y-1.5">
          <div className="relative">
            <select
              value=""
              onChange={(e) => { if (e.target.value) onChange(e.target.value); }}
              className="w-full appearance-none border border-border rounded-lg px-3 py-2 pr-8 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary bg-background"
            >
              <option value="">{options.length ? placeholder : "— Sin propiedades en esta cuenta —"}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>{renderOption(o)}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
          <button
            type="button"
            onClick={() => setManual(true)}
            className="text-[10px] font-mono text-muted-foreground/60 hover:text-primary transition-colors"
          >
            ¿No aparece la propiedad? Ingresar manualmente →
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Propiedades GSC / GA4
// ---------------------------------------------------------------------------

function Step2({
  data,
  onChange,
}: {
  data: WizardData;
  onChange: (d: Partial<WizardData>) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-ds-blue/5 border border-ds-blue/20 p-4 text-xs font-mono text-ds-blue">
        Conecta las propiedades de Google para obtener datos de Search Console y Analytics 4.
        Puedes dejarlos vacíos y configurarlos después.
      </div>

      <PropertyPicker
        label="Google Search Console"
        icon={Search}
        value={data.gscProperty}
        onChange={(v) => onChange({ gscProperty: v })}
        loadFn={async () => {
          const sites = await listGscSites();
          return sites.map((s: GscSite) => ({ id: s.siteUrl, label: s.siteUrl }));
        }}
        renderOption={(o) => o.label}
        placeholder="— Elige una propiedad GSC —"
        manualPlaceholder="sc-domain:ejemplo.com"
        manualHint="Formato: sc-domain:dominio.com o https://dominio.com"
      />

      <PropertyPicker
        label="Google Analytics 4"
        icon={BarChart2}
        value={data.ga4Property}
        onChange={(v) => onChange({ ga4Property: v })}
        loadFn={async () => {
          const props = await listGa4Properties();
          return props.map((p: Ga4Property) => ({
            id: p.propertyId,
            label: `${p.displayName} (${p.propertyId})`,
          }));
        }}
        renderOption={(o) => o.label}
        placeholder="— Elige una propiedad GA4 —"
        manualPlaceholder="properties/123456789"
        manualHint="Formato: properties/XXXXXXXXX"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Keywords y competidores
// ---------------------------------------------------------------------------

function Step3({
  data,
  onChange,
}: {
  data: WizardData;
  onChange: (d: Partial<WizardData>) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="keywords">Keywords prioritarias</Label>
        <textarea
          id="keywords"
          className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          placeholder="keyword uno, keyword dos, keyword tres"
          value={data.keywords}
          onChange={(e) => onChange({ keywords: e.target.value })}
        />
        <p className="text-xs text-muted-foreground/60 font-mono">Separadas por coma. Se trackearán diariamente.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="competitors">Competidores</Label>
        <textarea
          id="competitors"
          className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          placeholder="competidor1.com, competidor2.com"
          value={data.competitors}
          onChange={(e) => onChange({ competitors: e.target.value })}
        />
        <p className="text-xs text-muted-foreground/60 font-mono">Separados por coma. Máximo 5.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard principal
// ---------------------------------------------------------------------------

export default function NuevoClientePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<WizardClient | null>(null);

  const [data, setData] = useState<WizardData>({
    clientId: "",
    gscProperty: "",
    ga4Property: "",
    keywords: "",
    competitors: "",
  });

  function update(partial: Partial<WizardData>) {
    setData((prev) => ({ ...prev, ...partial }));
  }

  function handleSelectClient(client: WizardClient) {
    setSelectedClient(client);
    setData((prev) => ({
      ...prev,
      clientId: client.id,
      gscProperty: client.gscProperty ?? "",
      ga4Property: client.ga4Property ?? "",
    }));
  }

  function canProceed() {
    if (step === 0) return !!data.clientId;
    return true;
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const res = await configureClientSeo(data);
      if (res.ok && res.clientId) {
        router.push(`/clientes/${res.clientId}`);
      } else {
        setError(res.error ?? "Error al guardar configuración.");
      }
    });
  }

  const isLast = step === STEPS.length - 1;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display font-extrabold text-[clamp(1.8rem,3vw,2.8rem)] tracking-tight leading-[1.05] text-foreground">
          Configurar cliente SEO
        </h1>
        <p className="font-mono text-[0.75rem] text-muted-foreground mt-1">
          Paso {step + 1} de {STEPS.length} — {STEPS[step].label}
          {selectedClient && step > 0 && (
            <span className="text-primary"> · {selectedClient.name}</span>
          )}
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div
              className={cn(
                "h-6 w-6 rounded-full flex items-center justify-center font-mono text-[0.7rem] font-bold transition-colors border",
                i < step
                  ? "bg-ds-green/10 text-ds-green border-ds-green/40"
                  : i === step
                  ? "bg-primary/15 text-primary border-primary/40"
                  : "bg-muted text-muted-foreground border-border"
              )}
            >
              {i < step ? <Check className="h-3 w-3" /> : i + 1}
            </div>
            <span className={cn("font-mono text-[0.7rem] hidden sm:block", i === step ? "text-foreground" : "text-muted-foreground/50")}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={cn("h-px w-8 mx-1", i < step ? "bg-ds-green/40" : "bg-border")} />
            )}
          </div>
        ))}
      </div>

      {/* Contenido */}
      <div className="bg-card rounded-xl border border-border p-6 mb-6">
        {step === 0 && (
          <Step1
            selected={data.clientId}
            onSelect={handleSelectClient}
          />
        )}
        {step === 1 && <Step2 data={data} onChange={update} />}
        {step === 2 && <Step3 data={data} onChange={update} />}
      </div>

      {error && <p className="text-sm text-destructive mb-4 font-mono">{error}</p>}

      {/* Navegación */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => (step > 0 ? setStep(step - 1) : router.back())}
          disabled={isPending}
          className="gap-2 font-mono text-xs"
        >
          <ChevronLeft className="h-4 w-4" />
          {step === 0 ? "Cancelar" : "Anterior"}
        </Button>

        {isLast ? (
          <Button
            onClick={handleSubmit}
            disabled={!canProceed() || isPending}
            className="gap-2 font-mono text-xs"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {isPending ? "Guardando…" : "Guardar configuración"}
          </Button>
        ) : (
          <Button
            onClick={() => setStep(step + 1)}
            disabled={!canProceed()}
            className="gap-2 font-mono text-xs"
          >
            Siguiente
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
