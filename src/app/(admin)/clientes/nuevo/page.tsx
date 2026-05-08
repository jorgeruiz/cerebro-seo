"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ChevronLeft, Check } from "lucide-react";
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
        <p className="text-xs text-gray-400">Sin https:// ni slash final</p>
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
            className="h-9 w-14 rounded border border-gray-200 cursor-pointer"
          />
          <span className="text-sm text-gray-500">{data.brandColor || "#6366f1"}</span>
        </div>
      </div>
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
      <div className="rounded-lg bg-blue-50 border border-blue-100 p-4 text-sm text-blue-700">
        Estas propiedades se conectarán al cliente para obtener datos de Google Search Console y GA4.
        Puedes dejarlos vacíos y configurarlos después.
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="gsc">Google Search Console</Label>
        <Input
          id="gsc"
          placeholder="sc-domain:ejemplo.com"
          value={data.gscProperty}
          onChange={(e) => onChange({ gscProperty: e.target.value })}
        />
        <p className="text-xs text-gray-400">Property ID en formato sc-domain:dominio.com o https://dominio.com</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ga4">Google Analytics 4</Label>
        <Input
          id="ga4"
          placeholder="properties/123456789"
          value={data.ga4Property}
          onChange={(e) => onChange({ ga4Property: e.target.value })}
        />
        <p className="text-xs text-gray-400">Property ID en formato properties/XXXXXXXXX</p>
      </div>
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
        <p className="text-xs text-gray-400">Separadas por coma. Estas se trackearán diariamente.</p>
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
        <p className="text-xs text-gray-400">Separados por coma. Máximo 5.</p>
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
    <div className="p-8 max-w-xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Nuevo cliente</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Paso {step + 1} de {STEPS.length} — {STEPS[step].label}
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div
              className={cn(
                "h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
                i < step
                  ? "bg-green-500 text-white"
                  : i === step
                  ? "bg-[#6366f1] text-white"
                  : "bg-gray-100 text-gray-400"
              )}
            >
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </div>
            <span
              className={cn(
                "text-xs font-medium hidden sm:block",
                i === step ? "text-gray-900" : "text-gray-400"
              )}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={cn("h-px w-8 mx-1", i < step ? "bg-green-300" : "bg-gray-200")} />
            )}
          </div>
        ))}
      </div>

      {/* Contenido del paso */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
        {step === 0 && <Step1 data={data} onChange={update} />}
        {step === 1 && <Step2 data={data} onChange={update} />}
        {step === 2 && <Step3 data={data} onChange={update} />}
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-4">{error}</p>
      )}

      {/* Navegación */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => (step > 0 ? setStep(step - 1) : router.back())}
          disabled={submitting}
          className="gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          {step === 0 ? "Cancelar" : "Anterior"}
        </Button>

        {isLast ? (
          <Button
            onClick={handleSubmit}
            disabled={!canProceed() || submitting}
            className="bg-[#6366f1] hover:bg-[#4f52d4] text-white gap-2"
          >
            {submitting ? "Creando..." : "Crear cliente"}
            <Check className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={() => setStep(step + 1)}
            disabled={!canProceed()}
            className="bg-[#6366f1] hover:bg-[#4f52d4] text-white gap-2"
          >
            Siguiente
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
