# Diagnostico Multi-Proyecto — Cerebro SEO

> Sesion 35-pre | 2026-09-26 | Solo lectura, sin commits
>
> Objetivo: soportar varios proyectos (Sites) por cliente. 1 dominio = 1 proyecto = 1 Site.

---

## 1. Schema: modelos y relacion Client - Site

### Relacion actual

```
Client 1 ──── N Site
```

El schema ya define `sites Site[]` en Client y `clientId` en Site **sin unique constraint** — es 1:N en el schema pero **1:1 de facto** en produccion. Todo el codigo asume un unico Site por Client.

### Client (campos)

| Campo | Tipo | Notas |
|-------|------|-------|
| id | String @cuid | PK |
| cerebroClientId | String? @unique | Notion page ID |
| name | String | |
| domain | String | Dominio principal — **hoy asume 1 dominio** |
| plan | SeoPlan enum | BASIC, PRO, ENTERPRISE |
| status | ClientStatus enum | ACTIVE, PAUSED, CHURNED |
| services | String[] | |
| brandColor | String? | |

### Site (campos)

| Campo | Tipo | Notas |
|-------|------|-------|
| id | String @cuid | PK |
| clientId | String FK | Relacion a Client |
| url | String | URL completa del sitio |
| gscProperty | String? | Propiedad Google Search Console |
| ga4Property | String? | Propiedad Google Analytics 4 |

### Inventario: cada modelo y su FK

| Modelo | clientId | siteId | Accion multi-proyecto |
|--------|----------|--------|----------------------|
| **Site** | requerido | — | Mantener clientId (es la relacion padre) |
| **Keyword** | requerido | **no tiene** | **Agregar siteId** — keywords son por dominio |
| **KeywordRanking** | — (via Keyword) | — | Hereda de Keyword via FK |
| **Competitor** | requerido | **no tiene** | **Agregar siteId** — competidores son por dominio |
| **CompetitorSnapshot** | requerido | **no tiene** | **Agregar siteId** |
| **CompetitorKeywordGap** | requerido | **no tiene** | **Agregar siteId** |
| **Audit** | opcional | requerido | Ya tiene ambos — OK |
| **AuditIssue** | — (via Audit) | — | Hereda de Audit — OK |
| **Backlink** | requerido | opcional | **Hacer siteId requerido** |
| **BacklinkSnapshot** | requerido | **no tiene** | **Agregar siteId** |
| **PageMetric** | — | requerido (via Site) | Ya es por Site — OK |
| **Insight** | requerido | **no tiene** | **Agregar siteId** |
| **TimelineEvent** | requerido | **no tiene** | Mantener clientId (eventos son cross-site) |
| **MonthlyCycle** | requerido | **no tiene** | Mantener clientId (ciclo es del cliente) |
| **Task** | — (via Cycle) | — | Hereda de Cycle — OK |
| **Hypothesis** | requerido | **no tiene** | Mantener clientId (hipotesis son estrategicas) |
| **ClientAnalysis** | requerido | **no tiene** | **Agregar siteId** |
| **MonthlyReport** | requerido | **no tiene** | **Agregar siteId** |
| **ContentPlan** | requerido | **no tiene** | **Agregar siteId** |
| **AeoResearch** | requerido | **no tiene** | **Agregar siteId** |
| **NextStepPlan** | requerido | **no tiene** | **Agregar siteId** |
| **AiSearchVisibility** | requerido | **no tiene** | **Agregar siteId** |
| **ClientUser** | requerido | — | Mantener clientId (acceso es por cliente) |
| **ApiUsage** | opcional | — | Mantener clientId (costos se facturan al cliente) |
| **JobLog** | opcional | — | Mantener clientId (logs operativos) |

### Resumen de migracion de schema

- **14 modelos necesitan agregar `siteId`** (Keyword, Competitor, CompetitorSnapshot, CompetitorKeywordGap, Backlink[hacer requerido], BacklinkSnapshot, Insight, ClientAnalysis, MonthlyReport, ContentPlan, AeoResearch, NextStepPlan, AiSearchVisibility)
- **3 modelos ya estan bien** (Audit, PageMetric, AuditIssue)
- **5 modelos mantienen solo clientId** (MonthlyCycle, Task, Hypothesis, TimelineEvent, ClientUser, ApiUsage, JobLog)
- Todos los modelos que agregan `siteId` **deben mantener clientId tambien** — RLS y queries de dashboard del cliente siguen necesitando filtrar por cliente.

