# Cerebro SEO — Project State

> Documento vivo. Se actualiza al inicio y cierre de cada sesión de trabajo.

**Última actualización:** 2026-05-12
**Fase actual:** Fase 1 — Foundation (✅ COMPLETA — app en producción)
**Próximo hito:** Fase 2 — Datos reales fluyendo (Términos de búsqueda, Tráfico, Site audit, Notion sync)

---

## 1. Estado general

| Área | Estado | Notas |
|---|---|---|
| Concepto y visión | ✅ Completo | Tesis reformulada: contexto > métricas |
| Spec de producto | ✅ v3 | 4 fases, sin vista cliente, sin Fase 5 |
| Arquitectura técnica | ✅ v2 | Multiagentes como infraestructura transversal |
| Cuenta DataForSEO | ✅ Completo | $50 depositados, credenciales verificadas, SERP test exitoso |
| Repo GitHub | ✅ Completo | `jorgeruiz/cerebro-seo` (privado), commits en main |
| `.env.local` | ✅ Completo | Todas las credenciales: DataForSEO, Google OAuth, Anthropic, Notion, NextAuth secret, internal secrets |
| `.gitignore` | ✅ Completo | Excluye `.env*.local`, `validation-report.md`, `node_modules`, `.next/` |
| `docker-compose.yml` | ✅ Completo | postgres:16-alpine + redis:7-alpine — ambos servicios corriendo via OrbStack |
| Docker / OrbStack | ✅ Completo | OrbStack instalado y corriendo — resuelve el bloqueador de Docker Desktop |
| BD local (Postgres + Redis) | ✅ Completo | Ambos servicios healthy, conectados, verificados |
| Prisma migrations | ✅ Completo | `20260510075453_init` aplicada — 21 tablas creadas |
| Next.js + TypeScript | ✅ Completo | App Router, Tailwind, shadcn base-nova |
| Prisma schema | ✅ Completo | Todos los modelos + NextAuth (ADMIN/EDITOR) + JobLog |
| Auth (NextAuth) | ✅ Completo | Google OAuth + roles ADMIN/EDITOR inyectados en sesión |
| Layout + branding | ✅ Completo | Sidebar, gradiente Click Society |
| App arranca con BD real | ✅ Verificado | `npm run dev` → 307 redirect a `/api/auth/signin` (correcto) |
| Sistema de multiagentes | ✅ Completo | 3 queues BullMQ, base-worker, InsightsAgent con prompt caching |
| Listado de clientes | ✅ Completo | Grid con alertas, tareas, estado del ciclo |
| Wizard de alta de cliente | ✅ Completo | 3 pasos: datos, propiedades GSC/GA4, keywords/competidores |
| Vista detalle del cliente | ✅ Completo | Portada con gráfica mock, InsightCards, operativa, 9 módulos placeholder |
| Provider layer DataForSEO | ✅ Completo | `seo-data.ts` (interface) + `dataforseo.ts` (4 métodos reales + stubs) |
| Script de validación DataForSEO | ✅ Ejecutado (×2) | Sesión 3: $0.228 USD sin BD. Sesión 4: $0.225 USD con BD — 15 rows en ApiUsage |
| ApiUsage table poblada | ✅ Completo | 15 rows, $0.225 USD total — datos reales de Sesión 4 |
| Auth: scopes GSC+GA4 | ✅ Completo | `auth.ts` actualizado: `webmasters.readonly` + `analytics.readonly` + refresh token |
| Conexión GSC | ✅ Completo | `google-search-console.ts` con caché Redis 24h. Portada usa datos reales. |
| Conexión GA4 | ✅ Completo | `google-analytics-4.ts` con caché Redis 4h, filtro Organic. Portada KPI cards. |
| `google-oauth.ts` | ✅ Completo | Helper OAuth2Client con auto-refresh de tokens persistido en DB |
| Seed de clientes | ⚠️ Bloqueado | `notion-direct.ts` + `scripts/seed-clients.ts` listos — esperando que Jorge comparta BD Notion |
| Login simplificado | ✅ Completo | Solo Google OAuth (sin magic link eliminado) |
| Build de producción | ✅ Completo | `npm run build` sin errores — tailwind.config.ts y globals.css corregidos |
| Deploy inicial Easypanel | ✅ Completo | App en producción. HTTP 200 verificado. BD `cerebro_seo` creada. Migraciones aplicadas. |
| URL producción (interna) | ✅ Activo | `https://apps-cerebro-seo.6lk5jx.easypanel.host` → HTTP 307 → `/api/auth/signin` |
| URL producción (custom) | ⚠️ DNS pendiente | `https://seo.clicksociety.mx` — requiere registro A `76.13.121.6` en registrador |

