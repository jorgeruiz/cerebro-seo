# Cerebro SEO — Project State

> Documento vivo. Se actualiza al inicio y cierre de cada sesión de trabajo.

**Última actualización:** 2026-05-19
**Fase actual:** Fase 1 — ✅ COMPLETA. GSC y GA4 con datos reales validados en producción.
**Próximo hito:** Sesión 12 — Planear Fase 2 (resolver estrategia de roles + rotar credenciales pendientes primero)

---

## ⚠ DEUDAS ACTIVAS — LEER ANTES DE CONTINUAR

> Esta sección se escribe al inicio de cada contexto para que no se pierda entre el historial.

### ~~🔴 Deuda crítica: Estrategia de roles~~ ✅ RESUELTA (2026-05-19)

`ADMIN_EMAILS` env var en Easypanel promueve a ADMIN automáticamente en el jwt callback, sin tocar la BD. EDITORs (cualquier login no en la lista) ven todos los clientes activos — `ClientUser` granular dormido. Confirmar emails con Jorge antes del deploy.

### 🔴 Deuda de seguridad: Credenciales pendientes de rotación

Ya rotadas: Anthropic, Notion Integration Token, Google OAuth Client Secret, DataForSEO.

**Pendientes (rotar esta semana):**
- `NEXTAUTH_SECRET` — verificar que sea robusto; rotar si fue generado en chat
- Postgres password (`CerebroClick2026#`)
- Redis password
- `SEO_INTERNAL_SECRET`
- Meta Access Token (si aplica al proyecto)

### 🟡 Deuda operativa: Auto-deploy de Easypanel

El auto-deploy tras `git push` no siempre se dispara. Varias veces en la saga requirió redeploy manual vía API tRPC. Investigar configuración webhook GitHub → Easypanel.

### 🟡 Deuda de seguridad: Secrets en imagen Docker