---

## 2. Queries Prisma: conteo por modulo

Total: **~63 archivos, ~332+ ocurrencias** de filtro por `clientId`. Solo **1 query** filtra por `siteId` en produccion (insights-processor.ts, patron hibrido).

### Por directorio

| Modulo | Archivos | Ocurrencias aprox | Patron |
|--------|----------|--------------------|--------|
| `src/server/jobs/workers/` | 9 | ~60 | Workers iteran por clientId, algunos reciben siteId en data (CrawlerJobData, BacklinksJobData) |
| `src/server/jobs/processors/` | 3 | ~80 | Processors hacen `site = findFirst({ where: { clientId } })` — asuncion 1:1 |
| `src/lib/seo-advisor/` | 3 | ~30 | advisor-processor, signals, preconditions — todo por clientId |
| `src/lib/` (analysis, content, report) | 5 | ~50 | claude-analysis, claude-content-plan, monthly-report, cycle-close, aeo-classify |
| `src/app/(admin)/clientes/[id]/` (actions) | 8 | ~70 | Server actions — todos por clientId |
| `src/app/(admin)/clientes/[id]/` (pages) | 12 | ~40 | Pages RSC — queries directas por clientId |
| `src/app/api/internal/` | 4 | ~25 | Endpoints internos — resuelven client por cerebroClientId |

### Patron critico: Site lookup por clientId

En ~15 archivos se repite este patron:

```typescript
const site = await prisma.site.findFirst({ where: { clientId } });
```

En multi-proyecto esto retornaria el **primer site arbitrario**. Cada uno de estos debe recibir `siteId` explicito.

**Archivos con este patron:**
- `src/app/(admin)/clientes/[id]/actions.ts` (lineas 140, 161, 204, 249, 329)
- `src/app/api/internal/recommendations/[clientId]/route.ts` (linea 62)
- `src/server/jobs/processors/insights-processor.ts` (linea 164)
- `src/lib/seo-advisor/preconditions.ts` (linea 40)
- `src/lib/claude-analysis.ts`
- `src/lib/claude-content-plan.ts`
- `src/lib/monthly-report.ts`

---

## 3. Redis: claves con clientId

### Claves actuales y equivalente propuesto

| Clave actual | TTL | Archivo | Propuesta multi-proyecto |
|--------------|-----|---------|--------------------------|
| `advisor:profile:{clientId}:{yyyy-MM}` | fin de mes + 48h | advisor-processor.ts:87 | `advisor:profile:{siteId}:{yyyy-MM}` |
| `advisor:signals:{clientId}:{yyyy-MM-dd}` | 25h | advisor-processor.ts:140 | `advisor:signals:{siteId}:{yyyy-MM-dd}` |
| `advisor:ran:{clientId}:{yyyy-MM-dd}` | 25h | advisor-processor.ts:161 | `advisor:ran:{siteId}:{yyyy-MM-dd}` |
| `insights:ctx:{clientId}:{yyyy-MM}:profile` | fin de mes + 48h | insights-processor.ts:81 | `insights:ctx:{siteId}:{yyyy-MM}:profile` |
| `insights:ctx:{clientId}:{yyyy-MM-dd}:trends` | 25h | insights-processor.ts:152 | `insights:ctx:{siteId}:{yyyy-MM-dd}:trends` |
| `insights:ran:{clientId}:{yyyy-MM-dd}:scheduled` | 25h | insights-processor.ts:385 | `insights:ran:{siteId}:{yyyy-MM-dd}:scheduled` |
| `agent:rankings:{clientId}:summary:{yyyy-'W'ww}` | — (read-only) | insights-processor.ts:157 | `agent:rankings:{siteId}:summary:{yyyy-'W'ww}` |

### Claves que NO cambian (ya usan dominio/property, no clientId)

| Clave | TTL | Archivo |
|-------|-----|---------|
| `cache:gsc:{siteUrl}:{start}:{end}:{type}` | 24h | google-search-console.ts |
| `cache:ga4:{propertyId}:{start}:{end}:{type}` | 4h | google-analytics-4.ts |
| `cache:dataforseo:domain:{domain}:{type}` | 7d | dataforseo.ts |
| `cache:dataforseo:backlinks:{domain}:{type}` | 24h | dataforseo.ts |
| `cache:dataforseo:gaps:{clientDomain}:{competitorDomain}` | 7d | dataforseo.ts |