---

## 2. Decisiones tomadas (con fecha)

| Fecha | Decisión |
|---|---|
| 2026-05-07 | App separada de Cerebro (hermana, no hija). Repos, BD y deploy independientes. |
| 2026-05-07 | Stack: Next.js 14 + Prisma v5 + PostgreSQL + NextAuth v4. |
| 2026-05-07 | Subdominio: `seo.clicksociety.mx`. |
| 2026-05-07 | Provider primario: DataForSEO (pay-per-use). Provider layer abstraído. |
| 2026-05-07 | Equipo con Google OAuth (ADMIN/EDITOR). Sin acceso de usuarios externos. Herramienta 100% interna. |
| 2026-05-07 | Ciclo mensual SEO como entidad de primera clase. |
| 2026-05-07 | Hipótesis verificables como diferenciador del producto. |
| 2026-05-07 | AI Search Visibility incluido en v1. |
| 2026-05-07 | Sync con Cerebro: REST interno con shared secret. Descartado Prisma multi-schema. |
| 2026-05-07 | **Prisma v5** (no v7): Prisma 7 tiene breaking changes incompatibles. |
| 2026-05-07 | **shadcn estilo `base-nova`**: usa `@base-ui/react` (no Radix). `asChild` no existe — usar `buttonVariants` + `<Link>`. |
| 2026-05-07 | **tRPC para APIs internas**. REST solo para: webhooks externos, NextAuth, bridge Cerebro. `/api/clientes` es temporal → migrar a tRPC en Fase 2. |
| 2026-05-07 | **Sistema de multiagentes como infraestructura transversal**, no como fase del roadmap. |
| 2026-05-07 | **Fase 0 parcialmente completada fuera del flujo formal**: DataForSEO verificado con SERP test. Validación vs GSC se hace con el DataForSeoProvider en Fase 1. |
| 2026-05-07 | **Docker para desarrollo local**: PostgreSQL 16 + Redis 7 via docker-compose. Easypanel solo para producción. |
| 2026-05-07 | **Roadmap reordenado a 4 fases**. Sistema de multiagentes como infraestructura. |
| 2026-05-07 | **Frecuencia de tracking**: diario top 10 keywords (`isPriority: true`), semanal resto. |
| 2026-05-07 | **Cerebro SEO es herramienta 100% interna** para equipo (ADMIN/EDITOR). Eliminada vista cliente, magic link, UserRole.CLIENT, Fase 5. |
| 2026-05-07 | **Tesis del producto reformulada**: Cerebro SEO no compite en métricas SEO crudas — compite en CONTEXTO. Cruza datos SEO (DataForSEO, GSC, GA4) con Notion (clientes, tareas, estrategia, bitácora) y Cerebro web (análisis, conversaciones, hipótesis). |
| 2026-05-07 | **Repo GitHub**: `jorgeruiz/cerebro-seo` (privado, cuenta personal `jorgeruiz`). Click Society no usa GitHub Organizations por costo. |
| 2026-05-07 | **Análisis on-demand de Claude** movido a Fase 3. NO es chat full-featured. |
| 2026-05-07 | **Google OAuth Client ID** creado dedicado a Cerebro SEO (mismo Google Cloud project que Cerebro web; APIs GSC y GA4 ya habilitadas). |
| 2026-05-08 | **Costo real DataForSEO SERP Live**: $0.0155/query (depth:100), no $0.002 (eso es depth:10). Para producción con Standard Queue y depth:30 el costo baja sustancialmente. |
| 2026-05-10 | **OrbStack como reemplazo de Docker Desktop** para desarrollo local. Docker Desktop no arranca en MacBook Air M4 / macOS Tahoe 26.2. OrbStack es compatible 100% con `docker-compose.yml`. |
| 2026-05-10 | **Prisma requiere DATABASE_URL en el entorno del proceso** (no solo en `.env.local`). Comandos `prisma migrate dev` y `prisma studio` necesitan `DATABASE_URL=... npx prisma ...` o equivalente. Next.js carga `.env.local` automáticamente pero Prisma CLI no. |