El Dockerfile usa `ARG`/`ENV` con valores placeholder antes del build. Easypanel logs y capas de imagen pueden exponer metadata de los ARGs. Refactorizar a runtime-only vars en sesión futura (no urgente, los placeholders no son los secrets reales).

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
| Prisma migrations | ✅ Completo | `init` (21 tablas) + `add_client_services` (TEXT[] services). Ambas en `_prisma_migrations` de producción. |
| Next.js + TypeScript | ✅ Completo | App Router, Tailwind, shadcn base-nova |
| Prisma schema | ✅ Completo | Todos los modelos + NextAuth (ADMIN/EDITOR) + JobLog |
| Auth (NextAuth) | ✅ Completo | Google OAuth + JWT strategy + roles. Validado en producción: `https://seo.clicksociety.com.mx` |
| Layout + branding | ✅ Completo | Sidebar, gradiente Click Society |
| App arranca con BD real | ✅ Verificado | `npm run dev` → 307 redirect a `/api/auth/signin` (correcto) |
| Sistema de multiagentes | ✅ Completo | 3 queues BullMQ, base-worker, InsightsAgent con prompt caching |
| Listado de clientes | ✅ Completo | Grid con alertas, tareas, estado del ciclo |
| Wizard de alta de cliente | ✅ Completo | 3 pasos: datos, propiedades GSC/GA4, keywords/competidores |
| Vista detalle del cliente | ✅ Completo | Portada con GSC real (snapshot 28d + gráfica 365d), CTA conectar, lock icons módulos no-SEO |
| Provider layer DataForSEO | ✅ Completo | `seo-data.ts` (interface) + `dataforseo.ts` (4 métodos reales + stubs) |
| Script de validación DataForSEO | ✅ Ejecutado (×2) | Sesión 3: $0.228 USD sin BD. Sesión 4: $0.225 USD con BD — 15 rows en ApiUsage |
| ApiUsage table poblada | ✅ Completo | 15 rows, $0.225 USD total — datos reales de Sesión 4 |
| Auth: scopes GSC+GA4 | ✅ Completo | `auth.ts` actualizado: `webmasters.readonly` + `analytics.readonly` + refresh token |
| Conexión GSC | ✅ Completo + validado | Provider con caché Redis 24h. Snapshot 28d + gráfica 365d en portada. Datos confirmados en producción con Molino Azteca. |
| Conexión GA4 | ✅ Completo | Snapshot 28d con deltas vs período anterior. Ga4SnapshotCards en portada. CTA si ga4Property vacío. Sesión 11. |
| `google-oauth.ts` | ✅ Completo | Helper OAuth2Client con auto-refresh de tokens persistido en DB |
| Seed de clientes | ✅ Completo | 42 clientes + 42 sites sembrados en producción desde Notion (via consola del contenedor) |
| Login simplificado | ✅ Completo | Solo Google OAuth (sin magic link eliminado) |
| Build de producción | ✅ Completo | `npm run build` sin errores — tailwind.config.ts y globals.css corregidos |
| Deploy inicial Easypanel | ✅ Completo | App en producción. HTTP 307 verificado. BD `cerebro_seo` creada. Migraciones aplicadas. |
| URL producción (custom) | ✅ Activo | `https://seo.clicksociety.com.mx` → HTTP 307 → `/api/auth/signin`. DNS A record en clicksociety.com.mx. |
| Build Docker producción | ✅ Completo | `force-dynamic` en páginas Prisma, `lazyConnect` en Redis, `SKIP_ENV_VALIDATION=1`. Dockerfile reestructurado. `NODE_OPTIONS=--max-old-space-size=4096` para evitar OOM. |
| Redis producción | ✅ Completo | `apps-cerebro-seo-redis:6379` (hostname con guiones). Dos clientes separados: `redis` (cache, fail-fast) y `redisBullMQ` (BullMQ). Error listeners activos. |
| Filtrado por servicio SEO | ✅ Completo | Toggle SEO/Todos en `/clientes`. Badges de servicios en tarjetas. Lock icons en módulos SEO para clientes sin ese servicio. |
| Roles ADMIN/EDITOR | ✅ Operativo (con deuda) | Jorge = ADMIN en producción (promovido manualmente 2026-05-17). `@default(EDITOR)` requiere estrategia para futuros usuarios. Ver §DEUDAS. |
| Validación GSC datos | ✅ Validado | Números coherentes vs Search Console directo. |
| Validación GA4 datos | ✅ Validado | Números cuadran vs GA4 → Reports → Traffic Acquisition → Organic Search. |
| Validación calidad datos DataForSEO | ⏸ Diferido | Comparar `validation-report.md` vs GSC real. Pendiente para Fase 2 cuando se active tracking. |

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
| 2026-05-12 | **NextAuth usa `session.strategy: "jwt"` en producción.** Database strategy es incompatible con `next-auth/middleware` en Next.js 14 App Router: el middleware llama `getToken()` que solo decodifica JWTs — con database strategy la cookie tiene un UUID opaco y `getToken()` falla silenciosamente redirigiendo a `/login`. PrismaAdapter sigue activo para persistir User y Account. |
| 2026-05-12 | **Páginas server con Prisma/Redis requieren `export const dynamic = "force-dynamic"`.** Next.js intenta pre-renderizarlas en `npm run build`. Como BD y Redis no son accesibles en build time, el build falla. Páginas afectadas: `clientes/page.tsx`, `clientes/[id]/page.tsx`. |
| 2026-05-12 | **Dockerfile: ARG → ENV antes del `npm run build`.** Los ARGs de Docker no son visibles en el entorno de ejecución de `RUN` a menos que se exporten como ENV. Placeholders necesarios para que el build no falle aunque BD/Redis no estén disponibles. Redis además requiere `lazyConnect: true` en ioredis para no intentar conexión al importar el módulo. |
| 2026-05-12 | **Dominio de producción:** `seo.clicksociety.com.mx` (no `seo.clicksociety.mx`). El dominio de Click Society es `clicksociety.com.mx`, no el TLD `.mx`. DNS A record apuntando a `76.13.121.6`. |
| 2026-05-13 | **ADMIN ve todos los clientes sin filtrar por ClientUser.** `ClientUser` limita visibilidad solo para EDITORs (por email, no userId). Acceso EDITOR a cliente no asignado devuelve 404, no 403. |
| 2026-05-13 | **NextAuth en producción usa `session.strategy: "jwt"`.** Database strategy es incompatible con `next-auth/middleware` en App Router. PrismaAdapter sigue activo para persistir User y Account. |
| 2026-05-13 | **Páginas server que tocan Prisma o BullMQ requieren `export const dynamic = "force-dynamic"`.** Evita pre-render en build cuando BD/Redis no están accesibles. Páginas afectadas: `clientes/page.tsx`, `clientes/[id]/page.tsx`. |
| 2026-05-13 | **Cerebro SEO maneja todos los clientes activos (42), no solo SEO.** Vista default filtra `services.has("seo")`. Toggle "Todos los activos" muestra los 42. Costo variable (DataForSEO, Claude) solo aplica a clientes con `"seo"` en services. |
| 2026-05-13 | **Toggle SEO/Todos en `/clientes` con persistencia en localStorage via URL searchParam.** Default: filtro SEO activo. |
| 2026-05-13 | **Migraciones SIEMPRE con `prisma migrate dev` en local y `prisma migrate deploy` en producción.** Nunca SQL raw sin sincronizar `_prisma_migrations`. Si se aplicó SQL raw de emergencia, usar `prisma migrate resolve --applied <nombre>` antes del próximo deploy. |
| 2026-05-14 | **Cerebro SEO maneja todos los clientes activos (42), no solo SEO.** Vista default filtra a clientes con `services` incluyendo `"seo"` (~12). Toggle "Todos los activos" muestra los 42. Costo variable (DataForSEO, Claude) solo aplica a clientes con `"seo"` en services. |
| 2026-05-14 | **Campo `services String[]` en Client** (migración `add_client_services`). Valores normalizados: `seo`, `google_ads`, `meta_ads`, `contenidos`. Campo "Servicio" en Notion (multi_select). 12 clientes con SEO, 38 con Google Ads, 8 Meta Ads, 6 Contenidos. |
| 2026-05-14 | **Workers BullMQ**: jobs de tracking/insights/backlinks/competitors/ai-search solo se encolan para clientes con `services.includes("seo")`. Audit y sync aplican a todos los activos. |
| 2026-05-14 | **Módulos SEO de vista detalle**: muestran lock icon + tooltip para clientes sin servicio SEO. Módulos sin lock: Términos de búsqueda, Tráfico de páginas, Eventos, Site Audit. |
| 2026-05-14 | **Dockerfile estructurado para invalidar caché correctamente**: `COPY prisma ./prisma` + `RUN prisma generate` ANTES del `COPY . .` para que la capa Prisma sea independiente del código fuente. Cualquier cambio en `src/` invalida solo las capas posteriores. |
| 2026-05-14 | **Migraciones siempre con `prisma migrate deploy` en startup** (no `db push`). Si una migración fue aplicada con SQL raw, usar `prisma migrate resolve --applied <nombre>` para registrarla en `_prisma_migrations` con el checksum correcto ANTES del siguiente deploy. |
| 2026-05-14 | **`startup.mjs` corre `prisma migrate deploy` que es idempotente**: si la migración ya está en `_prisma_migrations`, la salta sin re-aplicar el SQL. Garantiza arranque limpio en todos los deploys. |
| 2026-05-15 | **Build de Next.js requiere mínimo 4GB de heap.** Configurado en Dockerfile: `NODE_OPTIONS="--max-old-space-size=4096"` en el paso `RUN npm run build`. El default de Node (~1.5GB) agota el heap a los ~270s durante `next build`. |
| 2026-05-15 | **REDIS_URL en producción debe usar hostname interno con guiones (`apps-cerebro-seo-redis`), no underscores.** Underscores no son válidos en DNS; `ioredis` no puede resolver el hostname y la conexión falla silenciosamente. |
| 2026-05-15 | **Credenciales rotadas tras exposición accidental**: Anthropic API key, Notion Integration Token, Google OAuth Secret, DataForSEO API key. Pendiente rotar: Meta Access Token (si aplica), NEXTAUTH_SECRET, Postgres password, Redis password, SEO_INTERNAL_SECRET. |
| 2026-05-16 | **NextAuth usa `session.strategy: "jwt"` en producción.** Database strategy es incompatible con `next-auth/middleware` en App Router: el middleware llama `getToken()` que solo decodifica JWTs, con database strategy recibe un UUID opaco y falla silenciosamente. PrismaAdapter sigue activo para persistir User y Account. |
| 2026-05-16 | **`NEXTAUTH_URL_INTERNAL` debe ser el dominio público en producción**, no `http://localhost:3000`. Next.js usa esta variable para llamadas internas del middleware — si apunta a localhost, el middleware falla en el contenedor. |
| 2026-05-16 | **ADMIN ve todos los clientes activos; EDITOR solo los asignados vía `ClientUser` por email.** La tabla `ClientUser` está actualmente vacía — EDITORs sin asignaciones ven lista vacía. Requiere estrategia de roles resuelta antes de dar acceso al equipo. |
| 2026-05-16 | **El schema tiene `role UserRole @default(EDITOR)`**: todo login nuevo queda como EDITOR. Jorge promovido a ADMIN vía `UPDATE "User" SET role='ADMIN'` directamente en BD de producción (2026-05-17). No es escalable sin mecanismo automático. |
| 2026-05-16 | **Cerebro SEO maneja 42 clientes activos**. Vista default filtra a los 12 con servicio `seo`. Toggle "Todos los activos" muestra los 42. Costo variable (DataForSEO/Claude) solo para clientes con `services.includes("seo")`. |
| 2026-05-16 | **`REDIS_URL` en producción**: `redis://default:[password]@apps-cerebro-seo-redis:6379`. Hostname con guiones (no underscores — no válidos en DNS). Password embebido en la URL. Dos clientes en el código: `redis` (cache, fail-fast) y `redisBullMQ` (BullMQ, `maxRetriesPerRequest: null`). |
| 2026-05-16 | **Providers (GSC, GA4, DataForSEO) tienen `try/catch` en operaciones Redis.** Si Redis está caído, los providers van directo a la API externa (sin caché, pero con datos). Redis caído no bloquea el render de páginas. |
| 2026-05-19 | **GA4 validado en producción: el provider filtra a tráfico orgánico (`sessionDefaultChannelGrouping = "Organic Search"`)**, no tráfico total. Al validar los números del panel contra GA4 directo, ir a **Reports → Traffic Acquisition → Organic Search**, NO al Home/Overview de GA4 (que suma todos los canales). Comparar contra el total es falso negativo. |
| 2026-05-19 | **GSC y GA4 con datos reales validados en producción. Fase 1 COMPLETA.** |
| 2026-05-19 | **Estrategia de roles: `ADMIN_EMAILS` env var.** Lista de emails separados por coma en Easypanel → jwt callback promueve a ADMIN en cada login sin tocar la BD. Retrocompatible: si la var no está definida, el rol viene de la BD. `@default(EDITOR)` en schema sigue activo — todo login nuevo que no esté en ADMIN_EMAILS entra como EDITOR. |
| 2026-05-19 | **ClientUser granular dormido.** Todos los usuarios autenticados (ADMIN y EDITOR) ven todos los clientes activos. ClientUser se activará en Fase 2+ si se necesita restricción por cuenta. EDITOR no ve costos de API (no hay UI de costos expuesta). |

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

