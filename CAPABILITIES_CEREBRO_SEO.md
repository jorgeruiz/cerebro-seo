# CAPABILITIES_CEREBRO_SEO.md

Auditoria completa del repositorio `cerebro-seo`.
Generado: 2026-07-23.

---

## PARTE 1 — CAPACIDADES QUE ESTE REPO EJECUTA (escritura/modificacion)

### 1.1 Crear cliente

| Campo | Valor |
|---|---|
| **Funcion** | `clientesRouter.crear` (`src/server/trpc/routers/clientes.ts:8`) |
| **Endpoint duplicado** | `POST /api/clientes` (`src/app/api/clientes/route.ts:20`) — temporal, migrar a tRPC |
| **Sistema externo** | PostgreSQL propia (tabla `Client`, `Site`, `Keyword`, `Competitor`) |
| **Invocable desde afuera** | tRPC (UI interna) + REST endpoint (API interna) |
| **Credenciales** | Sesion NextAuth con rol ADMIN |

### 1.2 Sincronizar clientes desde Notion

| Campo | Valor |
|---|---|
| **Funcion** | `cerebroSyncWorker` (`src/server/jobs/workers/cerebro-sync-worker.ts:22`) |
| **Lector** | `getClientsFromNotion()` (`src/lib/notion-direct.ts:78`) |
| **Sistema externo** | Notion API (BD "Clientes Actuales" `e489c63e-4edf-4820-aa73-1e59f6f99944`) |
| **Que escribe** | Upsert en `Client` + `Site` por `cerebroClientId`. Clientes que desaparecen de Notion → `status: PAUSED`. |
| **Invocable desde afuera** | Solo BullMQ scheduler (cron cada 6h, job `sync:cerebro`) |
| **Credenciales** | `NOTION_API_KEY` (env) |

### 1.3 Sincronizar tareas y estrategia desde Cerebro web

| Campo | Valor |
|---|---|
| **Funcion** | `cerebroTasksSyncWorker` (`src/server/jobs/workers/cerebro-tasks-sync-worker.ts:21`) |
| **Cliente HTTP** | `fetchActiveTasks()`, `fetchCurrentStrategy()` (`src/lib/cerebro-bridge.ts`) |
| **Sistema externo** | Cerebro web (`CEREBRO_API_URL`) — endpoints aun no existen (bloqueado) |
| **Que escribe** | Upsert en `MonthlyCycle`, `Task`, `Hypothesis`. Borra tareas locales que desaparecen del source. |
| **Invocable desde afuera** | BullMQ scheduler (cada 15min, job `sync:cerebro-tasks`) |
| **Credenciales** | `CEREBRO_INTERNAL_SECRET` (Bearer token) |

### 1.4 Trackear rankings de keywords

| Campo | Valor |
|---|---|
| **Funcion** | `rankTrackingWorker` → `runRankTrackingProcessor()` (`src/server/jobs/workers/rank-tracking-worker.ts`, `src/server/jobs/processors/rank-tracking-processor.ts`) |
| **Sistema externo** | DataForSEO API (`/v3/serp/google/organic/live/regular`) |
| **Que escribe** | `KeywordRanking` (posicion diaria por keyword), `ApiUsage` (costo), `Insight` (si hay caida significativa) |
| **Invocable desde afuera** | BullMQ scheduler: `tracking:rankings-priority` (diario 3AM), `tracking:rankings-bulk` (lunes 4AM) |
| **Credenciales** | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` |

### 1.5 Analizar backlinks

| Campo | Valor |
|---|---|
| **Funcion** | `backlinksWorker` (`src/server/jobs/workers/backlinks-worker.ts:26`) |
| **Sistema externo** | DataForSEO API (backlinks summary + lista top 200) |
| **Que escribe** | `Backlink` (upsert activos, marca LOST los perdidos), `BacklinkSnapshot` (semanal), `Insight` (algoritmico: ganados, perdidos, alta autoridad perdida) |
| **Invocable desde afuera** | BullMQ scheduler: `analysis:backlinks` (jueves 5AM) |
| **Credenciales** | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` |