---

## 3. Decisiones pendientes

1. **SSO entre Cerebro y Cerebro SEO para el equipo**: ¿cookie en dominio padre `clicksociety.mx` o login separado con mismas credenciales? *Resolver antes de que Fase 2 esté en producción.*
2. **AI Search Visibility provider**: DataForSEO LLM APIs vs Profound vs stack propio. *Resolver en Fase 4.*
3. **Profundidad de SERP en tracking producción**: depth:10 ($0.0006/req Standard Queue) vs depth:100 ($0.0047/req estimado). Decidir al implementar RankTrackingAgent en Fase 2.

---

## 4. Backlog de Fase 1

**Completado (Sesiones 1–4):**
- [x] Proyecto Next.js 14 inicializado (App Router + TypeScript + Tailwind + shadcn base-nova)
- [x] Prisma schema completo: modelos de negocio + NextAuth (ADMIN/EDITOR) + JobLog
- [x] `src/env.ts`: validación de ENV con Zod al startup
- [x] `src/lib/redis.ts`, `src/lib/db.ts`: singletons de ioredis y Prisma
- [x] NextAuth v4: Google OAuth + roles (ADMIN/EDITOR) inyectados en sesión
- [x] Middleware de protección de rutas
- [x] Sistema de multiagentes: `queues.ts`, `base-worker.ts`, `insights-processor.ts`, `insights-worker.ts`, `schedulers.ts`, `init.ts`
- [x] Layout admin: Sidebar con branding (gradiente Click Society)
- [x] Página de login: Google OAuth
- [x] Listado de clientes: grid con estado del ciclo, alertas, tareas pendientes
- [x] Wizard de alta de cliente: 3 pasos
- [x] Vista detalle de cliente: portada con gráfica mock, InsightCards, operativa, 9 módulos placeholder
- [x] `POST /api/clientes`: endpoint REST temporal (migrar a tRPC en Fase 2)
- [x] `.env.example` con todas las variables
- [x] Setup git: `git init` + `.gitignore` + primer commit + push a `jorgeruiz/cerebro-seo`
- [x] `docker-compose.yml` creado (postgres:16-alpine + redis:7-alpine)
- [x] `.env.local` completo con todas las credenciales reales
- [x] Provider layer: `src/server/providers/seo-data.ts` (interface) + `src/server/providers/dataforseo.ts` (4 métodos reales + stubs)
- [x] Script de validación: `scripts/validate-dataforseo.ts` — ejecutado dos veces
- [x] OrbStack instalado — Docker Desktop reemplazado en MacBook Air M4
- [x] `docker compose up -d` → postgres + redis corriendo (healthy)
- [x] `prisma migrate dev --name init` → migración `20260510075453_init` aplicada, 21 tablas creadas
- [x] `prisma generate` → Prisma Client v5.22 generado
- [x] App arranca con BD real: `npm run dev` → 307 /api/auth/signin (correcto)
- [x] ApiUsage poblada: 15 rows ($0.225 USD) de re-ejecución del script de validación

**Completado (Sesión 5):**
- [x] `auth.ts`: scopes GSC + GA4 con access_type offline + prompt consent para refresh token
- [x] `env.ts`: eliminado EMAIL_SERVER/FROM, PAGESPEED y bridge opcionales
- [x] `login/page.tsx`: simplificado a solo Google OAuth button
- [x] `google-oauth.ts`: helper OAuth2Client con auto-refresh persistido
- [x] `google-search-console.ts`: provider GSC con caché Redis 24h
- [x] `google-analytics-4.ts`: provider GA4 con caché Redis 4h, filtro Organic Search
- [x] `notion-direct.ts`: lectura directa Notion (TEMPORAL) para seed de clientes
- [x] `scripts/seed-clients.ts`: script de siembra de clientes desde Notion
- [x] `clientes/[id]/page.tsx`: fetch real GSC + GA4, log a ApiUsage, KPI cards GA4
- [x] `ClientPortadaChart.tsx`: acepta datos reales, fallback si GSC no configurado
- [x] `tailwind.config.ts`: colores shadcn/ui completos (fix build pre-existente)
- [x] `globals.css`: fix `outline-ring/50` incompatible con Tailwind v3
- [x] `.eslintrc.json`: `argsIgnorePattern: ^_` para stubs del DataForSEO provider
- [x] Build de producción exitoso (`npm run build`)
- [x] Commit + push a `jorgeruiz/cerebro-seo`