**Completado (Sesiones 6 y 7 — deploy y login producción):**
- [x] Setup Easypanel completo vía API tRPC: servicios Redis + App, env vars, dominios, build type
- [x] `Dockerfile` + `startup.mjs`: build multi-stage, crea BD `cerebro_seo`, corre migraciones, arranca Next.js
- [x] `src/env.ts`: guard `SKIP_ENV_VALIDATION=1` para build Docker
- [x] `src/lib/redis.ts`: `lazyConnect: true` — evita ECONNREFUSED en build time
- [x] `export const dynamic = "force-dynamic"` en `clientes/page.tsx` y `clientes/[id]/page.tsx`
- [x] `src/lib/auth.ts`: `session.strategy: "jwt"` — fix crítico para que el middleware funcione en App Router
- [x] `src/types/next-auth.d.ts`: extensión JWT con `id` y `role`
- [x] Login en producción verificado: `jorge@clicksociety.com.mx` → `/clientes` con sesión activa
- [x] DNS `seo.clicksociety.com.mx` → `76.13.121.6` activo
- [x] Google OAuth redirect URI `https://seo.clicksociety.com.mx/api/auth/callback/google` registrado

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

**Completado (Sesiones 8 y 9 — 2026-05-13/14):**
- [x] `actions.ts`: server actions `listGscSites()`, `setClientGscProperty()`, `getGscSnapshot()` (snapshot 28d con deltas vs período anterior)
- [x] `GscConnectSection.tsx`: CTA para conectar GSC cuando `site.gscProperty` no está configurado
- [x] `GscSnapshotCards.tsx`: 4 KPI cards (clics, impresiones, posición, CTR) con TrendingUp/TrendingDown
- [x] `ClientPortadaChart.tsx`: rangos 28d/90d/12m (removido 7d), default 90d, fetch de 365d para soportar 12m sin extra calls
- [x] Tests vitest: `google-search-console.test.ts` — 4 casos (happy path, ceros, caché hit)
- [x] `services String[]` en Client — migración `add_client_services` + seed desde Notion (42 clientes, 12 con SEO)
- [x] `ServiceToggle.tsx`: filtro SEO/Todos persistido en localStorage + URL searchParam
- [x] Lock icons en módulos SEO de portada para clientes sin servicio SEO contratado
- [x] BullMQ schedulers: jobs de costo variable solo para clientes con `services.includes("seo")`
- [x] Dockerfile reestructurado: capa Prisma independiente del código fuente
- [x] Migración `add_client_services` registrada en `_prisma_migrations` via `prisma migrate resolve --applied`
- [x] Seed de clientes corrido en producción: 42 clientes + servicios desde Notion

