# Contrato: Cerebro SEO → Orquestador

**Versión:** 2026-09-26 v2
**Consumidor:** Cerebro web (Orquestador)

---

## 1. GET /api/internal/recommendations/{cerebroClientId}

Devuelve el plan de next steps + análisis + oportunidades GSC para un cliente.

### Auth
`Authorization: Bearer {SEO_INTERNAL_SECRET}`

### Query params
| Param | Requerido | Default | Descripción |
|---|---|---|---|
| `month` | sí | — | Formato YYYY-MM. Interpreta en zona CST (UTC-6). |
| `type` | no | `"daily"` | `"monthly"` = plan mensual estable (max 6 steps, sin setup, idempotente dentro del mes). `"daily"` = plan diario completo (comportamiento original). |
| `maxAgeDays` | no | — | Solo para type=daily. Si el plan tiene más de N días, `stale: true`. |

### Response 200 — type=monthly
```json
{
  "clientId": "abc12345-6789-...",
  "month": "2026-09",
  "type": "monthly",
  "planId": "cm3abc123",
  "planStatus": "valid",
  "model": "claude",
  "stale": false,
  "nextSteps": [
    {
      "titulo": "Optimizar meta de /servicios — CTR 1.2% con 890 impresiones",
      "descripcion": "La página /servicios tiene posición #5 pero CTR muy bajo...",
      "categoria": "oportunidad",
      "prioridad": 2,
      "seccionDestino": "trafico-paginas",
      "evidencia": "Pos #5, CTR 1.2%, 890 imp/mes — benchmark esperado: 5.1%",
      "esfuerzo": "bajo",
      "impacto": "alto",
      "kind": "meta",
      "targetUrl": "/servicios",
      "keywords": ["servicios industriales"],
      "origin": "data"
    }
  ],
  "analysis": null,
  "gscOpportunities": [],
  "generatedAt": "2026-09-01T13:00:00.000Z"
}
```

### Comportamiento de type=monthly
- **Lazy generation:** La primera vez que se pide en un mes, genera el plan y lo persiste. Las llamadas siguientes devuelven el mismo plan exacto.
- **Max 6 steps:** Solo steps accionables (sin setup, sin kind:"otro"). Priorizados por prioridad + impacto.
- **Estable:** Llamar N veces con el mismo month siempre devuelve los mismos steps. No hay regeneración.
- **No incluye analysis ni gscOpportunities** — esos son para la vista diaria.
- **Cada step incluye `origin`:** `"data"` (métrica lo dicta) o `"ai-insight"` (recomendación estratégica).

### Response 200 — type=daily (o sin type)
```json
{
  "clientId": "abc12345-6789-...",
  "month": "2026-09",
  "type": "daily",
  "planId": "cm3abc123",
  "planStatus": "valid",
  "model": "claude-sonnet-4-6",
  "stale": false,
  "nextSteps": [ ... ],
  "analysis": {
    "resumenEjecutivo": "...",
    "oportunidades": [ { "titulo": "...", "descripcion": "...", "accion": "...", "impacto": "alto" } ],
    "riesgos": [ { "titulo": "...", "descripcion": "...", "urgencia": "alta" } ]
  },
  "gscOpportunities": [ ... ],
  "generatedAt": "2026-09-16T13:00:00.000Z"
}
```

### Notas
- `nextSteps` de planes viejos (pre-v2) no tienen `esfuerzo`, `impacto`, `kind`, `targetUrl`, `keywords`, `origin` — vienen como `null` o ausentes.
- `planStatus`: `"valid"` o `"invalid"` (Zod validation failed — solo setup steps).
- `gscOpportunities`: best-effort, requiere GSC configurado. Array vacío si no hay datos. Solo en type=daily.
- `stale`: `true` si `maxAgeDays` está presente y el plan es más viejo. Solo aplica a type=daily.

---

## 2. POST /api/internal/advisor/regenerate/{cerebroClientId}

Encola un job BullMQ del advisor. Idempotente: si ya hay un job activo, devuelve el mismo jobId.

