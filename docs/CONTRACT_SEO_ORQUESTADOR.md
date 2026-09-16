# Contrato: Cerebro SEO → Orquestador

**Versión:** 2026-09-16 v1
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
| `maxAgeDays` | no | — | Si el plan tiene más de N días, `stale: true`. |

### Response 200
```json
{
  "clientId": "abc12345-6789-...",
  "month": "2026-09",
  "planId": "cm3abc123",
  "planStatus": "valid",
  "model": "claude-sonnet-4-6",
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
      "keywords": ["servicios industriales"]
    }
  ],
  "analysis": {
    "resumenEjecutivo": "...",
    "oportunidades": [
      {
        "titulo": "...",
        "descripcion": "...",
        "accion": "...",
        "impacto": "alto"
      }
    ],
    "riesgos": [
      {
        "titulo": "...",
        "descripcion": "...",
        "urgencia": "alta"
      }
    ]
  },
  "gscOpportunities": [
    {
      "oppType": "quick-win",
      "keyword": "filtros industriales",
      "url": "https://example.com/filtros",
      "ctr": 2.1,
      "impressions": 1200,
      "position": 6,
      "action": "Optimizar title y meta description incluyendo keyword principal",
      "priority": "alta"
    }
  ],
  "generatedAt": "2026-09-16T13:00:00.000Z"
}
```

### Notas
- `nextSteps` de planes viejos (pre-v2) no tienen `esfuerzo`, `impacto`, `kind`, `targetUrl`, `keywords` — vienen como `null` o ausentes.
- `planStatus`: `"valid"` o `"invalid"` (Zod validation failed — solo setup steps).
- `gscOpportunities`: best-effort, requiere GSC configurado. Array vacío si no hay datos.
- `stale`: `true` si `maxAgeDays` está presente y el plan es más viejo.

---

## 2. POST /api/internal/advisor/regenerate/{cerebroClientId}

Encola un job BullMQ del advisor. Idempotente: si ya hay un job activo, devuelve el mismo jobId.

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

## 4. NextStep schema (v2)

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
  kind?: "meta" | "contenido-blog" | "contenido-landing" | "schema" | "tecnico" | "otro" | null;
  targetUrl?: string | null;
  keywords?: string[] | null;
}
```

### kind catalog
| kind | Ejemplos |
|---|---|
| `meta` | Title, meta description, OG tags |
| `contenido-blog` | Crear/mejorar artículo de blog |
| `contenido-landing` | Crear/mejorar landing page |
| `schema` | JSON-LD, structured data |
| `tecnico` | Velocidad, crawlability, redirects, CWV |
| `otro` | Setup, configuración, acciones mixtas |

### esfuerzo criteria
| Nivel | Definición |
|---|---|
| `bajo` | Cambio puntual en 1 URL (meta, schema, ajuste on-page), < 1 hora |
| `medio` | Optimización de contenido, interlinking, corrección multi-página, 1-4 horas |
| `alto` | Contenido nuevo (landing/blog), rediseño de sección, migración técnica, > 4 horas |