**Completado (Sesiones 10/11 — 2026-05-15 a 2026-05-18):**
- [x] `fix: fallback correcto en ClientPortadaChart cuando gscData es null`
- [x] `fix: aumentar heap de Node a 4GB durante build para evitar OOM`
- [x] `fix: eliminar fallback hardcodeado de Redis y desacoplar providers de Redis`
- [x] `fix: dos clientes Redis separados (cache fail-fast + BullMQ)`
- [x] Rol de Jorge promovido a ADMIN en producción vía UPDATE directo en BD
- [x] `feat: GA4 snapshot 28d con deltas en portada del cliente` (Ga4SnapshotCards, getGa4Snapshot, CTA)
- [x] `feat: infraestructura tRPC + clientesRouter en paralelo a /api/clientes`

**Pendiente (Sesión 12 — con supervisión de Jorge):**
- [ ] **Validar GSC + GA4 en producción**: Jorge abre Molino Azteca, confirma snapshot vs GSC/GA4 directo; si GA4 muestra "sin datos" → logout+login para activar scope
- [x] **Estrategia de roles**: implementada vía `ADMIN_EMAILS` env var (2026-05-19)
- [ ] **Rotar credenciales**: NEXTAUTH_SECRET, Postgres password, Redis password, SEO_INTERNAL_SECRET, Meta Token (Jorge)
- [ ] **Migrar wizard /api/clientes → tRPC**: llamar `api.clientes.crear` desde el wizard Next.js (requiere `@trpc/client` + `@trpc/react-query` en frontend)

---

## 5b. Próximo paso concreto para el chat nuevo

**LEER ESTO PRIMERO** — estado al 2026-05-18:

1. **GA4 en portada** (último deliverable de Fase 1): implementar `getGa4Snapshot(clientId)` en `actions.ts` análogo a `getGscSnapshot()`, y `Ga4SnapshotCards.tsx` análogo a `GscSnapshotCards.tsx`. El provider `GoogleAnalytics4Provider.getOverview()` ya existe en `src/server/providers/google-analytics-4.ts`. El scope `analytics.readonly` ya está en OAuth. Jorge tiene tokens GA4 en producción (los solicitó al hacer login con scope offline).

2. **Verificar estado GA4**: algunos clientes tienen `ga4Property` en `Site` (los que Jorge configuró en el wizard). Los que no, mostrarán el bloque GA4 vacío o con CTA.

3. **Validar GSC**: Jorge debe entrar a `https://seo.clicksociety.com.mx`, abrir Molino Azteca y confirmar que la gráfica y snapshot son coherentes con Search Console directo.

4. **Resolver estrategia de roles** antes de dar acceso a Félix/Cindy.

5. Tras GA4 + validaciones + roles: **Fase 1 oficialmente cerrada**, arrancar planificación de Fase 2.

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
| GA4 en portada | ✅ Implementado (Sesión 11) | `Ga4SnapshotCards` con deltas 28d vs 28d anterior. Jorge debe validar datos en producción. |
| Validación GSC vs Search Console directo | Jorge | Ir a Molino Azteca, RFN y Quicsa en producción; comparar snapshot 28d y gráfica contra Search Console directo. |
| Estrategia de roles | ✅ Resuelto | `ADMIN_EMAILS` env var implementada. Confirmar emails con Jorge y configurar en Easypanel antes del primer login de Félix/Cindy. |
| Credenciales pendientes | Jorge | Rotar: NEXTAUTH_SECRET, Postgres password, Redis password, SEO_INTERNAL_SECRET, Meta Access Token. |

---