**Pendiente (acciones manuales de Jorge — ver §10):**
- [ ] Compartir BD Notion "Clientes Actuales" con integración → ejecutar `seed-clients.ts`
- [ ] Setup Easypanel: crear servicio + Redis + BD + env vars + dominio
- [ ] DNS: `seo.clicksociety.mx` → `76.13.121.6`
- [ ] Google OAuth Console: agregar callback URL de producción
- [ ] Logout + login en producción para obtener nuevos scopes GSC/GA4

---

## 5. Backlog por fases (post Fase 1)

### Fase 2 — Datos reales fluyendo
- GSC + GA4 en portada con datos reales
- Módulo Términos de búsqueda (GSC)
- Módulo Tráfico de páginas (GA4 + GSC)
- Primer site audit técnico (crawler + PageSpeed Insights)
- Sync con Notion: clientes, tareas, estrategia, bitácora
- InsightsAgent corriendo con datos reales (primer ciclo completo)
- tRPC routers: `clientesRouter`, `ciclosRouter`, `insightsRouter`
- Refactorizar `POST /api/clientes` → tRPC
- `src/lib/cerebro-bridge.ts`

### Fase 3 — Módulos SEO + Análisis on-demand de Claude
- Módulo Análisis de competencia
- Módulo Backlinks
- Módulo Eventos / Timeline (con cruce de tareas y conversaciones de Cerebro)
- **Análisis on-demand de Claude**: botón en panel que abre análisis pre-cargado con TODO el contexto del cliente. NO es chat full-featured.
- RankTrackingAgent, BacklinksAgent, CompetitorAgent activados

### Fase 4 — IA y reportes
- Módulo AI Search Visibility
- Módulo Keyword ideas
- Módulo SEO Opportunities
- Reporte mensual auto-generado (ReportAgent + PDF)
- CycleCloseAgent: cierre automático de ciclo + validación de hipótesis

---

## 6. Bloqueadores actuales

| Bloqueador | Dueño | Acción requerida |
|---|---|---|
| Notion BD no compartida | Jorge | Compartir "Clientes Actuales" (e489c63e...) con integración ID 32b0a146... |
| DNS `seo.clicksociety.mx` | Jorge | Registro A: `seo.clicksociety.mx` → `76.13.121.6` en el registrador de dominio |
| Google OAuth redirect URI | Jorge | Agregar `https://seo.clicksociety.mx/api/auth/callback/google` en Google Console |
| Jorge no ha hecho logout+login en prod | Jorge | Cerrar sesión y volver a entrar en `apps-cerebro-seo.6lk5jx.easypanel.host` para activar scopes GSC/GA4 |

---

## 7. Riesgos vivos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Calidad datos DataForSEO insuficiente | Baja | Alto | Validación vs GSC pendiente (Molino Azteca parece correcto; RFN y Quicsa no rankean — validar en GSC) |
| Costos DataForSEO más altos de lo estimado | Media | Medio | Costo real depth:100 = $0.0155/query; para producción usar Standard Queue + depth menor |
| Sync con Cerebro más complejo de lo previsto | Media | Medio | REST simple ya decidido; `cerebro-bridge.ts` pendiente |
| Sitios bloquean al crawler | Media | Bajo | User agent custom, respeto robots.txt, fallback Playwright |
| Bug de autorización entre clientes | Baja | Crítico | Toda query Prisma filtra por `clientId` de sesión |

---

## 8. Bitácora de sesiones

### Sesión 7 — 2026-05-12
**Participantes:** Jorge + Claude Code
**Trabajo realizado:**
- Fix: `src/app/api/auth/[...nextauth]/route.ts` — tipo `Function` en `wrappedHandler` temporal causaba ESLint error `@typescript-eslint/no-unsafe-function-type` que rompía el build de producción. Revertido al patrón estándar `export { handler as GET, handler as POST }`.
- `npm run build` local: pasa sin errores.
- Push a main → deploy en Easypanel.
- `META_ACCESS_TOKEN` en env del servicio: no existe, nada que borrar.
- Estado del login en producción (`seo.clicksociety.com.mx`): en investigación — error `OAuthCallbackError: State cookie was missing` con cuenta `jorge@clicksociety.com.mx`. Cookies de OAuth se setean correctamente desde el servidor (confirmado vía curl). Causa raíz pendiente de confirmar en ventana incógnita.

