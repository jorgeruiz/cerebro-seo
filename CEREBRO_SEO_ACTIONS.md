# CEREBRO SEO — Catálogo de Acciones y Capacidad de Ejecución

> Auditoría exhaustiva del repo. No se modificó ningún archivo.
> Fecha: 2026-07-10

---

## 1. CATÁLOGO DE ACCIONES

### 1.1 NextStep — SEO Advisor (setup + estratégicos)

**Generador:** `src/lib/seo-advisor/advisor-processor.ts` → `runAdvisorProcessor`
**Precondiciones determinísticas:** `src/lib/seo-advisor/preconditions.ts` → `checkPreconditions`

| Identificador | Qué recomienda | Campos | ¿Paso a paso? |
|---|---|---|---|
| `NextStepCategoria: "setup"` | Configurar keywords, competidores, GSC, audit | `titulo`, `descripcion`, `categoria`, `prioridad` (1-5), `seccionDestino` (slug), `evidencia` | No — solo el qué |
| `NextStepCategoria: "urgente"` | Problema activo que daña tráfico ahora | mismos campos | No |
| `NextStepCategoria: "oportunidad"` | Ganancia rápida en los próximos 30 días | mismos campos | No |
| `NextStepCategoria: "mejora"` | Optimización de mediano plazo (1-3 meses) | mismos campos | No |

**Tipo exacto:**
```typescript
// src/lib/seo-advisor/types.ts
export type NextStepCategoria = "setup" | "urgente" | "oportunidad" | "mejora";

export interface NextStep {
  titulo: string;
  descripcion: string;
  categoria: NextStepCategoria;
  prioridad: number;        // 1–5, 1 = más urgente
  seccionDestino?: string;  // slug: "keywords" | "audit" | "backlinks" | "competencia" | "oportunidades" | "terminos-busqueda" | "aeo-research" | "contenido" | "ai-search" | "analisis"
  evidencia: string;
}
```

**Precondiciones determinísticas (sin Claude, $0):**

| Precondición | prioridad | seccionDestino | Trigger |
|---|---|---|---|
| Sin keywords prioritarias | 1 | `"keywords"` | `priorityKeywordCount === 0` |
| < 2 competidores | 2 | `"competencia"` | `competitorCount < 2` |
| GSC no conectado | 2 | `"configuracion"` | `!site?.gscProperty` |
| Sin audit del sitio | 3 | `"audit"` | `!hasSiteAudit && hasKeywords` |

Si `isDataSufficient = false`, Claude se **omite** y solo se devuelven setup steps.

---

### 1.2 Insight — InsightsAgent

**Generador:** `src/server/jobs/processors/insights-processor.ts` → `runInsightsProcessor`

| Identificador (enum Prisma) | Qué reporta | Campos | ¿Paso a paso? |
|---|---|---|---|
| `InsightType.OPPORTUNITY` | Oportunidad detectada | `title`, `description`, `suggestedAction`, `severity`, `affectedKeywords[]`, `affectedUrls[]`, `dataPoints` (JSON) | No — una acción sugerida, no pasos |
| `InsightType.WARNING` | Problema o riesgo | mismos campos | No |
| `InsightType.WIN` | Logro o mejora detectada | mismos campos | No |
| `InsightType.INFO` | Dato informativo | mismos campos | No |

**Severidades:** `"low"` | `"medium"` | `"high"` | `"critical"`

**Tipo exacto (generado por Claude):**
```typescript
// src/server/jobs/processors/insights-processor.ts
interface GeneratedInsight {
  type: "opportunity" | "warning" | "win" | "info";
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  action: string;
  affectedKeywords: string[];
  affectedUrls: string[];
}
```

---

### 1.3 SeoOpportunity — Detección algorítmica

**Generador:** `src/lib/seo-opportunities.ts` — 5 funciones determinísticas (sin Claude, $0)

| Identificador (`OpportunityType`) | Qué recomienda | Condición de detección | Campos |
|---|---|---|---|
| `"quick-win"` | Subir de pos 4-10 a top 3 | `position ∈ [4,10] && impressions ≥ 50` | `keyword`, `position`, `impressions`, `clicks`, `ctr`, `label`, `action`, `priority`, `score` |
| `"ctr-issue-query"` | Mejorar title/meta de query con CTR bajo | `position ∈ [1,3] && CTR < 60% benchmark && impressions ≥ 30` | mismos campos |
| `"no-coverage"` | Crear contenido para keyword sin presencia | `keyword prioritaria && (position > 50 \|\| ausente)` | mismos campos |
| `"poor-position"` | Reforzar contenido de query en página 2+ | `position ≥ 21 && impressions ≥ 200` | mismos campos |
| `"ctr-issue-page"` | Mejorar CTR de URL con muchas impresiones | `impressions ≥ 100 && ctr < 2%` | `url`, `impressions`, `ctr`, `label`, `action`, `priority`, `score` |