## 7. Riesgos vivos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Calidad datos DataForSEO insuficiente | Baja | Alto | Validación vs GSC pendiente (Molino Azteca parece correcto; RFN y Quicsa no rankean — validar en GSC) |
| Costos DataForSEO más altos de lo estimado | Media | Medio | Costo real depth:100 = $0.0155/query; para producción usar Standard Queue + depth menor |
| Sync con Cerebro más complejo de lo previsto | Media | Medio | REST simple ya decidido; `cerebro-bridge.ts` pendiente |
| Sitios bloquean al crawler | Media | Bajo | User agent custom, respeto robots.txt, fallback Playwright |
| Bug de autorización entre clientes | Baja | Crítico | Toda query Prisma filtra por `clientId` de sesión |
| ADMIN_EMAILS sin configurar en Easypanel | Media | Alto | Código implementado; falta agregar la env var con los emails confirmados. Sin ella, nuevos logins son EDITOR pero SÍ ven clientes (ClientUser dormido). |
| Credenciales pendientes de rotación | Alta | Alto | NEXTAUTH_SECRET, Postgres pwd, Redis pwd, SEO_INTERNAL_SECRET, Meta Token. Plazo: esta semana. |

---

## 8. Bitácora de sesiones

### Sesión 11 — 2026-05-18 (autónoma)
**Participantes:** Claude Code (Jorge no disponible en tiempo real)
**Resultado:** ✅ GA4 en portada implementado. tRPC base creada en paralelo. Build limpio.

**Diagnóstico inicial (antes de codear):**
- Scope `analytics.readonly`: ✅ ya estaba en `auth.ts` desde Sesión 5
- Provider `google-analytics-4.ts`: ✅ completo y resiliente (try/catch Redis, TTL 4h)
- `ga4Property` en BD: ✅ poblado por seed desde Notion
- Gap real: código de portada tenía fetch de 90d sin deltas, sin CTA, sin snapshot 28d comparativo

**TAREA 1 — GA4 en portada:**
- `actions.ts`: nuevo tipo `Ga4Snapshot` + `getGa4Snapshot()` server action (28d actual vs 28d anterior, filtro Organic Search, análogo exacto a `getGscSnapshot()`)
- `Ga4SnapshotCards.tsx`: 4 KPI cards con `DeltaBadge` (sesiones, usuarios, tasa de rebote, conversiones)
- `page.tsx`: reemplaza bloque 90d sin deltas por `Ga4SnapshotCards`; muestra CTA cuando `ga4Property` vacío; mensaje de error cuando property existe pero sin datos; desacopla GA4 del `oauth` directo del page (usa server action que maneja auth internamente)

**TAREA 2 — Infraestructura tRPC:**
- Instaló `@trpc/server v11`
- `src/server/trpc/index.ts`: contexto con sesión, `publicProcedure`, `protectedProcedure`, `adminProcedure`
- `src/server/trpc/routers/clientes.ts`: `clientes.crear` (adminProcedure, equivale a POST /api/clientes) + `clientes.listar` (protectedProcedure, ADMIN/EDITOR con lógica de ClientUser)
- `src/server/trpc/router.ts`: `appRouter` raíz
- `src/app/api/trpc/[trpc]/route.ts`: handler App Router
- `/api/clientes` REST sigue activo en paralelo (NO eliminado)

**Commits realizados:**
- `feat: GA4 snapshot 28d con deltas en portada del cliente` (0bffaab)
- `feat: infraestructura tRPC + clientesRouter en paralelo a /api/clientes` (a9d1e9c)

**⚠ Acción REQUERIDA de Jorge:**
GA4 puede no mostrar datos si los tokens OAuth de Jorge fueron generados ANTES de que `analytics.readonly` estuviera en el scope (Session 5, 2026-05-11). Para verificar: ir a `https://seo.clicksociety.com.mx`, abrir cualquier cliente con `ga4Property` configurado. Si aparece "Sin datos de Analytics disponibles" → hacer **logout + login** para regenerar tokens con todos los scopes. Si aparece `Ga4SnapshotCards` con números → funciona.

**Costo de APIs:** $0 (no se llamó a DataForSEO ni Claude).

**Bloqueadores restantes:**
- Validación GSC + GA4 con datos reales (Jorge, manual en producción)
- Estrategia de roles (Jorge debe decidir antes de onboarding de equipo)
- Credenciales pendientes de rotación (Jorge)

---

### SAGA 2026-05-12/16 — Resumen consolidado de bugs y decisiones
**Participantes:** Jorge + Claude Code (sesiones 6 a 10 + cierre 11)
**Resultado final:** ✅ App en producción con datos GSC reales. 42 clientes importados. Infraestructura estable. Fase 1 cerrada salvo GA4.

**Cadena completa de bugs resueltos (en orden cronológico):**

