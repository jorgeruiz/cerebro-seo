# Spec: Ajustes en Orquestador para Plan Mensual SEO

**Fecha:** 2026-09-26
**Contexto:** Cerebro SEO ahora genera un plan mensual estable con max 6 steps accionables, etiquetados como `data` o `ai-insight`. El Orquestador debe consumirlo correctamente.

---

## Diagnóstico: qué estaba mal

### Problema de responsabilidades
Cerebro SEO generaba steps vagos (sin URL, sin keywords, objetivos generales en vez de acciones) y el Orquestador intentaba clasificarlos con un `OPP_TYPE_MAP` limitado que defaulteaba todo a `seo.meta.update`. Además, el flujo dependía de clicks manuales del usuario para enviar tareas al orquestador — si nadie hacía clic, nada se ejecutaba.

### Problema de datos
Los steps llegaban sin `targetUrl`, sin `keywords`, con `kind` incorrecto. El Orquestador tenía que adivinar el `actionType` y muchos items terminaban como `HUMAN_TASK` porque `change-request.ts` no encontraba `affectedUrl`.

### Lo que cambió en Cerebro SEO (ya implementado)
1. **Plan mensual estable** — nuevo query param `type=monthly` en `GET /api/internal/recommendations/{id}?month=YYYY-MM&type=monthly`. Genera lazy la primera vez, devuelve los mismos 6 steps todo el mes.
2. **Steps de mayor calidad** — system prompt reescrito con reglas anti-vaguedad. Cada step tiene `kind`, `targetUrl`, `keywords` obligatorios. Steps internos (configurar tracking, activar benchmark) ya no se generan.
3. **2 kinds nuevos** — `contenido-optimizar` (reescribir body text de página existente) e `interlinking` (enlaces internos entre páginas).
4. **Campo `origin`** — cada step tiene `origin: "data"` (métrica lo dicta) o `origin: "ai-insight"` (recomendación estratégica de Claude). Informativo para el equipo.
5. **Cap de 6 steps** — el plan mensual ya viene filtrado y priorizado. Sin setup, sin kind:"otro".

---

## Qué debe cambiar en el Orquestador

### 1. Consumir plan mensual en vez de diario

**Archivo:** `lib/cerebro-seo-client.ts`

Cuando el Orquestador pide recomendaciones para armar el plan del mes, debe usar `type=monthly`:

```typescript
// ANTES
const url = `${BASE}/api/internal/recommendations/${cleanId}?month=${month}`;

// DESPUÉS (nueva función o parámetro)
const url = `${BASE}/api/internal/recommendations/${cleanId}?month=${month}&type=monthly`;
```

**Comportamiento clave:**
- La primera llamada del mes genera el plan (puede tardar 15-30s por la llamada a Claude).
- Las llamadas subsecuentes son instantáneas — devuelven el mismo plan.
- **NO llamar `regenerateAndWait()`** para planes mensuales. El plan mensual es estable por diseño. `regenerateAndWait()` genera planes diarios que son diferentes.

**Archivos a actualizar:**
- `lib/cerebro-seo-client.ts` — agregar parámetro `type` a `fetchSeoRecommendations()`
- `app/api/orchestrator/runs/[runId]/load-tasks/route.ts` — usar `type=monthly`
- `worker/process-client.ts` — usar `type=monthly`
- `app/api/orchestrator/runs/[runId]/health-check/route.ts` — health check puede seguir sin type (o usar monthly)

### 2. Agregar kinds nuevos al fan-out

**Archivo:** `lib/orchestrator-fanout.ts`

El `KIND_TO_ACTION_TYPE` necesita los 2 kinds nuevos:

```typescript
// ANTES
const KIND_TO_ACTION_TYPE = {
  'meta':              'seo.meta.update',
  'contenido-blog':    'blog.create',
  'contenido-landing': 'site.landing.create',
  'schema':            'seo.schema.update',
  'tecnico':           'seo.audit.fix',
  'otro':              'other',
};

// DESPUÉS
const KIND_TO_ACTION_TYPE = {
  'meta':                'seo.meta.update',
  'contenido-blog':      'blog.create',
  'contenido-landing':   'site.landing.create',
  'contenido-optimizar': 'seo.content.optimize',
  'interlinking':        'seo.interlinking',
  'schema':              'seo.schema.update',
  'tecnico':             'seo.audit.fix',
  'otro':                'other',
};
```

**Nota:** La selección (`orchestrator-selection.ts`) ya tiene estos mappings. Solo falta el fan-out.

### 3. No llamar regenerateAndWait para planes mensuales