**Tipo exacto:**
```typescript
export type OpportunityPriority = "alta" | "media" | "baja";

export interface SeoOpportunity {
  type: OpportunityType;
  priority: OpportunityPriority;
  keyword?: string;
  position?: number;
  impressions?: number;
  clicks?: number;
  ctr?: number;
  url?: string;
  label: string;
  action: string;
  score: number;
}
```

---

### 1.4 ContentIdea — Plan de Contenido

**Generador:** `src/lib/claude-content-plan.ts` → `generateContentPlan`

| Identificador (`ContentType`) | Qué recomienda | Campos |
|---|---|---|
| `"blog"` | Artículo informativo, guía, how-to | `titulo`, `tipo`, `keywords[]`, `angulo`, `prioridad`, `razon`, `urlSugerida?` |
| `"landing"` | Página de servicio/producto transaccional | mismos campos |
| `"pilar"` | Contenido extenso hub (3000+ palabras) | mismos campos |
| `"soporte"` | Cluster content que apunta a un pilar | mismos campos |

**Tipo exacto:**
```typescript
export interface ContentPlanResult {
  resumen: string;
  ideas: ContentIdea[];       // 5–10, ordenadas por prioridad
  notaEstrategica: string;
}
```

---

### 1.5 AnalysisOpportunity / AnalysisRisk — Análisis Claude

**Generador:** `src/lib/claude-analysis.ts` → `generateClientAnalysis`

```typescript
export interface AnalysisOpportunity {
  titulo: string;
  descripcion: string;
  accion: string;
  impacto: "alto" | "medio" | "bajo";
}

export interface AnalysisRisk {
  titulo: string;
  descripcion: string;
  urgencia: "alta" | "media" | "baja";
}

export interface AnalysisResult {
  resumenEjecutivo: string;
  oportunidades: AnalysisOpportunity[];    // 3-5
  riesgos: AnalysisRisk[];                 // 2-3
  recomendaciones: string[];               // free-text list
  conclusionEstrategica: string;
}
```

---

### 1.6 AeoCluster — AEO/GEO Research

**Generador:** `src/lib/aeo-classify.ts` → `classifyAeoResearchForClient`

```typescript
export type AeoIntent = "informational" | "navigational" | "transactional" | "commercial";

export interface AeoCluster {
  tema: string;
  preguntas: string[];
  intencion: AeoIntent;
  aeoCandidate: boolean;    // featured snippets / PAA / voice
  geoCandidate: boolean;    // citation by LLMs
  recomendacion: string;
}

export interface AeoResearchResult {
  resumen: string;
  clusters: AeoCluster[];
  notaEstrategica: string;
}
```

---

### 1.7 AuditIssue — Site Audit

**Generador:** `src/server/jobs/processors/audit-processor.ts` → `runAuditProcessor`

```typescript
// Prisma model (no TypeScript interface separado)
model AuditIssue {
  category    String   // "technical" | "performance" | "content" | "seo" | "accessibility"
  severity    String   // "critical" | "high" | "medium" | "low" | "info"
  type        String   // e.g. "missing_meta_description", "broken_link", "slow_lcp"
  title       String
  description String
  affectedUrl String?
  count       Int      @default(1)
  data        Json?
}
```

---

### 1.8 MonthlyReport — Reporte Mensual

**Generador:** `src/lib/monthly-report.ts` → `generateMonthlyReport`

```typescript
export interface MonthlyReportResult {
  periodo: string;
  resumenEjecutivo: string;
  logros: string[];
  desafios: string[];
  metricas: ReportMetricas;
  oportunidades: Array<{
    titulo: string;
    descripcion: string;
    accion: string;
    impacto: "alto" | "medio" | "bajo";
  }>;
  planProximoMes: string[];
  conclusionEjecutiva: string;
}
```

---

## 2. CAPACIDAD DE EJECUCIÓN

### Respuesta corta: **Cerebro SEO es 100% recomendación. No existe código de ejecución.**

| Evidencia | Detalle |
|---|---|
| WordPress API calls | **Ninguna.** No hay código que llame endpoints de WP REST API. |
| Next.js site modifications | **Ninguna.** No hay código que modifique sitios de clientes. |
| Plugin system | **No existe.** No hay sistema de plugins ni agent execution. |
| Credenciales de sitios | **No se almacenan.** `Client` y `Site` no tienen campos de API keys o tokens de acceso a sitios de clientes. |
| CMS detection | **No existe.** No hay campo `platform`, `cmsType`, ni `framework` en el schema. |