| # | Síntoma | Causa raíz | Fix |
|---|---|---|---|
| 1 | ESLint falla: tipo `Function` en route handler | `as Function` rechazado por `@typescript-eslint/no-unsafe-function-type` | Revertir al patrón `export { handler as GET, handler as POST }` |
| 2 | `npm run build` falla en "Collecting page data" | Páginas con Prisma/Redis se pre-renderizan en build sin BD disponible | `export const dynamic = "force-dynamic"` + `lazyConnect: true` en Redis + ARG→ENV placeholders en Dockerfile |
| 3 | `OAuthCallbackError: State cookie was missing` | `session.strategy: "database"` (default con PrismaAdapter) — middleware llama `getToken()` que solo entiende JWTs, no el UUID opaco de las cookies de database strategy | `session.strategy: "jwt"` en authOptions |
| 4 | Docker cache: contenedor usaba código viejo tras push | `COPY . .` invalidaba capas incluyendo `prisma generate` en cada cambio de código | Reestructurar Dockerfile: `COPY prisma ./prisma` + `RUN prisma generate` ANTES del `COPY . .` |
| 5 | `NEXTAUTH_URL_INTERNAL` causaba loops de redirect | Estaba en `http://localhost:3000` — Next.js usaba esa URL para llamadas internas del middleware en el contenedor | Cambiar a `https://seo.clicksociety.com.mx` (dominio público) |
| 6 | Seed fallaba: `SEO_INTERNAL_SECRET` y `META_ACCESS_TOKEN` no definidas en env vars del build | Variables opcionales en schema Zod pero Easypanel las requería definidas | Agregar ambas a Easypanel con valores placeholder o vacíos |
| 7 | `/clientes` mostraba lista vacía para Jorge | Jorge tenía `role: EDITOR` (default) y `ClientUser` vacío → query filtraba por asignaciones (0 resultados) | Promover Jorge a ADMIN vía UPDATE en BD de producción |
| 8 | BD de producción vacía (0 clientes tras deploy) | `seed-clients.ts` nunca se había corrido en producción | Correr seed desde Easypanel Console via `npx tsx scripts/seed-clients.ts` |
| 9 | Migración `add_client_services` no en `_prisma_migrations` | SQL raw aplicado directamente sin pasar por Prisma migrate | Escribir `migration.sql` real y `prisma migrate resolve --applied` para registrar con checksum correcto |
| 10 | Portada mostraba "Google Search Console no configurado" cuando `gscData = null` | Fallback residual en `ClientPortadaChart` pre-`GscConnectSection`; `gscProperty` estaba en DB pero tokens OAuth faltaban → `gscData = null` | Actualizar fallback a "Sin datos de tráfico orgánico · vuelve a cargar la página" |
| 11 | Redis sin password: `ENOTFOUND cerebro-seo-redis` | `REDIS_URL` apuntaba a `redis://cerebro-seo-redis:6379` (sin `apps-` prefix, sin password) — hostname antiguo inválido en DNS | Corregir `REDIS_URL` en Easypanel a `redis://default:[pwd]@apps-cerebro-seo-redis:6379` |
| 12 | Redis: "Unhandled error event" crasheaba la app | Ningún listener `.on('error', ...)` en el cliente ioredis — error de reconexión lanzado como excepción no manejada | Agregar error listener + split en dos clientes: `redis` (cache, fail-fast) y `redisBullMQ` (BullMQ) |
| 13 | Build falla con OOM a los ~270s en Easypanel | `next build` supera el heap default de Node (~1.5GB) con las dependencias actuales | `NODE_OPTIONS="--max-old-space-size=4096"` en el paso `RUN` del Dockerfile |
| 14 | Redis hardcodeado: `redis.get()` colgaba indefinidamente si Redis caído | `maxRetriesPerRequest: null` (requerido por BullMQ) hacía que comandos de cache esperaran forever | Dos clientes: cache con `maxRetriesPerRequest: 0` + `try/catch` en providers |
| 15 | Bug raíz lista vacía: rol EDITOR en lugar de ADMIN | `role @default(EDITOR)` — todo login nuevo queda como EDITOR; no había mecanismo de promoción automática | UPDATE manual en BD + documentar como deuda de arquitectura de roles |

---

### Sesión 10 — 2026-05-15/16
**Participantes:** Jorge + Claude Code
**Resultado:** ✅ Build de producción operativo. Redis desacoplado de providers. App resiliente a fallos de Redis.

**Bugs resueltos:**

1. **OOM durante `next build` en Easypanel** — `next build` agota el heap default de Node (~1.5GB) después de ~270s. Fix: `NODE_OPTIONS="--max-old-space-size=4096"` en el paso `RUN` del Dockerfile. Build completado exitosamente tras el fix.

2. **Fallback incorrecto en `ClientPortadaChart`** — cuando `gscData` era `null` (OAuth sin tokens), el componente mostraba "Google Search Console no configurado. Agrega el campo gscProperty..." — mensaje residual de antes de que existiera `GscConnectSection`. Fix: actualizado al mensaje correcto "Sin datos de tráfico orgánico · vuelve a cargar la página."

3. **REDIS_URL con hostname inválido** — hostname `apps_cerebro_seo_redis` (con underscores) no es válido en DNS. Fix: cambiado a `apps-cerebro-seo-redis` (guiones) en Easypanel. `ioredis` no puede resolver hostnames con underscores.

4. **"Unhandled error event" de ioredis crasheaba la app** — el cliente Redis no tenía listener `.on('error', ...)`. Cuando Redis tenía un error de conexión en background, Node.js lo trataba como excepción no manejada y crasheaba el proceso. Fix: error listener en ambos clientes Redis.

5. **Un solo cliente Redis para BullMQ y cache** — `maxRetriesPerRequest: null` (requerido por BullMQ) hacía que `redis.get()` en los providers colgara indefinidamente si Redis estaba caído. Fix: dos clientes separados — `redis` (cache, `maxRetriesPerRequest: 0`, fail-fast) y `redisBullMQ` (BullMQ, `maxRetriesPerRequest: null`).

6. **Providers sin manejo de fallos de Redis** — si Redis estaba caído, los providers lanzaban el error al caller (page.tsx) y `gscData` quedaba `null` (sin datos de GSC en lugar de solo sin caché). Fix: `try/catch` alrededor de `redis.get()` y `redis.set()` en los tres providers — si Redis falla, van directo a la API externa.

**Commits realizados:**
- `fix: fallback correcto en ClientPortadaChart cuando gscData es null`
- `fix: aumentar heap de Node a 4GB durante build para evitar OOM`
- `docs: cierre sesión 2026-05-15 — OOM resuelto, Redis configurado, credenciales rotadas`
- `fix: eliminar fallback hardcodeado de Redis y desacoplar providers de Redis`

**Costo de APIs:** $0 (solo infraestructura).