**Fixes previos de Sesión 7 (parte del diagnóstico de login):**
- `src/lib/auth.ts`: `sameSite: "none"` para cookies state/pkce (hipótesis POST redirect de Google Workspace)
- `NEXTAUTH_URL_INTERNAL=http://localhost:3000` agregado al env de Easypanel
- Dominio corregido: `seo.clicksociety.mx` → `seo.clicksociety.com.mx` en Easypanel y Google Console
- `NEXTAUTH_URL` actualizado a `https://seo.clicksociety.com.mx`

**Fix adicional (mismo día):**
- Build fallaba en "Collecting page data" — Prisma y Redis se evaluaban en build time
- `clientes/page.tsx` y `clientes/[id]/page.tsx`: `export const dynamic = "force-dynamic"`
- `src/lib/redis.ts`: `lazyConnect: true` — evita ECONNREFUSED al importar módulo en build
- `Dockerfile`: ARG/ENV placeholder para DATABASE_URL, REDIS_URL, NEXTAUTH_URL, NEXTAUTH_SECRET durante build, limpiados antes de runtime
- Build local con `SKIP_ENV_VALIDATION=1 npm run build`: pasa sin Redis ni BD accesibles
- Commit `8699bfc` pusheado y redeploy ejecutado

**Pendiente:**
- Confirmar login exitoso en ventana incógnita con jorge@clicksociety.com.mx