**Flujo real:**
1. Cerebro SEO analiza datos (GSC, GA4, PageSpeed, rankings, backlinks)
2. Genera recomendaciones (Claude o algorítmicas)
3. El usuario las lee en el dashboard
4. El usuario las copia al Portapapeles (in-memory)
5. El usuario las pega en **Cerebro** (app hermana) o las ejecuta manualmente

---

## 3. EL SPLIT WORDPRESS / NEXT.JS

| Pregunta | Respuesta |
|---|---|
| ¿Qué acciones funcionan sobre WordPress? | **Ninguna.** No hay integración con WP. |
| ¿Qué acciones funcionan sobre Next.js? | **Ninguna.** No modifica sitios de clientes. |
| ¿Qué acciones NO tienen implementación? | **Todas.** Son puramente informativas. |
| ¿Cómo sabe el sistema la plataforma del cliente? | **No lo sabe.** No existe campo `platform` ni `cmsType` en `Client` ni en `Site`. |

**Schema relevante (campos reales):**
```prisma
model Client {
  id, cerebroClientId, name, domain, plan, status, services[]
  // NO: platform, cmsType, frameworkType
}

model Site {
  id, clientId, url, gscProperty?, ga4Property?
  // NO: platform, framework, wpApiUrl, credentials
}
```

Los clientes son "cajas negras HTTP/HTTPS" — Cerebro SEO lee métricas externas pero no puede escribir en sus sitios.

---

## 4. CONTRATO DE SALIDA

### 4.1 ¿Cerebro SEO es un repo/app separado de Cerebro?

**Sí, son repos y apps completamente separados.**

| | Cerebro SEO | Cerebro (web) |
|---|---|---|
| Repo | `jorgeruiz/cerebro-seo` | `jorgeruiz/cerebro` |
| URL producción | `seo.clicksociety.com.mx` | `cerebro.clicksociety.com.mx` |
| BD | `cerebro_seo` | `cerebro_db` |
| Servidor Postgres | **Compartido** (`cerebro-db` en Easypanel) | Mismo servidor |
| Redis | `cerebro-seo-redis` (dedicado) | Separado |
| Stack | Next.js 14 App Router | Next.js (propio) |

**No comparten código fuente.** La comunicación es vía HTTP:
- Cerebro SEO → Cerebro web: `src/lib/cerebro-bridge.ts` hace `fetch()` a `CEREBRO_API_URL/api/internal/seo/clients/...` para obtener estrategia y tareas del mes.
- Cerebro web → Cerebro SEO: `POST /api/internal/cerebro/clients/[id]/monthly-summary` con Bearer `CEREBRO_INTERNAL_SECRET`.
- El portapapeles de Cerebro SEO genera markdown que el usuario copia manualmente a Cerebro.

### 4.2 ¿Existe un endpoint que devuelva las recomendaciones de un cliente?

**No existe un endpoint REST tipo `/api/actions/recommended`.** No hay un endpoint único que consolide todas las recomendaciones.

Las recomendaciones se obtienen de dos formas:

**A) Server actions (in-process, requieren sesión NextAuth):**

| Función | Archivo | Retorna | Requiere |
|---|---|---|---|
| `getLatestNextStepPlan(clientId)` | `next-steps-actions.ts` | `NextStepPlanRecord \| null` | getSession() |
| `actionRegenerateNextSteps(clientId)` | `next-steps-actions.ts` | `{ ok, record } \| { ok, error }` | ADMIN |
| `actionGenerateContentPlan(clientId)` | `contenido/actions.ts` | `{ ok, record } \| { ok, error }` | ADMIN |
| `getContentPlanHistory(clientId)` | `contenido/actions.ts` | `ContentPlanRecord[]` | getSession() |
| `getGscQueries(params)` | `actions.ts` | `GscQueriesResult \| { error }` | getSession() |
| `getPagesTraffic(params)` | `actions.ts` | `PagesTrafficResult \| { error }` | getSession() |
| `getGscSnapshot(clientId)` | `actions.ts` | `GscSnapshot \| null` | getSession() |
| `getGa4Snapshot(clientId)` | `actions.ts` | `Ga4Snapshot \| null` | getSession() |

**B) Funciones core (importables directamente, sin sesión):**