Los caches de providers ya estan bien porque usan dominio/property como clave, no clientId.

### Invalidacion en regenerate

`src/app/api/internal/advisor/regenerate/[clientId]/route.ts` invalida 3 claves con `clientId`. Cambiara a `siteId` cuando el endpoint reciba el parametro.

---

## 4. BullMQ: jobs y schedulers

### Colas

| Cola | Jobs | Reintentos | Proposito |
|------|------|------------|-----------|
| `data-collection` | crawler:audit, tracking:rankings, analysis:backlinks, analysis:competitors, analysis:ai-search | 3 (exp backoff) | Recoleccion de datos SEO |
| `ai-analysis` | insights:generate, advisor:generate, cycle:close, report:monthly | 2 (fixed 30s) | Analisis con Claude |
| `sync` | sync:cerebro, sync:cerebro-tasks | 5 (exp backoff) | Sync con Cerebro/Notion |

### Jobs per-client (schedulers.ts) — deben cambiar a per-site

| Job | CRON | Data actual | Cambio propuesto |
|-----|------|-------------|------------------|
| `tracking:rankings-priority` | `0 3 * * *` | `{clientId, mode}` | `{clientId, siteId, mode}` |
| `tracking:rankings-bulk` | `0 4 * * 1` | `{clientId, mode}` | `{clientId, siteId, mode}` |
| `insights:generate` | `0 6 * * *` | `{clientId, trigger}` | `{clientId, siteId, trigger}` |
| `advisor:generate` | `0 7 * * *` | `{clientId}` | `{clientId, siteId}` |
| `analysis:backlinks` | `0 5 * * 4` | `{clientId}` | `{clientId, siteId}` |
| `analysis:competitors` | `0 7 1,15 * *` | `{clientId}` | `{clientId, siteId}` |
| `analysis:ai-search` | `0 6 * * 5` | `{clientId}` | `{clientId, siteId}` |
| `crawler:audit-quick` | `0 2 * * 3` | `{clientId, mode}` | `{clientId, siteId, mode}` |
| `crawler:audit` | `0 1 1 * *` | `{clientId, mode}` | `{clientId, siteId, mode}` |
| `sync:cerebro-tasks` | `*/15 * * * *` | `{clientId}` | Mantener clientId (sync es por cliente) |

### Iteracion en schedulers.ts

Hoy el scheduler hace:

```typescript
const clients = await prisma.client.findMany({ where: { status: "ACTIVE" } });
for (const client of clients) {
  // registra 1 job por client
}
```

Debe cambiar a:

```typescript
const clients = await prisma.client.findMany({
  where: { status: "ACTIVE" },
  include: { sites: true },
});
for (const client of clients) {
  for (const site of client.sites) {
    // registra 1 job por site
  }
}
```

### jobId pattern

Actual: `{jobType}:{clientId}` (ej: `rankings-priority:cmqq7l0xt...`)
Propuesto: `{jobType}:{siteId}` (ej: `rankings-priority:cmxx1abc...`)

### Jobs globales (no cambian)

| Job | CRON | Notas |
|-----|------|-------|
| `cycle:close` | `0 2 1 * *` | Itera clientes internamente — mantiene clientId |
| `report:monthly` | `0 6 2 * *` | Itera clientes internamente — necesitara iterar sites por cliente |
| `sync:cerebro` | `0 */6 * * *` | Global, sin cambios |

### Tipos de job data (queues.ts) — cambios necesarios

```typescript
// Agregar siteId a todos excepto sync
export interface RankTrackingJobData {
  clientId: string;
  siteId: string;    // NUEVO
  mode?: "priority" | "bulk";
}

export interface SeoAdvisorJobData {
  clientId: string;
  siteId: string;    // NUEVO
  force?: boolean;
}

export interface InsightsJobData {
  clientId: string;
  siteId: string;    // NUEVO
  trigger: "scheduled" | "audit_complete" | "backlink_alert" | "ranking_drop";
  priority?: "normal" | "high" | "urgent";
  context?: Record<string, unknown>;
}

// CrawlerJobData y BacklinksJobData YA tienen siteId
```

---