**NOTA:** Para plan mensual, NO usar este endpoint. Usar `GET /recommendations/{id}?type=monthly` que genera lazy si no existe.

### Auth
`Authorization: Bearer {SEO_INTERNAL_SECRET}`

### Response 200
```json
{ "jobId": "advisor-api:cm3abc123:1726487200000" }
```

### Errors
- 401: Auth inválida
- 400: cerebroClientId inválido o cliente no activo
- 404: Cliente no encontrado

---

## 3. GET /api/internal/advisor/jobs/{jobId}

Consulta estado de un job de advisor.

### Auth
`Authorization: Bearer {SEO_INTERNAL_SECRET}`

### Response 200
```json
{ "status": "done", "planId": "cm3abc123" }
```
```json
{ "status": "queued" }
```
```json
{ "status": "failed", "error": "Zod validation failed after 2 attempts" }
```

### Status values
`queued` → `running` → `done` | `failed`

---

## 4. NextStep schema (v3)

```typescript
interface NextStep {
  titulo: string;                          // max 80 chars, incluye dato específico
  descripcion: string;                     // max 350 chars
  categoria: "setup" | "urgente" | "oportunidad" | "mejora";
  prioridad: number;                       // 1-5, 1 = más urgente
  seccionDestino?: string;                 // slug: keywords, audit, backlinks, etc.
  evidencia: string;                       // max 120 chars
  // ── Campos v2 (nullable para planes viejos) ──
  esfuerzo?: "bajo" | "medio" | "alto" | null;
  impacto?: "alto" | "medio" | "bajo" | null;
  kind?: "meta" | "contenido-blog" | "contenido-landing" | "contenido-optimizar" | "interlinking" | "schema" | "tecnico" | "otro" | null;
  targetUrl?: string | null;
  keywords?: string[] | null;
  // ── Campo v3 ──
  origin?: "data" | "ai-insight" | null;
}
```

### kind catalog
| kind | actionType en Orquestador | Ejemplos |
|---|---|---|
| `meta` | `seo.meta.update` | Title, meta description, OG tags de página existente |
| `contenido-blog` | `blog.create` | Crear blog post nuevo |
| `contenido-landing` | `site.landing.create` | Crear landing page nueva |
| `contenido-optimizar` | `seo.content.optimize` | Reescribir body text, agregar FAQ, mejorar copy E-E-A-T de página existente |
| `interlinking` | `seo.interlinking` | Agregar/mejorar enlaces internos entre páginas existentes |
| `schema` | `seo.schema.update` | JSON-LD, structured data |
| `tecnico` | `seo.audit.fix` | Velocidad, crawlability, redirects, CWV, robots.txt, sitemap, llms.txt |
| `otro` | `other` | Setup, configuración (solo steps determinísticos — Claude no genera este kind) |

### origin catalog
| origin | Significado | Ejemplo |
|---|---|---|
| `data` | Acción dictada directamente por una métrica/dato | CTR 1.2% en /servicios → optimizar meta tags |
| `ai-insight` | Recomendación estratégica de Claude | Crear landing para keyword gap detectado en 3 señales |

### esfuerzo criteria
| Nivel | Definición |
|---|---|
| `bajo` | Cambio puntual en 1 URL (meta, schema, ajuste on-page), < 1 hora |
| `medio` | Optimización de contenido, interlinking, corrección multi-página, 1-4 horas |
| `alto` | Contenido nuevo (landing/blog), rediseño de sección, migración técnica, > 4 horas |

---

## 5. Responsabilidades

| Responsabilidad | Dueño |
|---|---|
| Detectar señales SEO (rankings, CTR, audits, gaps) | Cerebro SEO |
| Analizar señales y generar plan mensual con max 6 steps | Cerebro SEO |
| Etiquetar cada step como `data` o `ai-insight` | Cerebro SEO |
| Decidir qué steps ejecutar y en qué orden | Orquestador |
| Descomponer steps en subtareas ejecutables | Orquestador |
| Crear tareas en Notion y asignar a equipo | Orquestador |
| Ejecutar cambios en el sitio web | Orquestador (vía executors) |