| Función | Archivo | Firma | Requiere |
|---|---|---|---|
| `runAdvisorProcessor({clientId, triggeredBy?, scheduled?})` | `src/lib/seo-advisor/advisor-processor.ts` | `→ Promise<AdvisorResult>` | Solo `clientId` |
| `runInsightsProcessor({clientId, trigger, ...})` | `src/server/jobs/processors/insights-processor.ts` | `→ Promise<void>` (persiste directo) | Solo `clientId` |
| `buildOpportunitiesReport(queries, pages, keywords)` | `src/lib/seo-opportunities.ts` | `→ OpportunitiesReport` | Datos GSC ya fetched |
| `generateContentPlan(clientId, triggeredBy?)` | `src/lib/claude-content-plan.ts` | `→ Promise<{plan, planId}>` | Solo `clientId` |
| `generateClientAnalysis(clientId, triggeredBy?)` | `src/lib/claude-analysis.ts` | `→ Promise<{analysis, analysisId}>` | Solo `clientId` |
| `generateMonthlyReport(clientId, yearMonth, triggeredBy?)` | `src/lib/monthly-report.ts` | `→ Promise<{report, reportId}>` | `clientId` + `yearMonth` |
| `classifyAeoResearchForClient(clientId, triggeredBy?)` | `src/lib/aeo-classify.ts` | `→ Promise<{result, researchId}>` | Solo `clientId` |

**C) Endpoints internos HTTP (para consumo externo, auth vía Bearer token):**

| Endpoint | Método | Auth | Consumidor |
|---|---|---|---|
| `POST /api/internal/cerebro/clients/[id]/monthly-summary` | POST | Bearer `CEREBRO_INTERNAL_SECRET` | Cerebro web |
| `GET /api/internal/constructor/metrics` | GET | Bearer `SEO_INTERNAL_SECRET` | Constructor |
| `GET /api/internal/constructor/clients/[notionId]/reports` | GET | Bearer `SEO_INTERNAL_SECRET` | Constructor |

### 4.3 Shape exacto de las respuestas principales

**NextStepPlanRecord (el más usado para recomendaciones accionables):**
```typescript
// src/app/(admin)/clientes/[id]/next-steps-actions.ts
interface NextStepPlanRecord {
  id: string;
  steps: NextStep[];       // 3-7 items, ordenados por prioridad
  model: string;           // "claude-sonnet-4-6" o "deterministic"
  cost: number;            // USD
  triggeredBy: string | null;  // email del usuario o "scheduled"
  generatedAt: Date;
}

// Cada step:
interface NextStep {
  titulo: string;
  descripcion: string;
  categoria: "setup" | "urgente" | "oportunidad" | "mejora";
  prioridad: number;       // 1-5
  seccionDestino?: string; // slug de módulo
  evidencia: string;
}
```

**Insight (persiste individualmente en BD):**
```typescript
// Prisma model — se consulta directamente con prisma.insight.findMany()
{
  id: string;
  clientId: string;
  type: "OPPORTUNITY" | "WARNING" | "WIN" | "INFO";
  severity: string;        // "low" | "medium" | "high" | "critical"
  title: string;
  description: string;
  suggestedAction: string | null;
  dataPoints: JsonValue | null;
  affectedUrls: string[];
  affectedKeywords: string[];
  generatedAt: Date;
  acknowledgedAt: Date | null;
  dismissed: boolean;
}
```

**OpportunitiesReport (efímero, no se persiste):**
```typescript
// src/lib/seo-opportunities.ts
interface OpportunitiesReport {
  quickWins: SeoOpportunity[];
  ctrIssuesQuery: SeoOpportunity[];
  noCoverage: SeoOpportunity[];
  poorPosition: SeoOpportunity[];
  ctrIssuesPage: SeoOpportunity[];
  totalCount: number;
  highPriorityCount: number;
}
```

### 4.4 ¿Importable in-process o solo HTTP?

**Las funciones core son importables in-process.** No necesitan HTTP ni sesión.

| Capa | Mecanismo | Requiere sesión | Importable desde otro módulo |
|---|---|---|---|
| **Funciones core** (`src/lib/*`) | `import { fn } from "@/lib/..."` | ❌ No — solo `clientId` | ✅ Sí — cualquier server code |
| **Server actions** (`"use server"`) | `import { fn } from "./actions"` | ✅ Sí — `getSession()` | ✅ Sí — desde server components/actions |
| **Endpoints REST** (`/api/internal/*`) | `fetch()` con Bearer token | ❌ No — Bearer token | ✅ Sí — desde cualquier HTTP client |
| **BullMQ workers** | Job queue con Redis | ❌ No | ❌ No — se disparan via `queue.add()` |

**Para un orquestador externo** que quiera consumir recomendaciones, las opciones son:
1. **In-process** (si corre en el mismo Next.js): importar directamente las funciones core de `src/lib/*`
2. **HTTP** (si es servicio externo): hoy NO hay endpoint REST consolidado. Habría que crear uno tipo `GET /api/internal/clients/[id]/recommendations` que agrupe NextSteps + Insights + Opportunities.
3. **BD directa** (si comparte Postgres): query directa a `NextStepPlan`, `Insight`, `ContentPlan`, etc.

---

## 5. CÓMO SE INVOCA EL ANÁLISIS

