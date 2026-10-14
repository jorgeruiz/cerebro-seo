"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ChevronLeft, Check, Search, BarChart2, ChevronDown, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { listGscSites, listGa4Properties } from "../[id]/actions";
import type { GscSite, Ga4Property } from "../[id]/actions";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface WizardData {
  // Paso 1: datos básicos
  name: string;
  domain: string;
  plan: "BASIC" | "PRO" | "ENTERPRISE";
  brandColor: string;
  // Paso 2: propiedades
  gscProperty: string;
  ga4Property: string;
  // Paso 3: keywords y competidores iniciales
  keywords: string; // separados por coma
  competitors: string; // separados por coma
}

const STEPS = [
  { label: "Datos básicos" },
  { label: "Propiedades" },
  { label: "Keywords iniciales" },
];

// ---------------------------------------------------------------------------
// Server action (se llama vía fetch)
// ---------------------------------------------------------------------------

async function createClient(data: WizardData): Promise<{ id: string }> {
  const res = await fetch("/api/clientes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Error al crear cliente");
  return res.json() as Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Pasos del wizard
// ---------------------------------------------------------------------------

function Step1({
  data,
  onChange,
}: {
  data: WizardData;
  onChange: (d: Partial<WizardData>) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="name">Nombre del cliente *</Label>
        <Input
          id="name"
          placeholder="Empresa S.A. de C.V."
          value={data.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="domain">Dominio principal *</Label>
        <Input
          id="domain"
          placeholder="ejemplo.com"
          value={data.domain}
          onChange={(e) => onChange({ domain: e.target.value })}
        />
        <p className="text-xs text-muted-foreground/60 font-mono">Sin https:// ni slash final</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="plan">Plan SEO *</Label>
        <Select
          value={data.plan}
          onValueChange={(v) => onChange({ plan: v as WizardData["plan"] })}
        >
          <SelectTrigger id="plan">
            <SelectValue placeholder="Selecciona un plan" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="BASIC">Basic</SelectItem>
            <SelectItem value="PRO">Pro</SelectItem>
            <SelectItem value="ENTERPRISE">Enterprise</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="color">Color de marca</Label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            id="color"
            value={data.brandColor || "#6366f1"}
            onChange={(e) => onChange({ brandColor: e.target.value })}
            className="h-9 w-14 rounded border border-border cursor-pointer bg-transparent"
          />
          <span className="text-xs font-mono text-muted-foreground">{data.brandColor || "#6366f1"}</span>
        </div>
      </div>
    </div>
  );
}

function PropertyPicker({
  label,
  icon: Icon,
  value,
  onChange,
  loadFn,
  renderOption,
  placeholder,
}: {
  label: string;
  icon: React.ElementType;
  value: string;
  onChange: (v: string) => void;
  loadFn: () => Promise<{ id: string; label: string }[]>;
  renderOption: (item: { id: string; label: string }) => string;
  placeholder: string;
}) {
  const [options, setOptions] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLoad() {
    setLoading(true);
    setError(null);
    const result = await loadFn();
    setOptions(result);
    setLoaded(true);
    setLoading(false);
    if (result.length === 0) {
      setError("No se encontraron propiedades en la cuenta.");
    }
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {value ? (
        <div className="flex items-center gap-2 p-2.5 rounded-lg border border-ds-green/30 bg-ds-green/5">
          <Icon className="h-3.5 w-3.5 text-ds-green flex-shrink-0" />
          <span className="text-xs font-mono text-foreground flex-1 truncate">{value}</span>
          <button
            type="button"
            onClick={() => { onChange(""); setLoaded(false); setOptions([]); }}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
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
              <option value="">{placeholder}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>{renderOption(o)}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

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
      />
    </div>
  );
}

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
        <p className="text-xs text-muted-foreground/60 font-mono">Separadas por coma. Estas se trackearán diariamente.</p>
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [data, setData] = useState<WizardData>({
    name: "",
    domain: "",
    plan: "PRO",
    brandColor: "#6366f1",
    gscProperty: "",
    ga4Property: "",
    keywords: "",
    competitors: "",
  });

  function update(partial: Partial<WizardData>) {
    setData((prev) => ({ ...prev, ...partial }));
  }

  function canProceed() {
    if (step === 0) return data.name.trim() !== "" && data.domain.trim() !== "";
    return true;
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const { id } = await createClient(data);
      router.push(`/clientes/${id}`);
    } catch {
      setError("No se pudo crear el cliente. Intenta de nuevo.");
      setSubmitting(false);
    }
  }

  const isLast = step === STEPS.length - 1;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display font-extrabold text-[clamp(1.8rem,3vw,2.8rem)] tracking-tight leading-[1.05] text-foreground">
          Nuevo cliente
        </h1>
        <p className="font-mono text-[0.75rem] text-muted-foreground mt-1">
          Paso {step + 1} de {STEPS.length} — {STEPS[step].label}
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
            <span
              className={cn(
                "font-mono text-[0.7rem] hidden sm:block",
                i === step ? "text-foreground" : "text-muted-foreground/50"
              )}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={cn("h-px w-8 mx-1", i < step ? "bg-ds-green/40" : "bg-border")} />
            )}
          </div>
        ))}
      </div>

      {/* Contenido del paso */}
      <div className="bg-card rounded-xl border border-border p-6 mb-6">
        {step === 0 && <Step1 data={data} onChange={update} />}
        {step === 1 && <Step2 data={data} onChange={update} />}
        {step === 2 && <Step3 data={data} onChange={update} />}
      </div>

      {error && (
        <p className="text-sm text-destructive mb-4 font-mono">{error}</p>
      )}

      {/* Navegación */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => (step > 0 ? setStep(step - 1) : router.back())}
          disabled={submitting}
          className="gap-2 font-mono text-xs"
        >
          <ChevronLeft className="h-4 w-4" />
          {step === 0 ? "Cancelar" : "Anterior"}
        </Button>

        {isLast ? (
          <Button
            onClick={handleSubmit}
            disabled={!canProceed() || submitting}
            className="gap-2 font-mono text-xs"
          >
            {submitting ? "Creando..." : "Crear cliente"}
            <Check className="h-4 w-4" />
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