### 1.6 Analizar competidores

| Campo | Valor |
|---|---|
| **Funcion** | `competitorWorker` (`src/server/jobs/workers/competitor-worker.ts:26`) |
| **Sistema externo** | DataForSEO API (Domain Rank Overview + Domain Intersection / keyword gaps) |
| **Que escribe** | `CompetitorSnapshot`, `CompetitorKeywordGap` (reemplaza ciclo anterior), actualiza `Competitor.lastAnalyzed`, `Insight` (algoritmico: brecha creciendo, SoV cayendo, gaps alto volumen) |
| **Invocable desde afuera** | BullMQ scheduler: `analysis:competitors` (dias 1 y 15, 7AM) |
| **Credenciales** | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` |

### 1.7 Medir visibilidad en AI Search (AEO)

| Campo | Valor |
|---|---|
| **Funcion** | `aiSearchWorker` (`src/server/jobs/workers/ai-search-worker.ts:40`) |
| **Sistema externo** | Anthropic API (Claude Haiku 4.5 — simula queries de LLM y detecta mencion del cliente) |
| **Que escribe** | `AiSearchVisibility` (query + mencionado + posicion), `ApiUsage`, `Insight` (alta visibilidad = WIN, nula = OPPORTUNITY) |
| **Invocable desde afuera** | BullMQ scheduler: `analysis:ai-search` (viernes 6AM) |
| **Credenciales** | `ANTHROPIC_API_KEY` |

### 1.8 Generar insights con Claude (InsightsAgent)

| Campo | Valor |
|---|---|
| **Funcion** | `insightsWorker` → `runInsightsProcessor()` (`src/server/jobs/workers/insights-worker.ts`, `src/server/jobs/processors/insights-processor.ts`) |
| **Sistema externo** | Anthropic API (Claude Sonnet 4.6) |
| **Que escribe** | `Insight` (deduplica contra existentes), `ApiUsage` |
| **Invocable desde afuera** | BullMQ scheduler: `insights:generate` (diario 6AM) + trigger reactivo post-audit/backlink/ranking |
| **Credenciales** | `ANTHROPIC_API_KEY` |

### 1.9 Generar plan "Proximos pasos" (SeoAdvisor)

| Campo | Valor |
|---|---|
| **Funcion** | `seoAdvisorWorker` → `runAdvisorProcessor()` (`src/server/jobs/workers/seo-advisor-worker.ts`, `src/lib/seo-advisor/advisor-processor.ts`) |
| **Sistema externo** | Anthropic API (Claude Sonnet 4.6) |
| **Que escribe** | `NextStepPlan` (pasos priorizados con evidencia, esfuerzo, impacto, kind, targetUrl, keywords), `ApiUsage`, `JobLog` (si validacion falla) |
| **Validacion** | Zod schema (`src/lib/seo-advisor/validation.ts`). 1 reintento con error en prompt si falla. Si falla 2 veces → `status: "invalid"` + log en `JobLog`. |
| **Invocable desde afuera** | BullMQ scheduler: `advisor:generate` (diario 7AM) + `POST /api/internal/advisor/regenerate/{cerebroClientId}` (API, Bearer `SEO_INTERNAL_SECRET`) |
| **Estado del job** | `GET /api/internal/advisor/jobs/{jobId}` → `{ status: queued\|running\|done\|failed, planId?, error? }` |
| **Credenciales** | `ANTHROPIC_API_KEY` |

### 1.10 Generar analisis ejecutivo on-demand (Claude Analysis)

| Campo | Valor |
|---|---|
| **Funcion** | `generateClientAnalysis()` (`src/lib/claude-analysis.ts:299`) |
| **Sistema externo** | Anthropic API (Claude Sonnet 4.6) |
| **Que escribe** | `ClientAnalysis` (JSON estructurado), `ApiUsage` |
| **Invocable desde afuera** | Llamado desde UI (tRPC, no directamente como endpoint REST) |
| **Credenciales** | `ANTHROPIC_API_KEY` |

### 1.11 Generar plan de contenido SEO (Claude Content Plan)

| Campo | Valor |
|---|---|
| **Funcion** | `generateContentPlan()` (`src/lib/claude-content-plan.ts:243`) |
| **Sistema externo** | Anthropic API (Claude Sonnet 4.6) |
| **Que escribe** | `ContentPlan` (ideas con tipo, keywords, angulo, prioridad), `ApiUsage` |
| **Invocable desde afuera** | Llamado desde UI (tRPC) |
| **Credenciales** | `ANTHROPIC_API_KEY` |

### 1.12 Generar reporte mensual SEO

| Campo | Valor |
|---|---|
| **Funcion** | `generateMonthlyReport()` (`src/lib/monthly-report.ts:414`) |
| **Sistema externo** | Anthropic API (Claude Sonnet 4.6) |
| **Que escribe** | `MonthlyReport` (JSON ejecutivo con metricas, logros, plan proximo mes), `ApiUsage` |
| **Invocable desde afuera** | BullMQ scheduler: `report:monthly` (dia 2, 6AM) + UI on-demand |
| **Credenciales** | `ANTHROPIC_API_KEY` |

### 1.13 Clasificar preguntas AEO/GEO (Research)

| Campo | Valor |
|---|---|
| **Funcion** | `classifyQuestions()` (inferido de `src/lib/aeo-classify.ts`) |
| **Sistema externo** | Anthropic API (Claude Sonnet 4.6) + DataForSEO (questions) |
| **Que escribe** | `AeoResearch` (clusters tematicos con candidatos AEO/GEO), `ApiUsage` |
| **Invocable desde afuera** | UI (tRPC) |
| **Credenciales** | `ANTHROPIC_API_KEY`, `DATAFORSEO_LOGIN/PASSWORD` |

### 1.14 Ejecutar audit rapido de sitio

| Campo | Valor |
|---|---|
| **Funcion** | `auditQuickWorker` (`src/server/jobs/workers/audit-quick-worker.ts`) → `auditProcessor` (`src/server/jobs/processors/audit-processor.ts`) |
| **Sistema externo** | PageSpeed Insights API (gratis) + crawl propio del dominio |
| **Que escribe** | `Audit`, `AuditIssue` |
| **Invocable desde afuera** | BullMQ scheduler: `crawler:audit-quick` (miercoles 2AM) |
| **Credenciales** | `PAGESPEED_API_KEY` (opcional, funciona sin ella con rate limit) |

### 1.15 Ejecutar audit completo de sitio

| Campo | Valor |
|---|---|
| **Funcion** | `auditCompleteWorker` (`src/server/jobs/workers/audit-complete-worker.ts`) → `auditProcessor` |
| **Sistema externo** | PageSpeed Insights API + crawl propio |
| **Que escribe** | `Audit`, `AuditIssue` |
| **Invocable desde afuera** | BullMQ scheduler: `crawler:audit` (1ro del mes 1AM) |
| **Credenciales** | `PAGESPEED_API_KEY` (opcional) |

### 1.16 Cerrar ciclo mensual

| Campo | Valor |
|---|---|
| **Funcion** | `closeCycle()` (`src/lib/cycle-close.ts:24`) |
| **Sistema externo** | Ninguno (solo BD propia) |
| **Que escribe** | `MonthlyCycle.status → CLOSED`, `Task.status → BLOCKED` (pendientes), `Hypothesis.validation → VALIDATED/PARTIAL` (auto-validacion). Transaccion atomica. |
| **Invocable desde afuera** | BullMQ scheduler: `cycle:close` (dia 1, 2AM) |
| **Credenciales** | Ninguna externa |

### 1.17 Registrar/eliminar jobs de un cliente

| Campo | Valor |
|---|---|
| **Funcion** | `registerClientJobs()`, `removeClientJobs()` (`src/server/jobs/schedulers.ts:40,175`) |
| **Sistema externo** | Redis (BullMQ) |
| **Que escribe** | Crea/elimina repeatable jobs en las colas BullMQ |
| **Invocable desde afuera** | Llamado internamente al crear/pausar clientes |
| **Credenciales** | `REDIS_URL` |

### 1.18 Logear uso de API (costos)

| Campo | Valor |
|---|---|
| **Funcion** | `logApiUsage()` (`src/server/jobs/workers/base-worker.ts`) |
| **Sistema externo** | Ninguno (BD propia) |
| **Que escribe** | `ApiUsage` (provider, endpoint, cost, clientId) |
| **Invocable desde afuera** | Solo import interno |
| **Credenciales** | Ninguna |

### 1.19 Persistir tokens OAuth de Google (auto-refresh)

| Campo | Valor |
|---|---|
| **Funcion** | `buildOAuth2Client()` → listener `oauth2Client.on("tokens")` (`src/lib/google-oauth.ts:59`) |
| **Sistema externo** | Google OAuth2 |
| **Que escribe** | `Account.access_token`, `Account.refresh_token`, `Account.expires_at` |
| **Invocable desde afuera** | Automatico al usar cualquier Google API |
| **Credenciales** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |

---

## PARTE 2 — CAPACIDADES QUE CONSUME DE OTROS (solo lectura / requests salientes)

### 2.1 Notion API (lectura)

| Campo | Valor |
|---|---|
| **Que consume** | BD "Clientes Actuales" — lista de clientes con Estado, dominio, servicios, GSC URL, GA4 Property ID |
| **Como** | `@notionhq/client` SDK, `dataSources.query()` con filtro de Estado |
| **Funcion** | `getClientsFromNotion()` (`src/lib/notion-direct.ts:78`) |
| **Credenciales** | `NOTION_API_KEY` |

### 2.2 Google Search Console (lectura)

| Campo | Valor |
|---|---|
| **Que consume** | Metricas de busqueda: clicks, impressions, CTR, posicion por query y por pagina. Series diarias. |
| **Como** | `googleapis` SDK (`webmasters.searchanalytics.query`) via OAuth2 |
| **Funcion** | `GoogleSearchConsoleProvider` (`src/server/providers/google-search-console.ts`) |
| **Credenciales** | OAuth2 tokens del usuario (`Account` tabla) o service account via `GSC_SERVICE_EMAIL` |

### 2.3 Google Analytics 4 (lectura)

| Campo | Valor |
|---|---|
| **Que consume** | Sesiones organicas diarias, overview (totalSessions, totalConversions), metricas por pagina |
| **Como** | `googleapis` SDK (`analyticsdata.properties.runReport`) via OAuth2 |
| **Funcion** | `GoogleAnalytics4Provider` (`src/server/providers/google-analytics-4.ts`) |
| **Credenciales** | OAuth2 tokens del usuario o service account |

### 2.4 DataForSEO API (lectura — con costo)

| Campo | Valor |
|---|---|
| **Que consume** | SERP rankings (live), backlinks summary + lista, domain rank overview, keyword gaps (domain intersection), keyword suggestions, keyword volume, preguntas (questions) |
| **Como** | HTTP POST directo a `api.dataforseo.com/v3/*` con Basic Auth |
| **Funcion** | `DataForSeoProvider` (`src/server/providers/dataforseo.ts`) |
| **Cache** | Redis con TTLs variables (7d domain authority, 24h backlinks, 30d keyword volume, sin cache SERP) |
| **Credenciales** | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` |

### 2.5 PageSpeed Insights API (lectura)

| Campo | Valor |
|---|---|
| **Que consume** | Core Web Vitals (LCP, FID, CLS), scores Lighthouse (performance, seo, accessibility) |
| **Como** | HTTP GET via provider |
| **Funcion** | `PageSpeedProvider` (`src/server/providers/pagespeed.ts`) |
| **Credenciales** | `PAGESPEED_API_KEY` (opcional) |

### 2.6 Anthropic API (lectura — con costo)

| Campo | Valor |
|---|---|
| **Que consume** | Generacion de texto estructurado (JSON) para analisis, insights, reportes, content plans, AEO research, next steps |
| **Como** | `@anthropic-ai/sdk` |
| **Modelos usados** | `claude-sonnet-4-6` (analisis, reportes, advisor), `claude-haiku-4-5-20251001` (AI search visibility) |
| **Credenciales** | `ANTHROPIC_API_KEY` |

### 2.7 Cerebro web (lectura — parcialmente bloqueado)

| Campo | Valor |
|---|---|
| **Que consume** | Lista de clientes, tareas activas, estrategia del ciclo actual |
| **Como** | HTTP GET a `CEREBRO_API_URL/api/internal/seo/*` con Bearer `CEREBRO_INTERNAL_SECRET` |
| **Funcion** | `cerebroFetch()` (`src/lib/cerebro-bridge.ts`) |
| **Estado** | Endpoints en Cerebro web aun NO existen. El sync de tareas usa Notion directamente como fallback. |

---

### 2.8 Endpoints que Cerebro SEO EXPONE para consumo externo

Estos endpoints son de lectura pero son invocados por Cerebro web / Constructor:

| Endpoint | Funcion | Que devuelve | Auth |
|---|---|---|---|
| `GET /api/internal/cerebro/clients/{id}/monthly-summary` | `route.ts:23` | Resumen mensual: hipotesis, tareas completadas, insights criticos | Bearer `SEO_INTERNAL_SECRET` |
| `GET /api/internal/recommendations/{cerebroClientId}?month=YYYY-MM` | `route.ts:43` | NextSteps + analisis Claude + oportunidades GSC. Campos v2: `planId`, `planStatus`, `model`, `stale`, `gscOpportunities[]`. `maxAgeDays` marca plan viejo como stale. | Bearer `SEO_INTERNAL_SECRET` |
| `POST /api/internal/advisor/regenerate/{cerebroClientId}` | `route.ts:29` | Encola job BullMQ del advisor. Idempotente: devuelve `jobId` existente si hay job activo. | Bearer `SEO_INTERNAL_SECRET` |
| `GET /api/internal/advisor/jobs/{jobId}` | `route.ts:25` | Estado del job: `{ status: queued\|running\|done\|failed, planId?, error? }` | Bearer `SEO_INTERNAL_SECRET` |
| `GET /api/internal/constructor/metrics` | `route.ts:125` | Serie temporal GA4 (sesiones organicas) + cards con delta | Bearer `SEO_INTERNAL_SECRET` |
| `GET /api/internal/constructor/clients/{notionId}/reports` | `route.ts:24` | Lista de reportes mensuales con embed_url firmado (token HMAC 1h) | Bearer `SEO_INTERNAL_SECRET` |
| `POST /api/internal/diagnostico` | `route.ts:37` | Domain rank overview + backlinks summary de DataForSEO para un dominio | Bearer `SEO_INTERNAL_SECRET` |
| `GET /api/health` | `route.ts:5` | Health check (ping a Claude para verificar modelo activo) | Ninguna |
| `GET /api/jobs/init` | `route.ts:5` | Inicializa BullMQ schedulers | Header `x-internal-secret` = `CEREBRO_INTERNAL_SECRET` |

---

## PARTE 3 — OBJETOS DE DOMINIO (BD propia, PostgreSQL)

| Entidad | Tabla Prisma | Equivalente en otro sistema |
|---|---|---|
| **Client** | `Client` | Notion BD "Clientes Actuales" (source of truth para nombre, dominio, estado, servicios). Cerebro web tiene su propia copia. `cerebroClientId` = Notion page ID. |
| **Site** | `Site` | Propiedad GSC (`gscProperty`) y GA4 (`ga4Property`) configuradas en Notion. |
| **MonthlyCycle** | `MonthlyCycle` | Cerebro web: estrategia mensual (goals, focus, notes). Se sincroniza via bridge. |
| **Task** | `Task` | Notion tareas. `notionTaskId` vincula 1:1 con Notion. Cerebro web es intermediario. |
| **Hypothesis** | `Hypothesis` | Concepto propio de Cerebro SEO, aunque la tarea asociada viene de Notion. |
| **Keyword** | `Keyword` | Sin equivalente externo. Source of truth en Cerebro SEO. |
| **KeywordRanking** | `KeywordRanking` | Sin equivalente. Historico diario propio (fuente: DataForSEO SERP). |
| **Competitor** | `Competitor` | Sin equivalente externo. Configurado localmente. |
| **CompetitorSnapshot** | `CompetitorSnapshot` | Sin equivalente. Foto periodica desde DataForSEO. |
| **CompetitorKeywordGap** | `CompetitorKeywordGap` | Sin equivalente. Keyword gaps desde DataForSEO Labs. |
| **Audit** | `Audit` | Sin equivalente. Crawl y scores propios. |
| **AuditIssue** | `AuditIssue` | Sin equivalente. Issues desglosados del audit. |
| **Backlink** | `Backlink` | Sin equivalente. Reconciliado semanalmente desde DataForSEO. |
| **BacklinkSnapshot** | `BacklinkSnapshot` | Sin equivalente. Foto semanal agregada. |
| **PageMetric** | `PageMetric` | Datos combinados GSC + GA4 por URL y fecha. |
| **Insight** | `Insight` | Sin equivalente. Generados algoritmicamente + Claude. |
| **TimelineEvent** | `TimelineEvent` | Sin equivalente. Eventos manuales o detectados (algorithm updates, lanzamientos). |
| **AiSearchVisibility** | `AiSearchVisibility` | Sin equivalente. Medicion propia de mencion en LLMs. |
| **ClientAnalysis** | `ClientAnalysis` | Sin equivalente. Analisis on-demand con Claude. |
| **MonthlyReport** | `MonthlyReport` | Sin equivalente. Reporte mensual generado con Claude, embebible en Constructor via token firmado. |
| **ContentPlan** | `ContentPlan` | Sin equivalente. Ideas de contenido generadas con Claude. |
| **AeoResearch** | `AeoResearch` | Sin equivalente. Clusters AEO/GEO clasificados con Claude. |
| **NextStepPlan** | `NextStepPlan` | Sin equivalente. Plan de proximos pasos generado por SeoAdvisor. |
| **ClientUser** | `ClientUser` | Asociacion EDITOR → clientes visibles. Sin equivalente externo. |
| **ApiUsage** | `ApiUsage` | Sin equivalente. Log de costos por provider/endpoint/cliente. |
| **JobLog** | `JobLog` | Sin equivalente. Log de ejecucion de workers BullMQ. |
| **User** | `User` | NextAuth. Usuarios internos de Click Society. |
| **Account** | `Account` | NextAuth. Tokens OAuth de Google (access + refresh). |
| **Session** | `Session` | NextAuth. Sesiones activas. |
| **VerificationToken** | `VerificationToken` | NextAuth. No usado (no hay magic link). |

---

### Resumen de sistemas externos tocados

| Sistema | Lectura | Escritura | Credencial principal |
|---|---|---|---|
| PostgreSQL propia | Si | Si | `DATABASE_URL` |
| Redis | Si | Si | `REDIS_URL` |
| Notion API | Si | **No** (solo lee clientes) | `NOTION_API_KEY` |
| Google Search Console | Si | No | OAuth2 (`GOOGLE_CLIENT_ID/SECRET`) |
| Google Analytics 4 | Si | No | OAuth2 |
| DataForSEO | Si | No (pero cuesta $) | `DATAFORSEO_LOGIN/PASSWORD` |
| PageSpeed Insights | Si | No | `PAGESPEED_API_KEY` (opcional) |
| Anthropic (Claude) | Si | No (pero cuesta $) | `ANTHROPIC_API_KEY` |
| Cerebro web | Si (parcial) | **No** | `CEREBRO_INTERNAL_SECRET` |