## 5. Rutas: estructura actual y propuesta

### Estructura actual

```
/clientes                              — Grid de clientes
/clientes/nuevo                        — Crear cliente
/clientes/[id]                         — Dashboard del cliente
/clientes/[id]/keywords                — Keywords
/clientes/[id]/audit                   — Audit tecnico
/clientes/[id]/backlinks               — Backlinks
/clientes/[id]/competencia             — Competidores
/clientes/[id]/oportunidades           — Oportunidades GSC
/clientes/[id]/terminos-busqueda       — Queries GSC
/clientes/[id]/trafico-paginas         — Paginas con trafico
/clientes/[id]/insights                — Insights AI
/clientes/[id]/insights/[insightId]    — Detalle de insight
/clientes/[id]/analisis                — Analisis Claude
/clientes/[id]/contenido               — Plan de contenido
/clientes/[id]/ai-search               — Visibilidad en AI
/clientes/[id]/aeo-research            — Research AEO/GEO
/clientes/[id]/reporte                 — Reporte mensual
/clientes/[id]/configuracion           — Config (keywords, competidores)
/clientes/[id]/timeline                — Timeline de eventos
/clientes/[id]/portapapeles            — Clipboard
/clientes/[id]/keyword-ideas           — Ideas de keywords
```

### Estructura propuesta

```
/clientes/[id]                         — Dashboard del cliente (resumen cross-site)
/clientes/[id]/configuracion           — Config global del cliente
/clientes/[id]/timeline                — Timeline cross-site
/clientes/[id]/portapapeles            — Clipboard

/clientes/[id]/p/[siteId]             — Dashboard del proyecto/site
/clientes/[id]/p/[siteId]/keywords
/clientes/[id]/p/[siteId]/audit
/clientes/[id]/p/[siteId]/backlinks
/clientes/[id]/p/[siteId]/competencia
/clientes/[id]/p/[siteId]/oportunidades
/clientes/[id]/p/[siteId]/terminos-busqueda
/clientes/[id]/p/[siteId]/trafico-paginas
/clientes/[id]/p/[siteId]/insights
/clientes/[id]/p/[siteId]/insights/[insightId]
/clientes/[id]/p/[siteId]/analisis
/clientes/[id]/p/[siteId]/contenido
/clientes/[id]/p/[siteId]/ai-search
/clientes/[id]/p/[siteId]/aeo-research
/clientes/[id]/p/[siteId]/reporte
/clientes/[id]/p/[siteId]/configuracion   — Config del site (GSC, GA4, keywords, competidores)
/clientes/[id]/p/[siteId]/keyword-ideas

/clientes/[id]/p/nuevo                — Wizard: agregar nuevo proyecto/site
```

### Layout anidado

```
/clientes/[id]/layout.tsx              — Sidebar con lista de sites + selector
/clientes/[id]/p/[siteId]/layout.tsx   — Valida siteId pertenece a clientId (RLS)
```

### Redirect automatico

Si un cliente tiene 1 solo site, `/clientes/[id]` redirige a `/clientes/[id]/p/[siteId]` automaticamente (comportamiento identico al actual).

### APIs internas

| Endpoint actual | Cambio |
|-----------------|--------|
| `GET /api/internal/recommendations/[clientId]` | Agregar `?siteId=...` query param |
| `POST /api/internal/advisor/regenerate/[clientId]` | Agregar `?siteId=...` query param |
| `GET /api/internal/cerebro/clients/[id]/monthly-summary` | Agregar `?siteId=...` query param |
| `POST /api/internal/diagnostico` | Sin cambios (ya recibe `domain`) |
| `GET /api/internal/constructor/metrics` | Ya recibe `ga4PropertyId` — sin cambios |

---

## 6. Agentes Claude: contexto y cambios

### 6.1 SEO Advisor (advisor-processor.ts + signals.ts + preconditions.ts)

**Contexto actual:**
- `buildProfileBlock(clientId)`: client.name, client.domain, cycle, priority keywords, competitors
- `collectSignals(clientId)`: backlinks perdidos, keywords dropped/near-top, keyword gaps, low-CTR pages (PageMetric via Site), audit issues, AEO research
- `checkPreconditions(clientId)`: keyword count, competitor count, ranking data, audit, site GSC