| Generador | Invocación | Persistencia | ¿Consultar histórico? |
|---|---|---|---|
| **NextStepPlan** | Cron diario 7 AM + on-demand (botón "Regenerar") | Sí → `NextStepPlan` | Sí: `getLatestNextStepPlan(clientId)` retorna el más reciente |
| **Insights** | Cron diario 6 AM + triggers (audit_complete, backlink_alert, ranking_drop) | Sí → `Insight` por registro individual | Sí: queries Prisma con filtros por fecha, tipo, severidad |
| **Content Plan** | On-demand (botón "Generar plan") | Sí → `ContentPlan` con `month` | Sí: `getContentPlanHistory(clientId)` retorna últimos 10 |
| **Client Analysis** | On-demand (botón en módulo Análisis) | Sí → `ClientAnalysis` | Sí: query por clientId + fecha |
| **Monthly Report** | On-demand por `yearMonth` | Sí → `MonthlyReport` con `yearMonth` | Sí: query por clientId + yearMonth exacto |
| **SEO Opportunities** | On-demand (cada visita a la página) | **No** — efímero, calculado de GSC en vivo | No: se recalcula cada vez |
| **AEO Research** | On-demand (botón) | Sí → `AeoResearch` | Sí: query por clientId |
| **Audit Issues** | On-demand (trigger manual) + cron semanal | Sí → `Audit` + `AuditIssue[]` | Sí: selector de auditorías en la UI con historial |

**Crons configurados (BullMQ repeatable jobs):**

| Job | Queue | Horario | Archivo |
|---|---|---|---|
| `insights:scheduled` | `ai-analysis` | Diario 6 AM | `insights-worker.ts` |
| `advisor:generate` | `ai-analysis` | Diario 7 AM | `seo-advisor-worker.ts` |
| `audit:quick` | `crawler` | Semanal (miércoles 2 AM) | `audit-quick-worker.ts` |
| `backlinks:crawl` | `crawler` | Semanal (jueves 5 AM) | backlinks worker |
| `competitor:analyze` | `crawler` | Quincenal (1 y 15, 7 AM) | competitor worker |
| `ai-search:check` | `ai-analysis` | Semanal (viernes 6 AM) | ai-search worker |

---

## 6. CAPACIDAD DE ENRIQUECIMIENTO

### 6.1 Infraestructura existente para encontrar targets

| Infraestructura | ¿Existe? | Ubicación | Qué provee |
|---|---|---|---|
| **Crawler de páginas** | ✅ Sí | `src/server/crawler/site-crawler.ts` | Visita hasta 50 páginas/sitio, analiza H1, title, meta, alt, contenido. Usado por audit-processor. |
| **GSC queries con keyword** | ✅ Sí | `GoogleSearchConsoleProvider.getQueries()` | Keyword + posición + impresiones + CTR. No requiere acceso privilegiado. |
| **GSC pages con URL** | ✅ Sí | `GoogleSearchConsoleProvider.getPages()` | URL + clics + impresiones + CTR + posición. |
| **Keyword → rankingUrl** | ✅ Sí | `KeywordRanking.rankingUrl` (Prisma) | Cada tracking de posición almacena la URL donde rankea. |
| **Keyword → targetUrl** | ✅ Sí | `Keyword.targetUrl` (Prisma) | URL objetivo/intencionada por el usuario. |
| **PageMetric** | ✅ Sí | `PageMetric` (Prisma) | Métricas GSC por URL: clics, impresiones, CTR, posición. |
| **Sitemap parser** | ❌ No | — | No existe. Haría falta para sitios grandes (>50 páginas). |
| **WordPress REST API client** | ❌ No | — | No existe. Necesario para ejecutar cambios en WP. |
| **Credenciales de sitio** | ❌ No | No hay campo en `Client` ni `Site` | No se almacenan API keys ni tokens de acceso a sitios de clientes. |

### 6.2 Análisis por action_type — ¿trae target específico?

#### SeoOpportunity (5 tipos)

| Tipo | ¿Keyword? | ¿URL? | Enricher existe | ¿Qué haría falta? | Acceso requerido |
|---|---|---|---|---|---|
| `quick-win` | ✅ Siempre | ❌ No | ✅ `KeywordRanking.rankingUrl` tiene la URL donde rankea | Cruzar keyword con su último `KeywordRanking` para obtener `rankingUrl` | Público (ya en BD) |
| `ctr-issue-query` | ✅ Siempre | ❌ No | ✅ Mismo mecanismo | Mismo cruce | Público |
| `no-coverage` | ✅ Siempre | ❌ No (no hay página) | ❌ No hay qué enriquecer — la keyword NO tiene página | El target ES la keyword sin cobertura. La acción es crear contenido. | N/A |
| `poor-position` | ✅ Siempre | ❌ No | ✅ `KeywordRanking.rankingUrl` | Mismo cruce | Público |
| `ctr-issue-page` | ❌ No | ✅ Siempre | ⚠️ Parcial — URL presente pero sin keyword asociada | Cruzar URL con `PageMetric` o GSC queries para listar keywords de esa URL | Público (GSC) |