**Pendiente para próxima sesión:**
- Rotar credenciales pendientes: Meta Access Token, NEXTAUTH_SECRET, Postgres password, Redis password, SEO_INTERNAL_SECRET
- Jorge validar portada de Molino Azteca con datos GSC reales (logout + re-login si CTA aparece)
- Conectar GA4 snapshot en portada (Sesión 11)

---

### Sesión 9 — 2026-05-13/14
**Participantes:** Jorge + Claude Code
**Resultado:** ✅ Campo `services`, filtrado SEO/Todos, Docker reestructurado, 42 clientes sembrados en producción con servicios correctos. Fase 1 cerrada (salvo GA4 en portada).

**Commits realizados:**
- `feat: campo services en Client — migración, seed desde Notion, toggle SEO/Todos en /clientes`
- `feat: lock icons para módulos SEO en portada del cliente`
- `fix: reestructurar Dockerfile para invalidar caché de Docker correctamente`
- `fix: registrar migración add_client_services en _prisma_migrations vía resolve --applied`

**Trabajo realizado:**
- `prisma/schema.prisma`: campo `services String[] @default([])` en `Client` con slugs normalizados.
- `prisma/migrations/20260514021440_add_client_services/migration.sql`: `ALTER TABLE "Client" ADD COLUMN "services" TEXT[] DEFAULT ARRAY[]::TEXT[]`.
- `src/lib/notion-direct.ts`: mapeo `SERVICE_SLUG_MAP` de valores Notion (`"SEO"`, `"Google Ads"`, etc.) a slugs internos. Lee campo `"Servicio"` (multi_select) de la página de Notion.
- `scripts/seed-clients.ts`: upsert actualizado para incluir `services` en create y update.
- `src/app/(admin)/clientes/page.tsx`: filtro por `services.has("seo")`, toggle SEO/Todos, badges de servicios en tarjetas, `CycleStatusBadge` inlined.
- `src/app/(admin)/clientes/ServiceToggle.tsx`: componente "use client" con persistencia en localStorage (`cerebroseo:clientFilter`) y sincronización con URL searchParam `?filter=seo|all`.
- `src/app/(admin)/clientes/[id]/page.tsx`: constante `hasSeo = client.services.includes("seo")`, lock icon en módulos SEO para clientes sin ese servicio, guard EDITOR via `ClientUser`.
- `src/server/jobs/schedulers.ts`: `initSchedulers` pasa `services` a `registerClientJobs`. Jobs de costo variable (tracking, insights, backlinks, competitors, ai-search) solo se encolan para clientes con `"seo"` en services.
- `Dockerfile`: reestructurado — `COPY prisma ./prisma` + `RUN npx prisma generate` ANTES de `COPY . .` para que la capa Prisma sea independiente del código fuente.

**Trabajo de producción (emergencia):**
- BD de producción estaba vacía (seed no se había corrido). Seed ejecutado desde Easypanel Console (Service Console → Sh) via `npx tsx scripts/seed-clients.ts`. 42 clientes + 42 sites sembrados.
- Migration `add_client_services` fue aplicada con SQL raw antes de que existiera el archivo `migration.sql`. Registrada correctamente via `prisma migrate resolve --applied 20260514021440_add_client_services` (con el archivo SQL real para checksum correcto).
- Services actualizados en los 42 clientes: 12 con `seo`, distribución real desde Notion.

**Hallazgos técnicos:**
- `prisma migrate resolve --applied` requiere que `migration.sql` exista en `prisma/migrations/<nombre>/` — Prisma calcula el checksum del archivo para registrarlo correctamente. Un INSERT manual a `_prisma_migrations` falla por checksum incorrecto.
- Parches manuales en contenedor (sed, SQL raw, prisma generate en vivo) son ephemeros — cualquier restart del servicio los pierde. El flujo correcto es siempre: local → commit → push → `startup.mjs` corre `prisma migrate deploy`.
- Alpine Linux usa `sh` (no bash). Single quotes no pueden contener single quotes. Para commands complejos en Easypanel Console, usar variables temporales o heredocs.
- El campo `services String[]` de Prisma usa `has` para filtros: `{ services: { has: "seo" } }`.

**Costo de APIs en esta sesión:** $0 (sin llamadas DataForSEO ni Claude — trabajo de infraestructura y datos).

**Próximo paso recomendado (Sesión 10):**
1. Jorge entra a producción → navega a Molino Azteca → confirma snapshot GSC 28d y gráfica 365d con datos reales
2. Si la portada muestra CTA en lugar de datos: logout + re-login para regenerar tokens OAuth con scope `webmasters.readonly`
3. Claude Code: conectar GA4 snapshot + KPIs en portada (análogo a GSC — `getGscSnapshot` ya existe como referencia)

---

### Sesión 8 — 2026-05-13
**Participantes:** Claude Code (sesión nocturna autónoma)
**Resultado:** ✅ Portada GSC implementada. Validación con datos reales pendiente (sin tokens OAuth locales).

**Commits realizados:**
- `87d36bf` chore: agregar vitest como test runner con alias @/
- `41e22ef` feat: server actions para gestión de propiedad GSC del cliente
- `da55751` feat: componentes GscConnectSection y GscSnapshotCards
- `c3fa170` feat: portada del cliente con GSC real — snapshot 28d + gráfica 365d + CTA conectar
- `c22bd51` test: 4 casos para GoogleSearchConsoleProvider con vitest