**Cambios para multi-site:**
- Todas las funciones reciben `siteId` como parametro adicional
- `buildProfileBlock`: usa `site.url` en vez de `client.domain`
- `collectSignals`: filtra Keyword, Backlink, CompetitorKeywordGap, AeoResearch por siteId
- `checkPreconditions`: filtra por siteId, busca Site por id (no findFirst por clientId)
- Redis keys cambian de `{clientId}` a `{siteId}`

### 6.2 Insights Agent (insights-processor.ts)

**Contexto actual:**
- Profile block (mensual): client, keywords (priority), competitors, cycle, hypotheses, insights existentes
- Trends block (diario): rankings summary, audit scores
- Trigger block: tipo de evento

**Cambios para multi-site:**
- Recibe `siteId` en job data
- Profile filtra keywords, competitors, insights por siteId
- Trends filtra rankings, audits por siteId
- Hypotheses y cycle siguen por clientId (son estrategicos)

### 6.3 Analisis Claude (claude-analysis.ts)

**Contexto actual (`gatherClientContext`):**
- Client meta, cycle, keywords (all + rankings), backlink snapshot, competitors, AI search, insights

**Cambios para multi-site:**
- `gatherClientContext(clientId, siteId)`
- Keywords, rankings, backlinks, competitors, AI search visibility filtran por siteId
- Cycle y hypotheses siguen por clientId

### 6.4 Content Plan (claude-content-plan.ts)

**Contexto actual (`gatherContentContext`):**
- Client, cycle, keywords (por posicion), keyword gaps, PageMetric (CTR bajo), competitors

**Cambios para multi-site:**
- Keywords, keyword gaps, PageMetric filtran por siteId
- Cycle sigue por clientId

### 6.5 Monthly Report (monthly-report.ts)

**Contexto actual (`gatherReportContext`):**
- Client, cycle, keywords + rankings (este mes vs anterior), backlink snapshots, AI search, insights

**Cambios para multi-site:**
- Todo excepto cycle filtra por siteId
- El reporte se genera **por site**, no por cliente

### Resumen de impacto en agentes

| Agente | Funciones afectadas | Esfuerzo |
|--------|---------------------|----------|
| SEO Advisor | 3 funciones + Redis keys | Medio |
| Insights Agent | 2 bloques de contexto + Redis keys | Medio |
| Analisis Claude | 1 funcion gather | Bajo-medio |
| Content Plan | 1 funcion gather | Bajo |
| Monthly Report | 1 funcion gather | Bajo |

---

## 7. Estrategia de migracion

### Paso 0: Backfill preparation

Antes de cualquier cambio de codigo:

```sql
-- Verificar que cada cliente tiene exactamente 1 site
SELECT c.id, c.name, COUNT(s.id) as site_count
FROM "Client" c
LEFT JOIN "Site" s ON s."clientId" = c.id
GROUP BY c.id, c.name
HAVING COUNT(s.id) != 1;
-- Debe retornar 0 rows
```

### Paso 1: Migracion de schema (1 sesion)

Agregar `siteId` nullable a los 14 modelos. **No rompe nada** — campo nuevo optional.

```prisma
model Keyword {
  // ... campos existentes ...
  siteId    String?
  site      Site?    @relation(fields: [siteId], references: [id])
}
```

Migracion: `prisma migrate dev --name add_site_id_to_models`

### Paso 2: Backfill siteId (1 sesion)

Script que para cada cliente con 1 site, puebla siteId en todos los registros huerfanos:

```typescript
const clients = await prisma.client.findMany({ include: { sites: true } });
for (const client of clients) {
  if (client.sites.length !== 1) continue;
  const siteId = client.sites[0].id;

  await prisma.$transaction([
    prisma.keyword.updateMany({ where: { clientId: client.id, siteId: null }, data: { siteId } }),
    prisma.competitor.updateMany({ where: { clientId: client.id, siteId: null }, data: { siteId } }),
    // ... 12 modelos mas ...
  ]);
}
```

### Paso 3: Hacer siteId requerido (1 sesion)

Despues de verificar que el backfill cubrio el 100%:

```prisma
model Keyword {
  siteId    String   // ahora requerido
  site      Site     @relation(fields: [siteId], references: [id])
}
```

Migracion: `prisma migrate dev --name make_site_id_required`

### Paso 4: Queries — migrar de clientId a clientId+siteId (2-3 sesiones)