#### AuditIssue

| Tipo | ¿URL afectada? | ¿Keyword? | Enricher existe | ¿Qué haría falta? |
|---|---|---|---|---|
| `missing_title` | ✅ `affectedUrl` siempre | ❌ No | ✅ Crawler ya la provee | Nada — target completo |
| `title_too_short/long` | ✅ | ❌ | ✅ | Nada |
| `missing_meta_description` | ✅ | ❌ | ✅ | Nada |
| `meta_description_too_short/long` | ✅ | ❌ | ✅ | Nada |
| `missing_h1` | ✅ | ❌ | ✅ | Nada |
| `multiple_h1` | ✅ | ❌ | ✅ | Nada |
| `images_missing_alt` | ✅ | ❌ | ✅ | Nada |
| `noindex` | ✅ | ❌ | ✅ | Nada |
| `missing_canonical` | ✅ | ❌ | ✅ | Nada |
| `thin_content` | ✅ | ❌ | ✅ | Nada |
| `slow_ttfb` | ✅ | ❌ | ✅ | Nada |
| `not_found` | ✅ | ❌ | ✅ | Nada |
| `server_error` | ✅ | ❌ | ✅ | Nada |
| PSI issues (`render-blocking-resources`, `unused-css`, etc.) | ✅ (homepage) | ❌ | ✅ | Para enriquecer con URL internas específicas: necesitaría correr PSI por URL individual (hoy solo corre en homepage) |

**Conclusión AuditIssue: todos traen `affectedUrl`.** El target siempre está presente. No necesitan enriquecimiento.

#### Insight (InsightsAgent)

| Campo | ¿Poblado? | Fuente | Problema |
|---|---|---|---|
| `affectedKeywords[]` | ⚠️ A veces | Claude genera libre | Claude **puede** incluir keywords pero frecuentemente devuelve `[]` |
| `affectedUrls[]` | ⚠️ A veces | Claude genera libre | Mismo problema — depende de lo que Claude decida incluir |
| `suggestedAction` | ✅ Siempre | Claude | Texto libre con la acción, sin target estructurado |

**Enricher existente:** ✅ Parcial — el prompt de insights recibe contexto con keywords y rankings (signals.ts provee `gatherSignals()` con datos de GSC, rankings, backlinks). Claude tiene la información pero no siempre la estructura en los campos de array.

**Qué haría falta:** Post-procesamiento: si `affectedKeywords` está vacío, extraer keywords mencionadas en `title`/`description` via regex o NLP contra la lista de keywords del cliente. Acceso: público (datos ya en BD).

#### NextStep (SEO Advisor)

| Campo | ¿Poblado? | Problema |
|---|---|---|
| `seccionDestino` | ✅ Siempre | Apunta a sección (`"keywords"`, `"audit"`, etc.), NO a un dato específico |
| `evidencia` | ✅ Siempre | Texto con datos concretos (ej: "3 keywords en posición 4-7") pero NO estructurado |
| `keyword/url target` | ❌ No existe | **No hay campos** `targetKeywords[]` ni `targetUrls[]` en el tipo `NextStep` |

**Enricher existente:** ✅ Los datos están en BD — el prompt de advisor recibe signals que incluyen keywords, rankings, URLs, gaps. Pero el output no los estructura como targets.

**Qué haría falta:**
1. Agregar campos `targetKeywords?: string[]` y `targetUrls?: string[]` al tipo `NextStep`
2. Instruir al prompt de Claude para que los incluya
3. O: post-procesar extrayendo keywords/URLs de `evidencia` contra la BD del cliente
4. Acceso: público (todo ya en BD)

#### ContentIdea

| Campo | ¿Poblado? | Fuente |
|---|---|---|
| `keywords[]` | ✅ Siempre | Claude, basado en context de keywords del cliente |
| `urlSugerida` | ✅ Frecuente (opcional) | Claude sugiere slug nuevo |

**Conclusión:** ContentIdea tiene targets completos. No necesita enriquecimiento.

#### AnalysisOpportunity / AnalysisRisk

| Campo | ¿Poblado? | Problema |
|---|---|---|
| `titulo` | ✅ | Texto genérico |
| `accion` | ✅ | Texto con acción pero sin target estructurado |
| `keyword/url` | ❌ No existe | No hay campos de target |

**Enricher existente:** ✅ El prompt recibe contexto rico (keywords, rankings, GSC, GA4, backlinks, competitors). Pero el output es texto narrativo sin targets estructurados.