### Sesión 6 — 2026-05-12
**Participantes:** Jorge + Claude Code
**Duración:** ~3h
**Trabajo realizado:**
- Reporte de estado post-saturación del VPS (Playwright consumía demasiada RAM)
- Setup Easypanel completado 100% vía API tRPC (sin Playwright):
  - Servicios `cerebro-seo-redis` y `cerebro-seo` (App) creados
  - Variables de entorno aplicadas (DATABASE_URL con password real CerebroClick2026#)
  - Dominio `apps-cerebro-seo.6lk5jx.easypanel.host` puerto corregido 80→3000 vía `domains.updateDomain`
  - Dominio `seo.clicksociety.mx` agregado vía `domains.createDomain`
  - Build type `dockerfile` configurado vía `services.app.updateBuild` con payload `{build:{type:"dockerfile"}}`
  - Source GitHub configurado vía `services.app.updateSourceGithub` con campo `path:"/"`
- Fix build Docker: `src/env.ts` agrega guard `SKIP_ENV_VALIDATION=1` — `envSchema.parse` fallaba en build time sin env vars
- Fix Dockerfile: `RUN SKIP_ENV_VALIDATION=1 npm run build` (var solo en ese RUN, no en imagen)
- Fix `startup.mjs`: `node_modules/.bin/prisma` en vez de `npx prisma` (más robusto en producción)
- Deploy exitoso: HTTP 200 en `https://apps-cerebro-seo.6lk5jx.easypanel.host`
- BD `cerebro_seo` creada automáticamente por `startup.mjs`, migraciones aplicadas

**Verificación final:**
- `curl -I https://apps-cerebro-seo.6lk5jx.easypanel.host` → `HTTP/2 307` (NextAuth redirect a /signin — correcto)
- `curl /api/auth/providers` → `{"google":{"id":"google",...,"callbackUrl":"https://seo.clicksociety.mx/api/auth/callback/google"}}`

**Hallazgos técnicos (nuevos):**
- `domains.updateDomain` y `domains.createDomain` requieren `composeService: ""` (no `null`) en el payload
- `services.app.updateBuild` requiere payload `{build:{type:"dockerfile"}}` (objeto anidado), NO `{type:"dockerfile"}` al nivel raíz
- `services.app.updateSourceGithub` requiere campo `path:"/"` obligatorio
- `services.app.updateBuild` requiere que la fuente ya esté configurada (`updateSourceGithub` primero)
- `inspectProject` (no `inspectService`) es el endpoint correcto para verificar `build` y `source`
- Node.js fetch en procesos background del sandbox no tiene acceso de red al VPS — usar curl o scripts en foreground

**Pendiente al cerrar:**
- DNS `seo.clicksociety.mx` → `76.13.121.6` (acción de Jorge)
- Google OAuth redirect URI en Google Console (acción de Jorge)
- Logout+login en producción para scopes GSC/GA4 (acción de Jorge)
- Seed de clientes desde Notion (compartir BD primero)

### Sesión 5 — 2026-05-11
**Participantes:** Jorge + Claude Code
**Duración:** ~2h
**Trabajo realizado:**
- BLOQUE A: `notion-direct.ts` + `scripts/seed-clients.ts` listos; bloqueado por permisos de Notion
- BLOQUE B: Conexión GSC completa — `auth.ts`, `google-oauth.ts`, `google-search-console.ts`; portada muestra datos reales o fallback
- BLOQUE C: Conexión GA4 completa — `google-analytics-4.ts`; portada muestra KPI cards de Analytics orgánico
- Login simplificado: eliminado magic link y EmailProvider
- Build de producción corregido: `tailwind.config.ts` con colores shadcn, `globals.css` sin `outline-ring/50`
- Commit y push: 17 archivos, 1200 inserciones → `jorgeruiz/cerebro-seo` main
- BLOQUE D parcial: confirmado que no hay servicio cerebro-seo en Easypanel; servicio no puede crearse vía API — requiere UI de Easypanel

**Hallazgos técnicos:**
- Easypanel tRPC: rutas correctas son `services.app.xxx`, no `app.xxx`
- Easypanel no tiene API para crear servicios — solo el wizard de la UI web
- `@notionhq/client` v5: `databases.query` → `dataSources.query` (migración de API)
- Cerebro-web en Easypanel usa `autoDeploy: false` — los deploys se hacen manual o vía token
- Easypanel no permite crear proyectos nuevos en el plan actual — cerebro-seo irá en el proyecto `apps`

**Pendiente al cerrar:**
- 4 acciones manuales de Jorge (ver §10)

### Sesión 4 — 2026-05-10
**Participantes:** Jorge + Claude Code
**Duración:** ~1h
**Trabajo realizado:**
- OrbStack instalado y corriendo — reemplaza Docker Desktop (que no abre en MacBook Air M4 / macOS Tahoe 26.2)
- `docker compose up -d` ejecutado — postgres:16-alpine y redis:7-alpine corriendo (healthy, puertos 5432 y 6379)
- `prisma migrate dev --name init` ejecutado con DATABASE_URL en el entorno — migración `20260510075453_init` aplicada exitosamente
- 21 tablas creadas (Client, Site, MonthlyCycle, Task, Hypothesis, Keyword, KeywordRanking, Competitor, Audit, Backlink, PageMetric, Insight, TimelineEvent, AiSearchVisibility, ClientUser, ApiUsage, JobLog, User, Account, Session, VerificationToken + _KeywordToTask join table)
- `prisma generate` ejecutado — Prisma Client v5.22 generado
- Prisma Studio arranca sin error en localhost:5555
- `npm run dev` arranca sin errores — 307 redirect a `/api/auth/signin` (middleware NextAuth funcionando correctamente)
- Script `validate-dataforseo.ts` re-ejecutado con BD disponible — 15 queries, $0.225 USD, 15 rows en ApiUsage

**Hallazgo técnico:**
- `npx prisma migrate dev` requiere DATABASE_URL en el entorno del proceso, no solo en `.env.local` (que Next.js carga automáticamente pero Prisma CLI no). Workaround: `DATABASE_URL="..." npx prisma ...` o equivalente.

**Resultados validación DataForSEO (segunda ejecución):**
- Molino Azteca: posiciones similares (#9, not_in_top_100, #25, #31, #6) — variación normal de ~5 posiciones vs Sesión 3
- RFN y Quicsa: siguen en not_in_top_100 — confirma que genuinamente no rankean para esas keywords

**Pendiente para próxima sesión:**
- Comparar `validation-report.md` contra GSC de los 3 clientes
- Implementar conexión GSC y GA4 con datos reales en portada del cliente
- Deploy inicial Easypanel + DNS `seo.clicksociety.mx`

### Sesión 3 — 2026-05-07/08
**Participantes:** Jorge + Claude Code (autónoma nocturna) + Claude (Project, planeación)
**Duración:** ~6h en chat de Project + sesión nocturna de Code parcial
**Trabajo realizado:**
- Cuenta DataForSEO creada, $50 depositados, credenciales generadas, llamada SERP de prueba exitosa
- Google OAuth Client ID nuevo creado dedicado a Cerebro SEO
- `.env.local` completo creado con todas las credenciales
- Decisión de scope mayor: Cerebro SEO 100% interno, sin vista cliente/magic link/Fase 5
- Tesis del producto reformulada: contexto > métricas
- Repo `cerebro-seo` creado en GitHub bajo cuenta personal `jorgeruiz`
- Sesión nocturna de Code: git init + primer commit + push (58 archivos), `docker-compose.yml` creado, provider layer implementado, script de validación creado y ejecutado (15 queries, $0.228 USD sin BD)

**Bloqueador encontrado:**
- Docker Desktop no abre en MacBook Air M4 con macOS Tahoe 26.2. Resuelto en Sesión 4 con OrbStack.

### Sesión 2 — 2026-05-07
**Participantes:** Jorge + Claude Code
**Duración:** ~3h
**Trabajo realizado:**
- Diseño del sistema de multiagentes (blueprint aprobado): 9 agentes, 3 queues BullMQ, prompt caching 3 bloques, estimación costos Claude ~$9-11 USD/mes para 10 clientes
- Implementación infraestructura de jobs: `queues.ts`, `base-worker.ts`, `insights-processor.ts`, `insights-worker.ts`, `schedulers.ts`, `init.ts`
- Fase 1 Foundation: Next.js 14, Prisma schema completo, auth Google OAuth, layout sidebar, login, listado clientes, wizard 3-pasos, vista detalle con gráfica mock y módulos placeholder
- Decisiones técnicas: Prisma 7→5, shadcn base-nova (asChild no disponible), tRPC vs REST clarificado

### Sesión 1 — 2026-05-07
**Participantes:** Jorge + Cerebro (Project)
**Duración:** ~1h
**Decisiones:**
- Concepto general aprobado. DataForSEO como provider primario. Ubersuggest descartado.
- 9 módulos del panel, ciclo mensual como entidad, hipótesis verificables, AI Search Visibility
- Documentación base creada: todos los markdowns de planning

---

## 9. Información operativa

- **Easypanel VPS:** http://76.13.121.6:3000 — `jorge.arm@gmail.com` / `ClickSociety12#`
- **GitHub repo:** https://github.com/jorgeruiz/cerebro-seo (privado)
- **Subdominio destino:** `seo.clicksociety.mx`

### Credenciales disponibles (en `.env.local`)
- ✅ DataForSEO: cuenta activa, $50 depositados, ~$49.55 restantes (−$0.228 Sesión 3 −$0.225 Sesión 4)
- ✅ Google OAuth Client ID dedicado a Cerebro SEO
- ✅ Anthropic API key (copiada de Cerebro)
- ✅ Notion API key (copiada de Cerebro)
- ✅ NEXTAUTH_SECRET generado
- ✅ CEREBRO_INTERNAL_SECRET generado
- ❌ PageSpeed Insights API key: pendiente generar en Fase 2

### Comandos para desarrollo local (con OrbStack corriendo)

```bash
# Levantar servicios
docker compose up -d

# Migración (requiere DATABASE_URL explícito en CLI)
DATABASE_URL="postgresql://cerebro:cerebro@localhost:5432/cerebro_seo" npx prisma migrate dev --name nombre

# Generar cliente Prisma
DATABASE_URL="postgresql://cerebro:cerebro@localhost:5432/cerebro_seo" npx prisma generate

# Prisma Studio
DATABASE_URL="postgresql://cerebro:cerebro@localhost:5432/cerebro_seo" npx prisma studio

# App
npm run dev
```

---

## 10. Próximos pasos concretos (acciones manuales de Jorge)

### 10.1 Notion — Compartir BD con integración
1. Abrir Notion → BD "Clientes Actuales"
2. Click en "..." → Share → Add connections → buscar integración "Claude" o "Cerebro"
3. ID integración: `32b0a146-5e52-81f9-8509-0027c0a09cd7`
4. Una vez compartida, ejecutar el seed:
   ```bash
   DATABASE_URL="postgresql://cerebro:cerebro@localhost:5432/cerebro_seo" \
   npx tsx scripts/seed-clients.ts
   ```
5. Verificar que los campos GSC/GA4 se mapearon correctamente (la BD puede tener nombres de columna distintos).

### 10.2 Easypanel — Setup de cerebro-seo

**Entrar a:** http://76.13.121.6:3000 → proyecto `apps`

**Paso 1: Crear servicio Redis** (click en + → Redis)
- Nombre: `cerebro-seo-redis`
- Una vez creado, anota la URL interna: `redis://cerebro-seo-redis:6379`

**Paso 2: Crear base de datos** para cerebro-seo
- Opción A: Usar el servicio `cerebro-db` existente
  - Acceder a pgWeb: https://apps-cerebro-db-pgweb.6lk5jx.easypanel.host
  - Crear database `cerebro_seo` (SQL: `CREATE DATABASE cerebro_seo;`)
  - DATABASE_URL producción: `postgresql://cerebro:{PASS}@cerebro-db:5432/cerebro_seo`
- Opción B: Crear un servicio Postgres nuevo → nombre `cerebro-seo-db`
  - DATABASE_URL: `postgresql://{user}:{pass}@cerebro-seo-db:5432/cerebro_seo`

**Paso 3: Crear servicio App** (click en + → App)
- Nombre: `cerebro-seo`
- Fuente: GitHub → `jorgeruiz/cerebro-seo` → branch: `main`
- Build: Dockerfile
- Puerto: 3000

**Paso 4: Variables de entorno** del servicio `cerebro-seo`:
```env
DATABASE_URL=postgresql://cerebro:{PASS}@cerebro-db:5432/cerebro_seo
REDIS_URL=redis://cerebro-seo-redis:6379
NEXTAUTH_URL=https://seo.clicksociety.mx
NEXTAUTH_SECRET={mismo que local o generar nuevo}
GOOGLE_CLIENT_ID={de .env.local}
GOOGLE_CLIENT_SECRET={de .env.local}
DATAFORSEO_LOGIN={de .env.local}
DATAFORSEO_PASSWORD={de .env.local}
ANTHROPIC_API_KEY={de .env.local}
NOTION_API_KEY={de .env.local}
```

**Paso 5: Dominio**
- En el servicio `cerebro-seo`: Domains → Add → `seo.clicksociety.mx`
- HTTPS se configura automáticamente via Let's Encrypt

**Paso 6: Primer deploy**
- Click "Deploy" en el servicio
- Observar logs hasta que diga "Ready on port 3000"
- Después del primer deploy exitoso, ejecutar la migración de Prisma en producción:
  - En la terminal del servicio (o via SSH al VPS): `npx prisma migrate deploy`

### 10.3 DNS
Agregar en tu registrador de dominios:
```
Tipo: A
Nombre: seo (o seo.clicksociety.mx)
Valor: 76.13.121.6
TTL: 300
```

### 10.4 Google OAuth Console
URL: https://console.developers.google.com → credenciales → tu OAuth Client ID de Cerebro SEO

Agregar en "Authorized redirect URIs":
```
https://seo.clicksociety.mx/api/auth/callback/google
```

### 10.5 Primera sesión en producción
1. Abrir `https://seo.clicksociety.mx`
2. Hacer login con Google (`jorge.arm@gmail.com`)
3. **¡Importante!** Google pedirá autorización a GSC y GA4 — aceptar TODOS los permisos
4. Si ya tenías sesión anterior sin esos scopes, cerrar sesión primero y volver a entrar
5. Después del login con nuevos scopes, los datos reales de GSC/GA4 deberían aparecer en la portada de cada cliente

---

## 11. Métricas de éxito

**Internas (Click Society):**
- Reducción de horas/mes de reporting manual: meta -50%
- Hipótesis validadas por mes: meta ≥ 60%
- Costo de stack SEO: meta < $50 USD/mes con 10 clientes

**Producto:**
- Tiempo de generación de reporte mensual: meta < 5 minutos
- Uptime: meta > 99%
- Costo DataForSEO por cliente/mes: meta < $5 USD