Orden sugerido por riesgo:
1. **Providers/processors** (bajo riesgo, alto impacto): signals.ts, preconditions.ts, insights-processor.ts
2. **Agentes Claude** (medio riesgo): advisor-processor.ts, claude-analysis.ts, claude-content-plan.ts, monthly-report.ts
3. **Workers/schedulers** (medio riesgo): rank-tracking, backlinks, competitors, ai-search + schedulers.ts
4. **Pages/actions** (alto volumen): todas las pages y server actions de `/clientes/[id]/`

### Paso 5: Rutas — nueva estructura /p/[siteId] (2 sesiones)

1. Crear layout `/clientes/[id]/p/[siteId]/layout.tsx` con validacion RLS
2. Mover pages a la nueva estructura
3. Redirect automatico para clientes con 1 site
4. Site selector en sidebar

### Paso 6: Redis keys (1 sesion)

Cambiar todas las claves de `{clientId}` a `{siteId}`. Flush de Redis viejo post-deploy.

### Paso 7: APIs internas (1 sesion)

Agregar `siteId` query param a endpoints de recommendations, regenerate, monthly-summary.

### Riesgos

| Riesgo | Mitigacion |
|--------|------------|
| **RLS: datos de Site A visibles en Site B** | Validar siteId pertenece a clientId en layout.tsx (server-side). Todas las queries filtran por ambos. |
| **Caches de Redis con clientId viejo** | Flush completo de Redis despues del deploy de Paso 6. Los caches se regeneran en <25h. |
| **Jobs en vuelo durante deploy** | Los jobs data todavia tendran solo clientId. Workers deben hacer fallback: si no hay siteId en data, buscar el site unico del cliente. Eliminar fallback despues de 48h. |
| **Backfill incompleto** | Script de validacion post-backfill: `SELECT COUNT(*) FROM "Keyword" WHERE "siteId" IS NULL` para cada modelo. |
| **Ruta /clientes/[id]/ sin /p/[siteId]** | Redirect automatico al unico site. Si hay multiples, mostrar selector. |
| **APIs externas (Cerebro, Orquestador)** | Endpoints internos aceptan `siteId` como optional query param. Sin `siteId`, usan el site unico (backward compatible). |

### Estimacion de sesiones

| Paso | Sesiones | Dependencias |
|------|----------|--------------|
| Schema + backfill (pasos 1-3) | 1-2 | Ninguna |
| Queries processors/agentes (paso 4a-b) | 2 | Paso 3 |
| Workers/schedulers (paso 4c) | 1 | Paso 3 |
| Pages/actions (paso 4d) | 2 | Paso 3 |
| Rutas /p/[siteId] (paso 5) | 2 | Paso 4d |
| Redis + APIs (pasos 6-7) | 1 | Paso 4 |
| Wizard nuevo proyecto (paso 8) | 1-2 | Paso 5 |
| **Total** | **10-12 sesiones** | |

---

## 8. DataForSEO: stubs necesarios para wizard

### Metodos existentes (utiles para wizard)

| Metodo | Endpoint | Costo | Cache | Estado |
|--------|----------|-------|-------|--------|
| `getDomainRankOverview(domain)` | Labs: domain_rank_overview/live | $0.02 | 7d | Produccion |
| `getTopKeywords(domain, limit)` | Labs: ranked_keywords/live | $0.05 | 7d | Produccion |
| `getBacklinksSummary(domain)` | Backlinks: summary/live | $0.02 | 24h | Produccion |
| `getKeywordGaps(client, competitor)` | Labs: domain_intersection/live | $0.02 | 7d | Produccion |

### Stubs pendientes (necesarios para wizard)

| Metodo | Endpoint DataForSEO | Costo estimado | Estado actual |
|--------|---------------------|----------------|---------------|
| `getOrganicCompetitors(domain)` | `POST /dataforseo_labs/google/competitors_domain/live` | ~$0.02-0.05 | **Stub: throws "not implemented — Fase 3"** (linea 543) |
| `getCompetitorOverview(domain)` | `POST /dataforseo_labs/google/domain_rank_overview/live` | ~$0.02 | **Stub: throws "not implemented — Fase 3"** (linea 539) |
| `getKeywordSuggestions(seeds)` | Labs: keyword_suggestions/live | ~$0.025 | **Stub: throws "not implemented — Fase 2"** (linea 531) — pero `getKeywordIdeas()` ya cubre esto |
| `getKeywordVolume(keywords)` | Labs: search_volume/live | ~$0.02 | **Stub: throws "not implemented — Fase 2"** (linea 535) |