**Trabajo realizado:**
- `actions.ts`: server actions `listGscSites()`, `setClientGscProperty()`, `getGscSnapshot()`. El snapshot calcula deltas 28d vs 28d anterior usando dos llamadas a `getOverview` con claves de caché independientes.
- `GscConnectSection.tsx`: componente client que carga propiedades GSC disponibles del usuario y persiste la selección. Usa `router.refresh()` para recargar el server component con datos reales tras conectar.
- `GscSnapshotCards.tsx`: 4 KPI cards (clics, impresiones, posición, CTR) con deltas vs período anterior. Indicadores verde/rojo con `TrendingUp`/`TrendingDown`.
- `page.tsx`: fetch de 365 días de datos diarios (para soportar 12m en el chart sin llamadas adicionales). Fetch paralelo de snapshot 28d. CTA de conexión cuando `site.gscProperty` está vacío.
- `ClientPortadaChart.tsx`: rangos 28d/90d/12m (removido 7d). Default 90d.
- Tests vitest: 4 casos (happy path getDailyMetrics, happy path getOverview, ceros sin datos, caché hit).
- `npm run build`: pasa limpio. `npm test`: 4/4 pasan.

**Hallazgos técnicos:**
- `gscProperty` ya estaba en la BD local (Molino Azteca: `http://www.molinoazteca.com`). El seed de Sesión 5 funcionó correctamente.
- Sin `Account` en BD local → sin tokens OAuth → la validación con datos reales no fue posible en este entorno.
- La validación debe hacerse en producción donde Jorge tiene sesión activa.

**Validación con Molino Azteca:** BLOQUEADA. Sin Account/tokens OAuth en BD local. El código es correcto y los tests lo verifican. Pendiente validación en producción por Jorge.

**Costo de APIs en esta sesión:** $0 (sin llamadas reales a GSC — BD local sin tokens).

**Próximo paso recomendado (Sesión 9):**
1. Jorge entra a producción → navega a un cliente con `gscProperty` → confirma datos vs GSC directo
2. Si el CTA aparece en lugar de datos: logout + re-login para regenerar tokens con scope webmasters
3. Claude Code: conectar GA4 en la misma portada (snapshot + KPIs análogos a GSC)

### Sesión 7 — 2026-05-12
**Participantes:** Jorge + Claude Code
**Resultado:** ✅ Login en producción operativo. Fase 1 completa.

**Cronología de bugs resueltos:**

1. **ESLint: tipo `Function` en route handler** — El debug wrapper temporal `wrappedHandler` usaba `as Function`, rechazado por `@typescript-eslint/no-unsafe-function-type`. Revertido al patrón estándar `export { handler as GET, handler as POST }`.

2. **Build falla en "Collecting page data"** — `clientes/page.tsx` y `clientes/[id]/page.tsx` llaman Prisma en Server Components. Next.js las pre-renderiza en build time cuando BD no está accesible. Fix: `export const dynamic = "force-dynamic"`. Adicionalmente, `redis.ts` se importa transitivamente desde los providers de GSC/GA4, causando ECONNREFUSED en build. Fix: `lazyConnect: true` en ioredis. Dockerfile actualizado con ARG → ENV placeholders antes del `npm run build`.

3. **OAuthCallbackError: "State cookie was missing"** — Diagnóstico inicial apuntaba a SameSite/cookies, pero el bug real era diferente. Con `session.strategy: "database"` (default con PrismaAdapter), la cookie `session-token` contiene un UUID opaco, no un JWT. `next-auth/middleware` llama internamente a `getToken()` que solo sabe decodificar JWTs — al recibir un UUID falla silenciosamente y redirige a `/login` aunque la sesión esté válida en la tabla Session de Postgres. Fix definitivo: `session.strategy: "jwt"` en authOptions. El callback `jwt` persiste `id` y `role` en el token; el callback `session` los lee desde el token (no desde BD). PrismaAdapter se mantiene para persistir User y Account.

**Aprendizajes para futuras sesiones:**
- `next-auth/middleware` en Next.js App Router requiere siempre `strategy: "jwt"` aunque se use PrismaAdapter
- Páginas server que tocan Prisma o Redis siempre necesitan `export const dynamic = "force-dynamic"` para builds Docker
- El dominio es `clicksociety.com.mx`, no `clicksociety.mx`
- Easypanel: `updateBuild` payload correcto es `{ build: { type: "dockerfile" } }` (no `{ type: "... "}` al nivel raíz)

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
- **URL producción:** `https://seo.clicksociety.com.mx` (activo, login verificado)

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

## 10. Próximos pasos — Sesión 8

### Para Jorge (antes de la próxima sesión de Code)
1. **Tokens GSC/GA4:** Hacer logout y volver a entrar en `https://seo.clicksociety.com.mx` para que la app guarde los access/refresh tokens de `jorge@clicksociety.com.mx`. Sin esto, la portada de cada cliente mostrará fallback en lugar de datos reales.
2. **Validar DataForSEO:** Revisar `validation-report.md` en la raíz del proyecto. Comparar posiciones de Molino Azteca, RFN y Quicsa vs lo que muestra Google Search Console para esas mismas keywords. Confirmar si los datos son confiables antes de Fase 2.
3. **Notion:** Compartir BD "Clientes Actuales" con la integración (ID: `32b0a146-5e52-81f9-8509-0027c0a09cd7`) para poder correr el seed.

### Para Claude Code (Sesión 9)
1. Validación GSC con datos reales de Molino Azteca (una vez Jorge confirme que la portada muestra datos)
2. GA4 snapshot en la misma portada (28d con delta vs período anterior, análogo a GscSnapshotCards)
3. Refinar UX de la portada según feedback de Jorge con datos reales
4. Decidir si Sesión 9 incluye Módulo Términos de búsqueda (GSC) o foco en validación

---

## 10.1 Notion — Compartir BD con integración (referencia)
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