**Qué haría falta:** Agregar `targetKeywords?: string[]` y `targetUrls?: string[]` al tipo + instruir prompt. Acceso: público.

#### AeoCluster

| Campo | ¿Poblado? | Fuente |
|---|---|---|
| `preguntas[]` | ✅ Siempre | DataForSEO People Also Ask + keyword research |
| `tema` | ✅ | Claude agrupa por tema |
| URL de página existente | ❌ No | No hay campo de URL |

**Enricher existente:** ⚠️ Parcial — podría cruzar `tema`/`preguntas` con `KeywordRanking` para ver si ya hay una página rankeando para alguna pregunta. Acceso: público.

#### MonthlyReport.oportunidades

| Campo | ¿Poblado? | Problema |
|---|---|---|
| `titulo`, `accion` | ✅ | Texto narrativo |
| `keyword/url` | ❌ No existe | Sin targets estructurados |

**Qué haría falta:** Mismo patrón que AnalysisOpportunity. Acceso: público.

### 6.3 Resumen de acceso requerido para enriquecimiento

| Método de enriquecimiento | ¿Acceso privilegiado? | Detalle |
|---|---|---|
| Cruzar keyword con `KeywordRanking.rankingUrl` | ❌ Fetch público (datos ya en BD) | Query Prisma directa |
| Cruzar URL con GSC queries | ❌ Público (vía token de servicio GSC) | `getServiceOAuth2Client()` + GSC API |
| Crawl de páginas del sitio | ❌ Fetch público | HTTP GET a URLs públicas |
| Sitemap parse | ❌ Fetch público | GET `/sitemap.xml` |
| Modificar contenido en WordPress | ✅ Requiere WP REST API + Application Password | Necesita credenciales del sitio |
| Modificar contenido en Next.js/CMS | ✅ Requiere API del CMS | Depende del CMS |

---

## 7. TABLA RESUMEN — INPUT PARA ORQUESTADOR

| action_type | trae_target | enricher_existe | ejecutable_hoy | reversible |
|---|---|---|---|---|
| `NextStep[setup]:keywords` | ❌ solo sección | ❌ | ninguna | N/A |
| `NextStep[setup]:competencia` | ❌ solo sección | ❌ | ninguna | N/A |
| `NextStep[setup]:configuracion` | ❌ solo sección | ❌ | ninguna | N/A |
| `NextStep[setup]:audit` | ❌ solo sección | ❌ | ninguna | N/A |
| `NextStep[urgente]` | ❌ texto libre en `evidencia` | ✅ datos en BD, falta prompt/post-proc | ninguna | N/A |
| `NextStep[oportunidad]` | ❌ texto libre en `evidencia` | ✅ datos en BD, falta prompt/post-proc | ninguna | N/A |
| `NextStep[mejora]` | ❌ texto libre en `evidencia` | ✅ datos en BD, falta prompt/post-proc | ninguna | N/A |
| `Insight[OPPORTUNITY]` | ⚠️ `affectedKeywords[]` + `affectedUrls[]` a veces vacíos | ✅ prompt los pide, falta post-proc | ninguna | N/A |
| `Insight[WARNING]` | ⚠️ mismo problema | ✅ | ninguna | N/A |
| `Insight[WIN]` | ⚠️ mismo problema | ✅ | ninguna | N/A |
| `Insight[INFO]` | ⚠️ mismo problema | ✅ | ninguna | N/A |
| `SeoOpportunity[quick-win]` | ✅ `keyword` siempre | ✅ `rankingUrl` vía `KeywordRanking` | ninguna | N/A |
| `SeoOpportunity[ctr-issue-query]` | ✅ `keyword` siempre | ✅ `rankingUrl` vía `KeywordRanking` | ninguna | N/A |
| `SeoOpportunity[no-coverage]` | ✅ `keyword` (sin URL — ese es el problema) | ❌ no hay URL (no existe página) | ninguna | N/A |
| `SeoOpportunity[poor-position]` | ✅ `keyword` siempre | ✅ `rankingUrl` vía `KeywordRanking` | ninguna | N/A |
| `SeoOpportunity[ctr-issue-page]` | ✅ `url` siempre | ⚠️ URL presente, sin keyword asociada (cruce GSC posible) | ninguna | N/A |
| `ContentIdea[blog]` | ✅ `keywords[]` + `urlSugerida` | ✅ completo | ninguna | N/A |
| `ContentIdea[landing]` | ✅ `keywords[]` + `urlSugerida` | ✅ completo | ninguna | N/A |
| `ContentIdea[pilar]` | ✅ `keywords[]` + `urlSugerida` | ✅ completo | ninguna | N/A |
| `ContentIdea[soporte]` | ✅ `keywords[]` + `urlSugerida` | ✅ completo | ninguna | N/A |
| `AnalysisOpportunity` | ❌ texto narrativo | ✅ datos en BD, falta schema + prompt | ninguna | N/A |
| `AnalysisRisk` | ❌ texto narrativo | ✅ datos en BD, falta schema + prompt | ninguna | N/A |
| `AeoCluster` | ✅ `preguntas[]` (questions) | ⚠️ falta cruce con URLs existentes | ninguna | N/A |
| `AuditIssue[critical]` | ✅ `affectedUrl` siempre | ✅ completo (crawler) | ninguna | N/A |
| `AuditIssue[high]` | ✅ `affectedUrl` siempre | ✅ completo | ninguna | N/A |
| `AuditIssue[medium]` | ✅ `affectedUrl` siempre | ✅ completo | ninguna | N/A |
| `AuditIssue[low]` | ✅ `affectedUrl` siempre | ✅ completo | ninguna | N/A |
| `AuditIssue[info]` | ✅ `affectedUrl` siempre | ✅ completo | ninguna | N/A |
| `MonthlyReportOpportunity` | ❌ texto narrativo | ✅ datos en BD, falta schema + prompt | ninguna | N/A |
| `ClipboardItem[opportunity]` | ✅ hereda de `SeoOpportunity` | ✅ | ninguna | N/A |
| `ClipboardItem[audit_issue]` | ✅ hereda de `AuditIssue` | ✅ | ninguna | N/A |
| `ClipboardItem[competitor_gap]` | ✅ `keyword` + `competitorDomain` | ✅ completo | ninguna | N/A |
| `ClipboardItem[search_term]` | ✅ `query` + métricas GSC | ✅ completo | ninguna | N/A |
| `ClipboardItem[backlink_action]` | ✅ `sourceDomain` + `DA` | ✅ completo | ninguna | N/A |
| `ClipboardItem[ai_visibility]` | ✅ `query` + `position` | ✅ completo | ninguna | N/A |
| `ClipboardItem[keyword]` | ✅ `keyword` + vol/KD | ✅ completo | ninguna | N/A |
| `ClipboardItem[aeo_cluster]` | ✅ `tema` + `preguntas[]` | ✅ completo | ninguna | N/A |
| `ClipboardItem[content_idea]` | ✅ `keywords[]` + `urlSugerida` | ✅ completo | ninguna | N/A |