**Archivos:** `load-tasks/route.ts`, `worker/process-client.ts`

```typescript
// ANTES
let recommendations;
try {
  recommendations = await regenerateAndWait(clientId, month);
} catch {
  recommendations = await fetchSeoRecommendations(clientId, month);
}

// DESPUÉS
// Para plan mensual: solo fetch con type=monthly (lazy generation del lado de Cerebro SEO)
const recommendations = await fetchSeoRecommendations(clientId, month, { type: 'monthly' });
```

El plan mensual de Cerebro SEO se genera lazy en la primera llamada. No hay necesidad de forzar regeneración. Llamar `regenerateAndWait()` generaría un plan **diario** nuevo que es diferente del mensual.

### 4. Respetar el cap de 6

El plan mensual ya viene con máximo 6 steps. El Orquestador **no necesita filtrar más** a menos que tenga su propia selection policy que descarte algunos.

Si el `applySelectionPolicy()` tiene un cap propio (ej: max 4 por bucket), puede seguir aplicándolo — pero el input ya son máximo 6, no 15+.

### 5. Pasar `origin` al payload de los items

**Archivo:** `orchestrator-selection.ts` o donde se construya el `PlanItem`

El campo `origin` es informativo — no afecta la ejecución, pero es útil para el equipo al revisar tareas en Notion:

```typescript
// Al crear PlanItem desde un NextStep:
payload: {
  ...existingPayload,
  origin: step.origin ?? null, // "data" | "ai-insight"
}
```

Cuando se creen tareas en Notion, el `origin` puede mostrarse como tag o nota:
- `data` → "Basado en metricas"
- `ai-insight` → "Recomendacion IA"

### 6. Actualizar tipo SeoNextStep en el cliente

**Archivo:** `lib/cerebro-seo-client.ts`

Agregar los campos nuevos al tipo:

```typescript
interface SeoNextStep {
  // ... campos existentes ...
  kind?: "meta" | "contenido-blog" | "contenido-landing" | "contenido-optimizar"
       | "interlinking" | "schema" | "tecnico" | "otro" | null;
  origin?: "data" | "ai-insight" | null;  // NUEVO
}
```

---

## Resumen de archivos a tocar en cerebro-web

| Archivo | Cambio |
|---|---|
| `lib/cerebro-seo-client.ts` | Agregar param `type` a `fetchSeoRecommendations()`, agregar `origin` y kinds nuevos al tipo `SeoNextStep` |
| `lib/orchestrator-fanout.ts` | Agregar `contenido-optimizar` e `interlinking` a `KIND_TO_ACTION_TYPE` |
| `app/api/orchestrator/runs/[runId]/load-tasks/route.ts` | Usar `type=monthly`, no llamar `regenerateAndWait()` |
| `worker/process-client.ts` | Usar `type=monthly`, no llamar `regenerateAndWait()` |
| `app/api/orchestrator/runs/[runId]/health-check/route.ts` | Opcional: usar `type=monthly` |
| `lib/orchestrator-selection.ts` | Pasar `origin` al payload del PlanItem |

---

## Tabla de mapeo kind → actionType (referencia completa)

| kind (Cerebro SEO) | actionType (Orquestador) | Executor |
|---|---|---|
| `meta` | `seo.meta.update` | `seo-meta-update.ts` (WP) / `change-request.ts` (Next.js) |
| `contenido-blog` | `blog.create` | `blog-create.ts` |
| `contenido-landing` | `site.landing.create` | `landing-create.ts` |
| `contenido-optimizar` | `seo.content.optimize` | `change-request.ts` |
| `interlinking` | `seo.interlinking` | `change-request.ts` |
| `schema` | `seo.schema.update` | `change-request.ts` |
| `tecnico` | `seo.audit.fix` | `change-request.ts` |
| `otro` | `other` | `HUMAN_TASK` (no executor) |

---

## Flujo final esperado

```
Dia 1 del mes (o cuando Orquestador pida):
  Orquestador → GET /recommendations/{id}?month=2026-10&type=monthly
                                          ↓
  Cerebro SEO genera plan mensual (lazy, 1 vez)
  → 6 steps max, cada uno con kind + targetUrl + keywords + origin
                                          ↓
  Orquestador recibe nextSteps[]
  → applySelectionPolicy (puede descartar alguno)
  → Crea PlanItems con actionType mapeado desde kind
  → Ejecuta via executors
                                          ↓
  Dia 15: Orquestador vuelve a pedir
  → Cerebro SEO devuelve MISMO plan (idempotente)
  → Orquestador no duplica items (dedup por fingerprint)
```