### Flujo del wizard de nuevo proyecto

```
1. Usuario ingresa dominio
2. getDomainRankOverview(domain)          → metricas basicas ($0.02)
3. getTopKeywords(domain, 20)             → keywords donde ya rankea ($0.05)
4. getOrganicCompetitors(domain)          → competidores sugeridos ($0.02-0.05)  [IMPLEMENTAR]
5. getBacklinksSummary(domain)            → perfil de backlinks ($0.02)
6. Usuario selecciona competidores
7. getKeywordGaps(domain, competitor) x N → gaps por competidor ($0.02 c/u)
```

**Costo total estimado del wizard: $0.13-0.19 por ejecucion** (asumiendo 2 competidores seleccionados).

### getOrganicCompetitors — implementacion sugerida

```typescript
async getOrganicCompetitors(
  domain: string,
  options?: { limit?: number; clientId?: string }
): Promise<OrganicCompetitor[]> {
  // POST /dataforseo_labs/google/competitors_domain/live
  // location_code: 2484 (Mexico)
  // language_name: "Spanish"
  // filters: ["relevant_serp_items", ">", 10]
  // limit: options.limit ?? 10
  // order_by: ["avg_position,asc"]
}

interface OrganicCompetitor {
  domain: string;
  avgPosition: number;
  serpCount: number;         // keywords compartidas
  intersections: number;     // keywords donde ambos rankean
  estimatedTraffic: number;
}
```

Cache: Redis 7 dias. Key: `cache:dataforseo:competitors:{domain}`

---

## Archivos analizados

### Schema y modelos
- `prisma/schema.prisma` — 22 modelos inventariados

### Queries Prisma (63 archivos)
- `src/server/jobs/workers/` — 9 archivos
- `src/server/jobs/processors/` — 3 archivos
- `src/lib/seo-advisor/` — 3 archivos
- `src/lib/` — 5 archivos (claude-analysis, claude-content-plan, monthly-report, cycle-close, aeo-classify)
- `src/app/(admin)/clientes/[id]/` — 20 archivos (actions + pages)
- `src/app/api/internal/` — 4 archivos

### Redis y BullMQ
- `src/lib/redis.ts`
- `src/server/jobs/queues.ts`
- `src/server/jobs/schedulers.ts`
- `src/server/jobs/init.ts`
- `src/server/providers/google-search-console.ts`
- `src/server/providers/google-analytics-4.ts`
- `src/server/providers/dataforseo.ts`

### DataForSEO
- `src/server/providers/dataforseo.ts` — 16 metodos (11 implementados, 5 stubs)
- `src/server/providers/seo-data.ts` — tipos
- `scripts/validate-dataforseo.ts` — validacion

---

## Hallazgos criticos

1. **`Site.findFirst({ where: { clientId } })` en ~15 archivos** — Esta es la asuncion 1:1 mas peligrosa. Con multiples sites, retornaria uno arbitrario. Cada instancia debe migrar a recibir `siteId` explicito.

2. **14 modelos necesitan `siteId`** — Es una migracion grande pero mecanica. El backfill es seguro porque hoy hay exactamente 1 site por cliente.

3. **Redis keys usan `clientId`** — 7 patrones de clave deben migrar. Requiere flush coordinado con deploy.

4. **Schedulers iteran por cliente, no por site** — Cuando un cliente tenga 2 sites, necesita 2 jobs de ranking, 2 audits, etc. El scheduler debe iterar `client.sites`.

5. **`getOrganicCompetitors` es el unico stub bloqueante para el wizard** — Sin el, el usuario tendria que ingresar competidores manualmente. Costo de implementacion: ~2h, costo API: ~$0.02-0.05 por dominio.

6. **Client.domain es redundante con Site.url** — En multi-proyecto, `client.domain` pierde sentido. Deberia deprecarse en favor de `site.url` / `site.domain`.

7. **RLS: no hay validacion server-side de que `siteId` pertenezca a `clientId`** — Hoy no importa (1:1), pero en multi-site es un vector de acceso cruzado. El layout de `/p/[siteId]` debe validar la pertenencia.