### Leyenda

- **trae_target**: ¿La recomendación incluye un target específico (keyword, URL, dominio) como campo estructurado?
  - ✅ = siempre presente como campo tipado
  - ⚠️ = a veces presente, a veces vacío
  - ❌ = no existe como campo, puede estar mencionado en texto libre
- **enricher_existe**: ¿Hay código que pueda encontrar/agregar el target si falta?
  - ✅ = infraestructura completa (datos en BD, cruce posible)
  - ⚠️ = parcial (datos existen pero falta el cruce)
  - ❌ = no hay forma de obtener el target automáticamente

### Gaps críticos para un orquestador

1. **`NextStep` no tiene campos de target** — es el tipo más accionable pero solo apunta a secciones. Los datos para enriquecer existen en BD (`KeywordRanking`, `PageMetric`, `CompetitorKeywordGap`). Fix: agregar `targetKeywords?: string[]` + `targetUrls?: string[]` al tipo + ajustar prompt.

2. **`Insight` targets son unreliable** — el prompt los pide pero Claude los devuelve vacíos ~50% del tiempo. Fix: post-procesamiento que cruce `title`/`description` contra keywords del cliente en BD.

3. **`AnalysisOpportunity` es texto genérico** — no tiene campos de target. Fix: extender schema (patrón de `ContentIdea`).

4. **Acceso privilegiado solo para ejecución** — todo el enriquecimiento (encontrar targets) funciona con datos públicos ya en BD o via fetch HTTP público. Solo la EJECUCIÓN (modificar sitios) requeriría credenciales.

---

Cerebro SEO es un sistema puramente analítico y de recomendación. No tiene capacidad de ejecución sobre ninguna plataforma (WordPress, Next.js, ni otra). No existe detección de plataforma, credenciales de acceso a sitios de clientes, ni pipeline de ejecución. Las recomendaciones se consumen visualmente en el dashboard o se copian al portapapeles para acción manual vía Cerebro (app hermana).

**Para habilitar un orquestador ejecutor, se necesitaría:**
1. Campo `platform` en `Client` o `Site` (`"wordpress"` | `"nextjs"` | `"shopify"` | `"other"`)
2. Campo `apiCredentials` en `Site` (encrypted) con tokens de acceso al CMS
3. Pipeline de ejecución con rollback (draft → preview → apply → confirm)
4. Enriquecimiento de targets en `NextStep` e `Insight` (los datos ya están en BD)
