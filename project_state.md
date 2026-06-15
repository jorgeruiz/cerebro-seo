# Cerebro SEO — Project State

> Documento vivo. Se actualiza al inicio y cierre de cada sesión de trabajo.

**Última actualización:** 2026-06-15 (Sesión 39 — Primer deploy completo de producción ✅)
**Fase actual:** Post-Fase 4 — nuevos módulos + pulido
**Próximo hito:** Verificar login Google OAuth en producción con dominio real

---

## ⚠ DEUDAS ACTIVAS — LEER ANTES DE CONTINUAR

> Esta sección se escribe al inicio de cada contexto para que no se pierda entre el historial.

### ✅ Deuda de roles — RESUELTA (2026-06-03)

Estrategia C+A implementada y desplegada. Root cause identificado: NextAuth `jwt` callback solo corre en sign-in/token expiry, no en cada `getServerSession()`. El JWT de Félix tenía `role: EDITOR` cacheado. Fix: se agregó el chequeo de `ADMIN_EMAILS` también al callback `session` en `src/lib/auth.ts` — así el rol se recalcula en cada request al servidor sin requerir re-login. Jorge: `jorge@clicksociety.com.mx`. Félix: `felix@clicksociety.com.mx`. Ambos en `ADMIN_EMAILS` de Easypanel.

### 🟡 Deuda de seguridad: Credenciales pendientes de rotación

Rotadas en sesión 12 (2026-05-20):
- ✅ `NEXTAUTH_SECRET` — generado con `openssl rand -base64 32`, validado con login fresco
- ✅ `SEO_INTERNAL_SECRET` — generado y aplicado (preventivo para bridge Fase 2)
- ✅ Redis password — generado con `openssl rand -hex 32`, aplicado en `cerebro-seo-redis` Y en `REDIS_URL` de `cerebro-seo`, validado con GSC/GA4 cargando datos

Ya rotadas previamente: Anthropic, Notion Integration Token, Google OAuth Client Secret, DataForSEO.

**Pendientes:**
- ⏸ Postgres password — **APLAZADO**. El servicio `cerebro-db` es Postgres **compartido** entre Cerebro web y Cerebro SEO. Requiere sesión coordinada que actualice `DATABASE_URL` en ambos servicios simultáneamente. No rotar en sesión solo-Cerebro-SEO.
- N/A: Meta Access Token — no existe en Cerebro SEO (verificado 2026-05-20).

### 🟡 Deuda operativa: Auto-deploy de Easypanel

El auto-deploy tras `git push` no siempre se dispara. Varias veces en la saga requirió redeploy manual vía API tRPC. Investigar configuración webhook GitHub → Easypanel.

### ✅ Env vars de producción — CONFIGURADAS (2026-06-15)

Las variables de entorno estaban vacías en Easypanel — root cause del 502. En Sesión 39 se configuraron todas, y en Sesión 40 se corrigió el DATABASE_URL:
- `DATABASE_URL` → postgres compartido `cerebro-db` (`apps_cerebro-db:5432/cerebro_seo`, user `cerebro`, password `CerebroClick2026#`). La database `cerebro_seo` vive en el mismo servidor que `cerebro_db` (Cerebro web).
- `REDIS_URL` → `apps_cerebro-seo-redis:6379` (con password rotado)
- `NEXTAUTH_URL` → `https://seo.clicksociety.com.mx`
- `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `DATAFORSEO_*`, `ANTHROPIC_API_KEY`, `NOTION_API_KEY`, `CEREBRO_API_URL`, `SEO_INTERNAL_SECRET`, `GOOGLE_PAGESPEED_API_KEY`

**⚠️ Nota:** En Sesión 39 se creó erróneamente un postgres nuevo `cerebro-seo-db`. La BD real con 42 clientes y 2 usuarios siempre estuvo en `cerebro-db` (database `cerebro_seo`). El servicio `cerebro-seo-db` fue eliminado en Sesión 40.

**✅ Verificado:** Login Google OAuth funcionando. Jorge (ADMIN) y Felix (EDITOR) son los 2 usuarios existentes..

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
| Build Docker producción | ✅ Completo | `force-dynamic` en páginas Prisma, `lazyConnect` en Redis, `SKIP_ENV_VALIDATION=1`. Dockerfile reestructurado. `NODE_OPTIONS=--max-old-space-size=4096` + `cpus:1` en next.config. VPS tiene 4GB swap en `/swapfile`. |
| Redis producción | ✅ Completo | `apps_cerebro-seo-redis:6379` (underscore después de `apps`, guiones en el nombre del servicio — formato Easypanel). Password rotado 2026-05-20. Dos clientes separados. |
| Filtrado por servicio SEO | ✅ Completo | Toggle SEO/Todos en `/clientes`. Badges de servicios en tarjetas. Lock icons en módulos SEO para clientes sin ese servicio. |
| Roles ADMIN/EDITOR | ✅ Completo | C+A desplegado. Jorge + Félix = ADMIN vía `ADMIN_EMAILS`. Fix `session` callback garantiza re-eval en cada request. |
| Validación GSC datos | ✅ Validado | Números coherentes vs Search Console directo. |
| Validación GA4 datos | ✅ Validado | Números cuadran vs GA4 → Reports → Traffic Acquisition → Organic Search. |
| Módulo Términos de búsqueda | ✅ Implementado | `/clientes/[id]/terminos-busqueda`. Filtros device/country/range, tabla ordenable, SSR, cache 24h. Header Dark UI (Sesión 35). |
| Módulo Tráfico de páginas | ✅ Implementado | `/clientes/[id]/trafico-paginas`. Fusión GA4+GSC por URL (outer join), columnas condicionales, SSR, nulls al final. Header Dark UI (Sesión 35). |
| Bridge Cerebro web | ✅ Operativo | `cerebro-bridge.ts`, workers sync clientes y tareas activos (cada 6h y 15min). Endpoint `/api/internal/cerebro/.../monthly-summary` disponible. |
| Sección Operativa del mes | ✅ Implementado | 3 bloques en portada: Estrategia (focus+goals), Tareas (status badges), Hipótesis (validation badges). Estado vacío con "(Sync pendiente)". |
| Validación calidad datos DataForSEO | ⏸ Diferido | Comparar `validation-report.md` vs GSC real. Pendiente para Fase 2 cuando se active tracking. |
| Configuración editable del cliente | ✅ Completo | `/clientes/[id]/configuracion`. CRUD keywords (soft delete, priority cap 10, bulk paste 100), CRUD competidores (cap 5), edición GSC/GA4. Sesión 20. |
| Módulo Keywords — trigger manual | ✅ Completo | Botones "Trackear priority/bulk" visibles solo para ADMIN en `/clientes/[id]/keywords`. Enqueuean job BullMQ inmediato. Sesión 20. |
| Módulo Backlinks | ✅ Activo | `/clientes/[id]/backlinks`. BacklinksAgent semanal (jueves 5 AM). KPI cards, gráfica evolución, top 20, cambios semana. Insights algorítmicos. Sesión 21. |
| Módulo Competencia | ✅ Activo | `/clientes/[id]/competencia`. CompetitorAgent quincenal (días 1 y 15, 7 AM). SoV chart, cards por competidor, tabla keyword gaps. Insights algorítmicos. Sesión 22. |
| Módulo AI Search Visibility | ✅ Activo | `/clientes/[id]/ai-search`. AI-search worker semanal. Tasa de mención Claude Haiku, gráfica semanal, breakdown por LLM, detalle por query. Sesión 23. |
| Módulo Análisis Claude | ✅ Activo | `/clientes/[id]/analisis`. Análisis on-demand Sonnet 4.6. Contexto completo de BD (ciclo, keywords, backlinks, competidores, AI search, insights). JSON estructurado (oportunidades + riesgos + recomendaciones). Sesión 24. |
| Módulo SEO Opportunities | ✅ Activo | `/clientes/[id]/oportunidades`. Análisis algorítmico GSC 28d. 5 tipos: quick wins (pos 4-10), CTR bajo query, sin cobertura, posición pobre, CTR bajo página. Sin APIs externas — usa solo datos GSC. Sesión 25. |
| Módulo Reporte Mensual | ✅ Activo | `/clientes/[id]/reporte`. Agrega datos del período (rankings, backlinks, AI search, ciclo) y genera reporte ejecutivo con Claude Sonnet 4.6. Selector de mes, historial de reportes, secciones: logros, desafíos, métricas, oportunidades, plan. Sesión 26. |
| Sidebar navegación | ✅ Completo | Íconos Lucide reales en todos los nav items. Settings solo visible para ADMIN. Sesión 33b (commit `69d9482`). |
| Módulo Plan de Contenido | ✅ Activo | `/clientes/[id]/contenido`. Plan de contenido on-demand con Claude Sonnet 4.6. 4 tipos (blog/landing/pilar/soporte), 3 prioridades, historial de planes. ADMIN-only. Migración `add_content_plan`. Sesión 34 commit `c82b0d6`. |
| Módulo AEO Research | ✅ Activo | `/clientes/[id]/aeo-research`. Recopila preguntas de búsqueda (DataForSEO Labs + SERP PAA), clasifica con Claude Sonnet 4.6 en clusters AEO (featured snippets) y GEO (citación por LLMs). KPI strip, cluster cards expandibles, historial. ADMIN-only. Migración `20260614120000_add_aeo_research`. Sesión 36 commit `1294d7b`. |

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
| 2026-05-21 | **`NODE_OPTIONS=--max-old-space-size=2048` (inicial).** Build de Next.js requiere heap extra — el default Node (~1.5GB) agota el heap. Se eligió 2048 porque el VPS tenía 3.8GB RAM sin swap. Superado en Sesión 34b — ver decisión 2026-06-14. |
| 2026-05-24 | **4GB de swap configurados en VPS (`/swapfile`). Persistente en `/etc/fstab`.** Resuelve definitivamente los OOM kills de builds y prepara terreno para el crawler de site audit (Sesión 18). Con swap disponible, `--max-old-space-size=4096` es viable — actualizado en Sesión 34b tras 3er OOM. |
| 2026-06-14 | **Heap de build subido a 4096 + `cpus:1` en next.config.mjs.** El OOM del Sesión 34 (SIGABRT, heap 2046/2048MB) fue causado por el crecimiento acumulado de la app (~30 rutas dinámicas) combinado con el swap/RAM del servidor. `cpus:1` evita que Next.js lance varios workers de compilación en paralelo (cada uno con su propio heap) → reduce el pico de memoria total. El heap de 4096 da margen usando el swap de 4GB. Build confirmado: 308s, `✓ Compiled successfully`, `/clientes/[id]/contenido` en artefacto. |
| 2026-05-15 | **REDIS_URL en producción usa hostname interno `apps_cerebro-seo-redis`** — Easypanel genera hostnames con formato `<proyecto>_<servicio>`: underscore separa proyecto de servicio, guiones se preservan dentro del nombre del servicio. El error original era un hostname incompleto (sin prefijo `apps_`), no los guiones en sí. |
| 2026-05-15 | **Credenciales rotadas tras exposición accidental**: Anthropic API key, Notion Integration Token, Google OAuth Secret, DataForSEO API key. Pendiente rotar: Meta Access Token (si aplica), NEXTAUTH_SECRET, Postgres password, Redis password, SEO_INTERNAL_SECRET. |
| 2026-05-16 | **NextAuth usa `session.strategy: "jwt"` en producción.** Database strategy es incompatible con `next-auth/middleware` en App Router: el middleware llama `getToken()` que solo decodifica JWTs, con database strategy recibe un UUID opaco y falla silenciosamente. PrismaAdapter sigue activo para persistir User y Account. |
| 2026-05-16 | **`NEXTAUTH_URL_INTERNAL` debe ser el dominio público en producción**, no `http://localhost:3000`. Next.js usa esta variable para llamadas internas del middleware — si apunta a localhost, el middleware falla en el contenedor. |
| 2026-05-16 | **ADMIN ve todos los clientes activos; EDITOR solo los asignados vía `ClientUser` por email.** La tabla `ClientUser` está actualmente vacía — EDITORs sin asignaciones ven lista vacía. Requiere estrategia de roles resuelta antes de dar acceso al equipo. |
| 2026-05-16 | **El schema tiene `role UserRole @default(EDITOR)`**: todo login nuevo queda como EDITOR. Jorge promovido a ADMIN vía `UPDATE "User" SET role='ADMIN'` directamente en BD de producción (2026-05-17). No es escalable sin mecanismo automático. |
| 2026-05-16 | **Cerebro SEO maneja 42 clientes activos**. Vista default filtra a los 12 con servicio `seo`. Toggle "Todos los activos" muestra los 42. Costo variable (DataForSEO/Claude) solo para clientes con `services.includes("seo")`. |
| 2026-05-16 | **`REDIS_URL` en producción**: `redis://default:[password]@apps_cerebro-seo-redis:6379`. Hostname Easypanel: `apps_cerebro-seo-redis` (underscore proyecto-servicio, guiones en nombre servicio). Password embebido en la URL. Dos clientes en el código: `redis` (cache, fail-fast) y `redisBullMQ` (BullMQ, `maxRetriesPerRequest: null`). |
| 2026-05-16 | **Providers (GSC, GA4, DataForSEO) tienen `try/catch` en operaciones Redis.** Si Redis está caído, los providers van directo a la API externa (sin caché, pero con datos). Redis caído no bloquea el render de páginas. |
| 2026-05-19 | **GA4 validado en producción: el provider filtra a tráfico orgánico (`sessionDefaultChannelGrouping = "Organic Search"`)**, no tráfico total. Al validar los números del panel contra GA4 directo, ir a **Reports → Traffic Acquisition → Organic Search**, NO al Home/Overview de GA4 (que suma todos los canales). Comparar contra el total es falso negativo. |
| 2026-05-19 | **GSC y GA4 con datos reales validados en producción. Fase 1 COMPLETA.** |
| 2026-05-19 | **Estrategia de roles: `ADMIN_EMAILS` env var.** Lista de emails separados por coma en Easypanel → jwt callback promueve a ADMIN en cada login sin tocar la BD. Retrocompatible: si la var no está definida, el rol viene de la BD. `@default(EDITOR)` en schema sigue activo — todo login nuevo que no esté en ADMIN_EMAILS entra como EDITOR. |
| 2026-05-19 | **ClientUser granular dormido.** Todos los usuarios autenticados (ADMIN y EDITOR) ven todos los clientes activos. ClientUser se activará en Fase 2+ si se necesita restricción por cuenta. EDITOR no ve costos de API (no hay UI de costos expuesta). |
| 2026-05-20 | **Estrategia de roles C+A desplegada**: (C) EDITOR ve todos los clientes activos igual que ADMIN — `ClientUser` ya no filtra en `/clientes` ni en `[id]`. (A) Rol asignado por `ADMIN_EMAILS` en callback `jwt` de NextAuth, normalizado lowercase+trim, idempotente en cada refresh. `ClientUser` permanece en schema dormido. Jorge y Félix configurados en `ADMIN_EMAILS`. |
| 2026-05-20 | **`ADMIN_EMAILS` es la autoridad sobre roles en producción.** Sobreescribe `User.role` de BD en cada login. El `UPDATE` manual del 2026-05-17 queda obsoleto — la fuente única de verdad para promoción de ADMIN es la env var de Easypanel. |
| 2026-05-20 | **Postgres `cerebro-db` es compartido con Cerebro web.** Rotación de password requiere coordinar actualización de `DATABASE_URL` en ambos servicios simultáneamente. NO rotar en sesiones solo-Cerebro-SEO. |
| 2026-05-20 | **Credenciales rotadas (sesión 12)**: `NEXTAUTH_SECRET`, `SEO_INTERNAL_SECRET`, Redis password. Postgres password aplazado (compartido con cerebro-web). Meta Access Token N/A en Cerebro SEO. |
| 2026-05-21 | **SSO entre Cerebro y Cerebro SEO: Opción B — Login separado con mismas credenciales Google OAuth.** Cookie compartida en dominio padre descartada. Cero acoplamiento entre apps prevalece sobre fricción de 1 click para equipo de 3 personas. Reconsiderar si escala el equipo o se comercializa (Auth0, Clerk). |
| 2026-05-21 | **Bridge Cerebro: workers construidos pero NO schedulados.** Bloqueador: 3 endpoints en Cerebro web no existen aún (`/api/internal/seo/clients`, `…/tasks/active`, `…/strategy/current`). Activar descomentando TODO en `src/server/jobs/schedulers.ts` cuando Cerebro web los exponga. | ~~SUPERADA — ver decisión 2026-05-21 abajo~~ |
| 2026-05-21 | **Bridge Cerebro 100% operativo.** Workers `sync:cerebro` (cada 6h) y `sync:cerebro-tasks` (cada 15min × cliente SEO) schedulados y activos en producción desde Sesión 16. `schedulers.ts` restaurado — ya no hay bloque TODO comentado. `CEREBRO_BASE_URL` es **variable de entorno requerida en producción** (Easypanel → env vars del servicio `cerebro-seo`). Sin ella los workers arrancan pero todos los requests al bridge fallan silenciosamente con `console.warn`. |
| 2026-05-21 | **`ClientStatus.PAUSED`** = cliente que ya no aparece en Cerebro (eliminado/desactivado). `ClientStatus.INACTIVE` no existe en el schema — usar `PAUSED`. |
| 2026-05-31 | **Soft delete en `Keyword` y `Competitor`**: `deletedAt DateTime?` — no borrar filas de BD, solo setear timestamp. Toda query activa filtra `deletedAt: null`. Migración `add_keyword_softdelete_competitor_timestamps`. `rank-tracking-processor` actualizado con `deletedAt: null`. |
| 2026-05-31 | **Configuración del cliente en página dedicada `/configuracion`**: las keywords y competidores se gestionan ahí, no en el wizard de alta (que solo hace alta inicial). El wizard mantiene su lógica actual — no se modifica. |
| 2026-05-31 | **`Array.from(new Set(...))` en vez de `[...new Set(...)]`** en server actions TypeScript. El spread de iterables requiere `downlevelIteration` o target ES2015+ — `Array.from()` es seguro con cualquier target. |
| 2026-06-05 | **Sidebar: Settings solo visible para ADMIN.** El nav item de `/settings` se oculta para EDITORs en `Sidebar.tsx` usando la sesión del servidor. Íconos Lucide reales en todos los items (reemplaza placeholders). Commit `69d9482`. |
| 2026-06-10 | **Plan de Contenido on-demand.** Módulo `/contenido/` genera planes de contenido SEO con Claude Sonnet 4.6. Cruza keywords, gaps de competidores, oportunidades GSC y ciclo activo. Modelo `ContentPlan` en BD (tabla separada, historial por cliente por mes). Costo estimado $0.01–0.03/plan — no se encola en BullMQ (on-demand, igual que Análisis Claude). |
| 2026-06-14 | **AEO Research (Capa A pilar AEO/GEO).** Módulo `/aeo-research/` recopila preguntas via DataForSEO Labs `keyword_suggestions` (filtrado a palabras-pregunta, cache 7d) + SERP PAA extraction (cache 7d, $0.002/req × seed). Las preguntas se clasifican con Claude Sonnet 4.6 en clusters temáticos AEO (featured snippets/PAA/voz) y GEO (citación por ChatGPT/Gemini/Perplexity/Claude). Modelo `AeoResearch` en BD (clusters Json = `AeoResearchResult` completo). ADMIN-only, seeds automáticas desde keywords `isPriority`. Costo estimado $0.01–0.05/análisis (labs + PAA + Claude). Capa B (escalar a Perplexity/SearchGPT APIs reales) queda como próximo push. |
| 2026-06-14 | **Sección global `/research` (Sesión 37).** Research ephemero sin cliente: modo keywords (ideas + preguntas + clusters AEO/GEO con Claude) y modo dominio (rank overview). Resultados solo en memoria React — sin modelo Prisma nuevo. `classifyAeoResearchEphemeral` en `aeo-classify.ts` clasifica sin guardar a BD. `ApiUsage` se loggea con `clientId: null` (campo ya nullable). Sidebar: ítem "Research" (FlaskConical, visible ADMIN + EDITOR). Útil para preventa, análisis de campañas y research ad-hoc sin cliente asignado. |
| 2026-06-14 | **Portapapeles de estrategia por cliente (Sesión 38).** EN MEMORIA — no persiste en BD, localStorage ni sessionStorage. React Context (`ClipboardContext`) montado en `clientes/[id]/layout.tsx` keyed por clientId: persiste al navegar entre módulos del mismo cliente, se resetea al cambiar de cliente. Items: keyword/aeo_cluster/content_idea con payload markdown. Botones Plus/Check en keyword-ideas (columna nueva "Copiar"), AeoResearchPanel (ClusterCard header), ContentPlanPanel (IdeaCard header). Página `/portapapeles`: items agrupados por tipo, "Copiar todo" (navigator.clipboard), "Vaciar", warning temporal, empty state. Guard 4a (beforeunload) implementado. Guard 4b (navegación interna Next.js App Router): NO implementado — router.events no existe en App Router; se documenta como limitación menor. |

---

## 3. Decisiones pendientes

1. **SSO entre Cerebro y Cerebro SEO para el equipo**: ¿cookie en dominio padre `clicksociety.mx` o login separado con mismas credenciales? *Resolver antes de que Fase 2 esté en producción.*
2. **AI Search Visibility provider**: DataForSEO LLM APIs vs Profound vs stack propio. *Resolver en Fase 4.*
3. ~~**Profundidad de SERP en tracking producción**~~ ✅ RESUELTO 2026-05-27: depth:30 Standard Queue (~$0.00195/req). Todos los clientes SEO directos (12).

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

**Completado (Sesión 12 — 2026-05-20):**
- [x] Estrategia de roles C+A implementada y desplegada en producción
- [x] NEXTAUTH_SECRET rotado y validado
- [x] SEO_INTERNAL_SECRET rotado
- [x] Redis password rotado y validado con app + GSC/GA4

**Pendiente (Sesión 13):**
- [ ] **Validar acceso de Félix**: login en ventana incógnito fresca para confirmar rol ADMIN y visibilidad de clientes
- [ ] **Rotar Postgres password**: coordinar con sesión que también actualice `cerebro-web` (compartido)
- [ ] **Migrar wizard /api/clientes → tRPC**: Fase 2, requiere `@trpc/client` + `@trpc/react-query`

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
- [x] GSC + GA4 en portada con datos reales ✅ Sesión 11
- [x] Módulo Términos de búsqueda (GSC) ✅ Sesión 13
- [x] Módulo Tráfico de páginas (GA4 + GSC) ✅ Sesión 14
- [x] Bridge Cerebro web (`cerebro-bridge.ts` + workers sync) ✅ Sesiones 15–16 — **100% operativo**
- [x] Primer site audit técnico (crawler + PageSpeed Insights) ✅ Sesión 18
- [x] Configuración editable del cliente (keywords + competidores + GSC/GA4) ✅ Sesión 20
- [x] Trigger manual de rank tracking (ADMIN) en módulo Keywords ✅ Sesión 20
- [x] Sync con Notion: clientes, tareas, estrategia (focus/goals) vía bridge ✅ Sesión 16 — workers `sync:cerebro` (6h) + `sync:cerebro-tasks` (15min) operativos
- [ ] Sync de bitácora vía bridge — DEUDA: Cerebro web no expone el endpoint todavía. No prioritario salvo que el equipo lo pida.
- [x] InsightsAgent activo para los 12 clientes SEO ✅ (`INSIGHTS_PILOT_CLIENT_IDS` no definido en Easypanel → todos activos)
- [ ] tRPC routers: `clientesRouter`, `ciclosRouter`, `insightsRouter`

### Fase 3 — Módulos SEO + Análisis
- [x] RankTrackingAgent ✅ Sesión 19
- [x] Módulo Backlinks (BacklinksAgent + vista + insights) ✅ Sesión 21
- [x] Módulo Competencia (CompetitorAgent + vista + SoV + gaps) ✅ Sesión 22
- [x] Módulo AI Search Visibility (worker Haiku + vista + chart semanal) ✅ Sesión 23
- [x] Módulo Análisis Claude on-demand (Sonnet 4.6 + contexto completo + JSON estructurado) ✅ Sesión 24
- [x] Módulo SEO Opportunities (algorítmico, 5 tipos, sin APIs externas) ✅ Sesión 25
- [x] Módulo Reporte Mensual (agregación BD + Claude Sonnet + render ejecutivo) ✅ Sesión 26
- [ ] Refactorizar `POST /api/clientes` → tRPC

### Fase 4 — IA y reportes
- [x] Módulo Keyword Ideas (DataForSEO Labs + AddKeywordButton) ✅ Sesión 27
- [x] Módulo Eventos/Timeline (7 fuentes, agrupado por mes, EventCard) ✅ Sesión 28
- [x] CycleCloseAgent (cierre atómico de ciclo + validación de hipótesis) ✅ Sesión 29
- [x] Reporte PDF exportable (@react-pdf/renderer, A4, diseño limpio) ✅ Sesión 30
- [x] Sparkline de tendencia en tabla de keywords (SVG inline, 30 días, color por trend) ✅ Sesión 31
- [x] Export CSV de keywords con filtros aplicados ✅ Sesión 31
- [x] Mejoras módulo Insights: sort severidad, Dark UI detalle, página historial /insights (tabs activos/resueltos/ignorados) ✅ Sesión 31
- [x] Historial de audits: selector de audits pasados, gráfica evolución de scores (Recharts), Dark UI completo ✅ Sesión 31
- [x] Fix Félix: `session` callback evalúa ADMIN_EMAILS en cada request — sin necesidad de re-login ✅ Sesión 31
- [x] Búsqueda de clientes en tiempo real + sort inteligente (alertas → tareas → nombre) ✅ Sesión 31
- [x] Dashboard global `/dashboard` con KPIs, alertas críticas, actividad 7d, estado de ciclos ✅ Sesión 31
- [x] Página `/settings` — estado sistema (DB/Redis), colas BullMQ, workers últimas ejecuciones, costos del mes, admins ✅ Sesión 32
- [x] Dark UI sweep completo — KeywordsTable, GscQueriesTable, PagesTrafficTable ✅ Sesión 33
- [x] Sidebar: íconos Lucide reales en todos los nav items + Settings solo visible para ADMIN ✅ Sesión 33b
- [x] Módulo Plan de Contenido (`/contenido/`) — `claude-content-plan.ts`, modelo `ContentPlan`, ADMIN-only, historial ✅ Sesión 34 commit `c82b0d6`
- [x] Módulo AEO Research (`/aeo-research/`) — `classifyAeoResearchForClient`, modelo `AeoResearch`, ADMIN-only, seeds de priority keywords, historial, clusters AEO/GEO ✅ Sesión 36 commit `1294d7b`
- [x] Sección global `/research` — research efímero sin cliente (keywords + dominio + AEO/GEO), sidebar FlaskConical, `classifyAeoResearchEphemeral`, `ApiUsage` con clientId null ✅ Sesión 37 commit `acec61e`
- [x] Portapapeles de estrategia por cliente — en memoria, por cliente, NO persistente; layout.tsx keyed; botones en keyword-ideas/aeo-research/contenido; página /portapapeles con copy markdown ✅ Sesión 38 commit `6ef3d69`

---

## 6. Bloqueadores actuales

| Bloqueador | Dueño | Acción requerida |
|---|---|---|
| ~~Validación acceso Félix~~ | ~~Resuelto~~ | **RESUELTO (Sesión 31).** Fix en `session` callback de `auth.ts` — ADMIN_EMAILS re-evaluado en cada request. No requiere re-login. |
| ~~Workers de sync Cerebro~~ | ~~Automático~~ | **RESUELTO (Sesión 16).** Workers `sync:cerebro` (6h) y `sync:cerebro-tasks` (15min) activos en producción. Verificar `JobLog` en Sesión 17. |
| Postgres password pendiente | Sesión coordinada | Compartido con cerebro-web — no rotar solo en Cerebro SEO. |
| Validar calidad de insights (**en curso**) | Félix (1-2 semanas) | Insights reales generados y verificados visualmente en producción (Sesión 17). Félix debe revisar si son accionables. Si sí → expandir a 12 SEO (borrar `INSIGHTS_PILOT_CLIENT_IDS` de Easypanel). |

---

## 7. Riesgos vivos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Calidad datos DataForSEO insuficiente | Baja | Alto | Validación vs GSC pendiente (Molino Azteca parece correcto; RFN y Quicsa no rankean — validar en GSC) |
| Costos DataForSEO más altos de lo estimado | Media | Medio | Costo real depth:100 = $0.0155/query; para producción usar Standard Queue + depth menor |
| Sync con Cerebro más complejo de lo previsto | Media | Medio | REST simple ya decidido; `cerebro-bridge.ts` pendiente |
| Sitios bloquean al crawler | Media | Bajo | User agent custom, respeto robots.txt, fallback Playwright |
| Bug de autorización entre clientes | Baja | Crítico | Toda query Prisma filtra por `clientId` de sesión |
| Félix no puede entrar como ADMIN | Media | Medio | JWT firmado con secret viejo o cache. Probar incógnito. Si persiste: revisar ADMIN_EMAILS en Easypanel. |
| Postgres password sin rotar | Baja | Medio | Compartido con cerebro-web; aplazado para sesión coordinada. No es urgente (no expuesto externamente). |

---

## 8. Bitácora de sesiones

### Sesión 40 — 2026-06-15 ✅ COMPLETA (Fix DATABASE_URL → BD real con 42 clientes)
**Participantes:** Jorge + Claude Code
**Resultado:** ✅ App en producción con los 42 clientes reales. Jorge y Felix con acceso verificado.

**Trabajo realizado:**

1. **Diagnóstico:** Jorge reportó que no veía clientes al entrar. Las tablas `Client` y `User` de `cerebro-seo-db` (la BD nueva de Sesión 39) estaban vacías.

2. **Root cause identificado:** El postgres `cerebro-db` tenía una database `cerebro_seo` con 42 clientes y 2 usuarios (Jorge ADMIN, Felix EDITOR) — era la BD real que la app usó antes. En Sesión 39 se apuntó erróneamente a un postgres nuevo vacío.

3. **Fix aplicado:** `DATABASE_URL` corregido de `apps_cerebro-seo-db:5432` → `apps_cerebro-db:5432/cerebro_seo`. Guardado y redeploy en Easypanel.

4. **Limpieza:** Servicio `cerebro-seo-db` (postgres vacío) eliminado de Easypanel. Documentación corregida.

5. **Verificado:** Jorge entra con Google OAuth y ve todos sus clientes con métricas.

**Arquitectura correcta de producción:**
- Postgres: servicio `cerebro-db` → database `cerebro_seo` (Cerebro SEO) + `cerebro_db` (Cerebro web)
- Redis: servicio `cerebro-seo-redis` (exclusivo Cerebro SEO)
- Host interno DB: `apps_cerebro-db:5432`

---

### Sesión 39 — 2026-06-15 ✅ COMPLETA (Primer deploy completo de producción)
**Participantes:** Jorge + Claude Code
**Resultado:** ✅ App en producción. Login page visible en `https://apps-cerebro-seo.6lk5jx.easypanel.host/`.

**Trabajo realizado:**

1. **Root cause del 502:** Variables de entorno vacías en Easypanel — el servicio `cerebro-seo` nunca tuvo env vars configuradas. `startup.mjs` lanzaba `Error: DATABASE_URL no definido` en un crash loop.

2. **Postgres elegido (error corregido en Sesión 40):** Se creó erróneamente un nuevo `cerebro-seo-db`, cuando la BD real siempre estuvo en `cerebro-db` (database `cerebro_seo`). Error corregido en Sesión 40.

3. **13 env vars configuradas en Easypanel** (panel Environment de `cerebro-seo`): DATABASE_URL (inicialmente mal apuntada a cerebro-seo-db), REDIS_URL, NEXTAUTH_URL (`https://seo.clicksociety.com.mx`), NEXTAUTH_SECRET, GOOGLE_CLIENT_ID/SECRET, DATAFORSEO_LOGIN/PASSWORD, ANTHROPIC_API_KEY, NOTION_API_KEY, CEREBRO_API_URL, SEO_INTERNAL_SECRET, GOOGLE_PAGESPEED_API_KEY.

4. **Deploy disparado:** Build exitoso del commit `6ef3d69` (portapapeles). `startup.mjs` corre `prisma migrate deploy` al arrancar.

5. **App respondiendo:** Login page de Cerebro SEO visible. Google OAuth visible. `NEXTAUTH_URL` corregido a `seo.clicksociety.com.mx`.

---

### Sesión 38 — 2026-06-14 ✅ COMPLETA (Portapapeles de estrategia por cliente)
**Participantes:** Jorge + Claude Code
**Commit:** `6ef3d69` — `feat: portapapeles de estrategia por cliente (selección de outputs para copiar a Cerebro)`
**Resultado:** ✅ Lint limpio. Build exitoso (319s). `/clientes/[id]/portapapeles` en artefacto. Push. Deploy en curso.

**Trabajo realizado:**

1. **`ClipboardContext.tsx`** (nuevo): React context `ClipboardProvider` / `useClipboard`. Estado: `ClipboardItem[]` con campos `id`, `type`, `label`, `payload`. Métodos: `toggleItem`, `removeItem`, `clear`, `hasItem`, `count`. `useEffect` para `beforeunload` cuando `items.length > 0`. Reset de items cuando cambia `clientId`.

2. **`clientes/[id]/layout.tsx`** (nuevo, server component): Monta `<ClipboardProvider key={params.id} clientId={params.id}>`. El `key` fuerza remount al cambiar de cliente → items se resetean. Persiste al navegar entre módulos del mismo cliente.

3. **`keyword-ideas/KeywordClipboardButton.tsx`** (nuevo, client component): Botón Plus/Check que llama `toggleItem` con payload `- {keyword} (vol: {vol}/mes, KD: {kd}, intención: {intent})`.

4. **`keyword-ideas/page.tsx`**: Nueva columna "Copiar" con `KeywordClipboardButton` en cada fila (visible para todos, no solo ADMIN).

5. **`aeo-research/AeoResearchPanel.tsx`**: Botón Plus/Check en header de `ClusterCard`. `stopPropagation` para no interferir con el toggle del acordeón. Payload: markdown con tema, preguntas y recomendación.

6. **`contenido/ContentPlanPanel.tsx`**: Botón Plus/Check en header de `IdeaCard`. Payload: título [tipo] — Prioridad + keywords + ángulo + razón.

7. **`portapapeles/page.tsx`** + **`PortapapelesPanel.tsx`**: Server page (prisma client name) + client panel. Items agrupados por tipo (Keywords/Temas AEO/Ideas de contenido). "Copiar todo a portapapeles" → `navigator.clipboard.writeText` con markdown agrupado. Feedback visual "Copiado" 2.5s. "Vaciar". Warning card estilo DS (border-left amarillo). Empty state con links a módulos. Vista previa del markdown.

8. **`clientes/[id]/page.tsx`**: Módulo "Portapapeles" en MODULES grid (ícono `ClipboardList`, color `text-ds-orange`, `requiresSeo: false`).

**Limitación documentada — Guard 4b (navegación interna):**
Next.js 14 App Router no expone `router.events` (existía en Pages Router). No hay forma nativa de interceptar navegación interna sin soluciones frágiles. Mitigación implementada: warning visible en página de portapapeles + beforeunload (4a). El usuario ve el conteo en el MODULES grid al estar en portada; el warning en la página recuerda el riesgo de pérdida.

**Costo de APIs:** $0.

---

### Sesión 37 — 2026-06-14 ✅ COMPLETA (Sección global /research — Análisis sin cliente)
**Participantes:** Jorge + Claude Code
**Commit:** `acec61e` — `feat: sección global /research — análisis de keywords y dominio sin cliente`
**Resultado:** ✅ Lint limpio (solo warning preexistente en ServiceToggle). Push. Deploy en curso.

**Trabajo realizado:**

1. **`src/lib/aeo-classify.ts`**: Agregada función `classifyAeoResearchEphemeral(questions, clientInfo, seeds)`. Misma llamada Claude Sonnet 4.6 que `classifyAeoResearchForClient` pero SIN `prisma.aeoResearch.create`. Loggea a `ApiUsage` con `clientId: undefined` (se persiste como null). Retorna `{ result: AeoResearchResult, cost: number }`.

2. **`src/app/(admin)/research/actions.ts`**:
   - `actionResearchKeywords({ seeds, country, language })`: ADMIN-only. `getKeywordIdeas` (100 ideas) + `getQuestionKeywords` (80) + `getSerpQuestions` por seed en paralelo. Dedup questions. `classifyAeoResearchEphemeral`. Retorna `KeywordResearchResult` (efímero).
   - `actionResearchDomain({ domain })`: ADMIN-only. `getDomainRankOverview`. Retorna `DomainResearchResult`.

3. **`src/app/(admin)/research/ResearchPanel.tsx`**: Client component completo:
   - Tabs "Por keyword" / "Por dominio" (border-b-2 border-primary para activo)
   - Helpers inline: `kdBadge`, `intentBadge`, `fmtVol`, `fmtCpc`
   - `KeywordTable`: tabla de ideas con vol/KD/CPC/intent (sin columna "Agregar")
   - `ClusterCard`: expand/collapse, badges AEO (azul/Mic) y GEO (amarillo/Cpu)
   - `KeywordResults`: KPI bar + resumen + clusters + tabla
   - `DomainResults`: 3 KPI cards (Domain Rank, Keywords orgánicas, Tráfico estimado)
   - `ResearchPanel`: form con `useTransition`, selectors país/idioma, seed input multi

4. **`src/app/(admin)/research/page.tsx`**: Server component (sin force-dynamic — no hay queries Prisma). Renderiza `ResearchPanel`.

5. **`src/components/layout/Sidebar.tsx`**: Import `FlaskConical`. Item "Research" (`href: "/research"`, `adminOnly: false`) entre Dashboard y Configuración.

**Decisión arquitectónica clave:** Sección global vs "cliente sentinel". Se eligió sección propia `/research` para evitar contaminar dashboard, BullMQ workers y sync flows que iteran por clientes.

**Costo de APIs:** $0 (sin llamadas a DataForSEO ni Claude en esta sesión).

**Próximos pasos sugeridos:**
- Capa B AEO/GEO: integrar Perplexity API para validar qué preguntas ya están respondidas por LLMs.
- Export de resultados de `/research` a PDF o CSV.
- Guardar research en "historial de research" (modelo `GlobalResearch` — decision pendiente si se necesita).

---

### Sesión 36 — 2026-06-14 ✅ COMPLETA (Módulo AEO Research — Capa A pilar AEO/GEO)
**Participantes:** Jorge + Claude Code
**Commit:** `1294d7b` — `feat: módulo AEO Research (capa A pilar AEO/GEO) — Answer the Public + clasificación AEO/GEO con Claude`
**Resultado:** ✅ Lint limpio. Push. Deploy en curso. Migración `add_aeo_research` se aplica en startup.

**Trabajo realizado:**

1. **`prisma/schema.prisma`**: Modelo `AeoResearch` (seeds[], clusters Json, questionCount, cost Decimal, inputTokens, outputTokens, triggeredBy). Relación `aeoResearches AeoResearch[]` en `Client`.

2. **Migración `20260614120000_add_aeo_research/migration.sql`**: `CREATE TABLE "AeoResearch"` con PK, FK a Client, índice `clientId + createdAt`. Se aplica vía `prisma migrate deploy` en `startup.mjs`.

3. **`src/server/providers/dataforseo.ts`**:
   - Tipo `QuestionKeyword` (keyword, volume, kd, cpc, intent, source: 'labs'|'serp_paa').
   - `title?: string` en `DfsSerpItem` para PAA items.
   - `getQuestionKeywords(seeds, options?, clientId?)`: llama `getKeywordIdeas` con límite ×3 y filtra con regex de palabras-pregunta en español. Cache dedicado `aeo:questions:{seeds-hash}` 7d.
   - `getSerpQuestions(keyword, country, language, clientId?)`: SERP live regular, extrae items con `type === "people_also_ask"`. Cache `aeo:paa:{keyword}:{country}` 7d.

4. **`src/lib/aeo-classify.ts`**: `classifyAeoResearchForClient(clientId, questions, seeds, triggeredBy?)`. Prompt que clasifica clusters como AEO (featured snippets/PAA/voz) o GEO (ChatGPT/Gemini/Perplexity). Guarda en `prisma.aeoResearch`. Logs a `ApiUsage`. Costo estimado $0.01–0.04.

5. **`src/app/(admin)/clientes/[id]/aeo-research/actions.ts`**: `actionGenerateAeoResearch` (ADMIN-only): obtiene priority keywords como seeds → `getQuestionKeywords` + `getSerpQuestions` en paralelo → dedup → `classifyAeoResearchForClient`. `getAeoResearchHistory` para historial.

6. **`src/app/(admin)/clientes/[id]/aeo-research/AeoResearchPanel.tsx`**: KPI bar (preguntas, clusters, AEO, GEO, AEO+GEO), cluster cards con expansión, badges AEO/GEO, generación via useTransition, historial, empty state.

7. **`src/app/(admin)/clientes/[id]/aeo-research/page.tsx`**: server, force-dynamic. Seeds desde priority keywords. Empty state si no hay seeds (link a `/keywords`).

8. **`src/app/(admin)/clientes/[id]/page.tsx`**: Módulo `AEO Research` en grid (ícono `Brain`, color `text-ds-yellow`, href `aeo-research`, requiresSeo true).

**Fix durante desarrollo:** Los métodos `getQuestionKeywords` y `getSerpQuestions` quedaron fuera del body de la clase `DataForSeoProvider` (el `}` de cierre estaba antes de los métodos). Detectado y corregido por `npm run lint` antes del commit.

**Costo de APIs:** $0 (lint + deploy — sin llamadas a DataForSEO ni Claude).

**Próximo push sugerido (Capa B):**
- Integrar Perplexity API para validar qué preguntas ya responde en respuestas generativas.
- o SearchGPT / Bing API para PAA real en tiempo real.
- Por ahora, AEO Research ya es funcional con datos de Google.

---

### Sesión 35 — 2026-06-14 ✅ COMPLETA (Headers Dark UI — Términos de búsqueda y Tráfico de páginas)
**Participantes:** Jorge + Claude Code
**Commit:** `f94bb80` — `fix: migrar headers de queries y traffic al design system Dark UI`
**Resultado:** ✅ Build limpio. Push. Deploy en curso.

**Trabajo realizado:**

1. **`terminos-busqueda/page.tsx`**:
   - Header viejo: `bg-white border-b border-gray-100 px-8 py-5`, título `text-gray-900`, breadcrumb `text-gray-400` con `ChevronLeft`.
   - Header nuevo: `p-8 space-y-8`, título `font-display font-extrabold`, ícono `Search` (`text-ds-blue`), breadcrumb `buttonVariants outline-mono + ArrowLeft`, subtítulo `font-mono text-muted-foreground`.
   - Empty state: `bg-white border-gray-100 shadow-sm` → `bg-card border-border`.

2. **`trafico-paginas/page.tsx`**:
   - Mismo patrón. Ícono `BarChart2` (`text-ds-green`).
   - Aplicado en **dos retornos**: early return (sin GSC/GA4) y main return.
   - Estado vacío con Google Analytics: `text-gray-300/500/400` → `text-muted-foreground/30` y `text-muted-foreground`.

**Deuda visual resuelta:** Headers blancos en módulos de Fase 2 eran los últimos remanentes del estilo pre-Dark UI.

**Costo de APIs:** $0.

---

### Sesión 34b — 2026-06-14 ✅ COMPLETA (Fix OOM build producción)
**Participantes:** Jorge + Claude Code
**Commits:** `4899278` (cpus:1 + heap 1800), `ff736e4` (heap → 4096)
**Resultado:** ✅ Build exitoso en producción. `✓ Compiled successfully`. Ruta `/clientes/[id]/contenido` confirmada en artefacto `.next`. Deploy completo: 308s sin SIGABRT.

**Diagnóstico:**
- El build de Sesión 34 (commit `c82b0d6`) falló con `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory` → SIGABRT (heap 2046/2048MB).
- Root cause: la app creció a ~30 rutas dinámicas. Next.js lanza múltiples workers de compilación en paralelo, cada uno con su propio heap. Con `--max-old-space-size=2048` y 2GB ya usados por otros contenedores, el total supera los 3.8GB de RAM del servidor.
- El VPS tiene 4GB de swap en `/swapfile` (configurado Sesión 18) — disponible pero no explotado con el límite de 2048.

**Fixes aplicados:**
1. `next.config.mjs`: `experimental.cpus: 1` → un solo worker de compilación en vez de N paralelos.
2. `Dockerfile`: `--max-old-space-size=2048` → `4096` → con cpus:1 y swap disponible, el build completa sin OOM.

**Verificación:**
- Build local: `✓ Compiled successfully`, `/clientes/[id]/contenido 4.64 kB 114 kB`.
- Deploy Easypanel `ff736e4`: duración 8 min (histórico), `### Success ###`, ruta en artefacto confirmada.
- Migración `add_content_plan` aplicada vía `startup.mjs` → tabla `ContentPlan` disponible.

**Lección (3ª ocurrencia de OOM en build):**
- 1ª vez: Sesión 12 — swap no existía, heap 4096 OOMeaba. Fix: bajar a 2048.
- 2ª vez (silenciosa): errores TypeScript en `settings/page.tsx` causaban build fallido antes del OOM. Fix: TypeScript corregido.
- 3ª vez: Sesión 34b — la app creció suficiente para que 2048 ya no alcance incluso con cpus:1 sin swap. Fix: subir a 4096 + swap. **Regla**: si el build vuelve a OOMear con la app creciendo, primero verificar swap en VPS, luego considerar aumentar instancia.

**Costo de APIs:** $0.

---

### Sesión 34 — 2026-06-13 ✅ COMPLETA (Módulo Plan de Contenido)
**Participantes:** Jorge + Claude Code
**Commit:** `c82b0d6` — `feat: módulo plan de contenido on-demand con Claude Sonnet 4.6`
**Resultado:** ✅ Build limpio. Push a main. Deploy en Easypanel vía auto-deploy. Migración `add_content_plan` lista para aplicarse en producción vía `startup.mjs`.

**Trabajo realizado:**

1. **`src/lib/claude-content-plan.ts`** (nuevo):
   - Función `generateContentPlan(clientId)` — Claude Sonnet 4.6 con prompt caching.
   - Recopila contexto: keywords actuales (rankings + gaps), oportunidades GSC 28d, competidores, ciclo activo (foco + objetivos).
   - System prompt: estratega de contenido SEO senior de Click Society. Retorna JSON estructurado validado con Zod.
   - `ContentPlanResult`: `resumen` (string), `ideas[]` (5–10, tipo ContentIdea), `notaEstrategica`.
   - `ContentIdea`: `titulo`, `tipo` (blog/landing/pilar/soporte), `keywords[]`, `angulo`, `prioridad` (alta/media/baja), `razon`, `urlSugerida?`.
   - Costo estimado: ~$0.01–0.03 USD por plan. Loguea en `ApiUsage`.

2. **`prisma/migrations/20260606060849_add_content_plan/migration.sql`** (nueva):
   - Tabla `ContentPlan`: `id`, `clientId` (FK → Client), `month` (YYYY-MM), `ideas` (JSONB), `model`, `inputTokens`, `outputTokens`, `cost`, `triggeredBy`, `createdAt`.
   - Índice en `(clientId, createdAt)`.

3. **`src/app/(admin)/clientes/[id]/contenido/`** (nueva carpeta):
   - `page.tsx`: server, `force-dynamic`. Fetch del cliente + historial de planes. Muestra `ContentPlanPanel`.
   - `actions.ts`: `actionGenerateContentPlan(clientId)` — server action ADMIN only, llama `generateContentPlan()`, guarda en BD. `getContentPlanHistory(clientId)` — fetcha últimos 10 planes.
   - `ContentPlanPanel.tsx`: client component. Botón "Generar plan" con `useTransition`. Vista expandible por idea (acordeón). Badges de tipo y prioridad con DS tokens. Historial de planes pasados seleccionable.

4. **`src/app/(admin)/clientes/[id]/page.tsx`** modificado:
   - Módulo "Plan de Contenido" activado en el grid de módulos. Ícono `Lightbulb`, href `contenido`, color `text-ds-orange`. Reemplaza placeholder anterior.

**Fixes de build detectados y corregidos (no regresiones — bugs latentes en archivos pre-existentes):**
- `settings/page.tsx`: `as unknown as QueueCounts` (TypeScript strict), `createdAt` → `date` en `ApiUsage.groupBy` (campo real es `date`), `Number(Decimal)` en suma de costos.
- `claude-content-plan.ts`: campo `clientPosition` inexistente en `CompetitorKeywordGap` schema → eliminado. Nullables en `impressions` y `ctr` de `PageMetric` → guards `?? 0`. Cast `Prisma.InputJsonValue` para campo `ideas Json`.
- `actions.ts`: protección elevada de auth-only → ADMIN-only (`session.user.role !== "ADMIN"`), igual que `reporte/actions.ts`.

**Costo de APIs:** ~$0.01–0.03 por ejecución de plan (Claude Sonnet 4.6). Sin costo en esta sesión hasta que se use en producción.

---

### Sesión 33 — 2026-06-05 ✅ Dark UI sweep completo
**Participantes:** Jorge + Claude Code
**Commit:** `82dbf48`
**Resultado:** ✅ Dark UI sweep de los 3 componentes client-side de tabla que faltaban. Build limpio. Push.

**Trabajo realizado:**

1. **`KeywordsTable.tsx`** (reescrito en Sesión 33 previa a compactación):
   - `PositionBadge`: top3=`bg-primary/10 text-ds-green border-ds-gd`, top10=`bg-ds-blue/10 text-ds-blue`, top30=`bg-primary/10 text-primary`, out=`bg-muted text-muted-foreground`
   - `DeltaBadge`: positivo=`text-ds-green`, negativo=`text-destructive`, cero=`text-muted-foreground/50`
   - Filtros: `bg-primary/15 text-primary` (activo) vs `bg-muted text-muted-foreground` (inactivo)
   - Tabla: `bg-card border-border`, filas `hover:bg-muted/30`
   - Sort icons: `text-primary` / `text-muted-foreground/30`

2. **`GscQueriesTable.tsx`** (reescrito):
   - Toggle rango: `bg-muted` → `bg-card text-foreground` (activo) vs `text-muted-foreground` (inactivo)
   - Selects: `border-border bg-card text-foreground focus:ring-primary`
   - Tabla: `bg-card border-border`, skeleton `bg-muted`, filas `hover:bg-muted/30`
   - Sort icons: `text-primary` / `text-muted-foreground/30`, contador `font-mono`

3. **`PagesTrafficTable.tsx`** (reescrito):
   - Mismo patrón que GscQueriesTable
   - Badge GA4: `bg-primary/10 text-primary border-primary/30`
   - Badge GSC: `bg-ds-blue/10 text-ds-blue border-ds-blue/40`
   - Valores null: `text-muted-foreground/30`

**Estado del Dark UI sweep:** COMPLETO. Todos los módulos usan tokens del design system.

**Costo de APIs:** $0.

---

### Sesión 32 — 2026-06-04 ✅ COMPLETA (Página /settings)
**Participantes:** Jorge + Claude Code
**Commit:** `983a15b`
**Resultado:** ✅ Página `/settings` operativa. Solo ADMIN (404 para EDITORs). Push + deploy.

**Trabajo realizado:**

`src/app/(admin)/settings/page.tsx` (nuevo) — servidor, `force-dynamic`, ADMIN-only:

1. **Estado del sistema** — ping a PostgreSQL (`prisma.$queryRaw\`SELECT 1\``) y Redis (`redis.ping()`). Contadores: total clientes activos + clientes con SEO.

2. **Colas BullMQ** — `getJobCounts()` en las 3 colas (dataCollectionQueue, aiAnalysisQueue, syncQueue). Muestra: en cola (waiting+delayed), activos, fallidos, completados. Resaltado rojo si hay fallidos. Todo en try/catch — si BullMQ no responde, las tarjetas muestran "Sin datos" sin romper el render.

3. **Workers — últimas ejecuciones** — Consulta los últimos 300 JobLog, agrupa client-side por `jobName` (primer resultado = más reciente). Tabla con los 12 tipos de worker: label legible, schedule, estado (OK/Error/Sin datos), tiempo relativo del último run, error truncado si falló, número de intentos.

4. **Costos del mes** — `prisma.apiUsage.groupBy` por provider desde el 1ro del mes actual. Tabla con proveedor, requests, costo USD. Barra de proporción visual. Total al header de sección.

5. **Acceso ADMIN** — muestra los emails en `ADMIN_EMAILS` como badges. Nota de dónde configurarlo en Easypanel.

**Deuda identificada:** `/settings` está en el sidebar pero el sidebar no tiene link activo hacia ella (solo muestra el ícono). Funciona al navegar directamente. No se corrigió en esta sesión.

**Costo de APIs:** $0.

---

### Sesión 31 — 2026-06-03 ✅ COMPLETA (Mejoras UX transversales)
**Participantes:** Jorge + Claude Code
**Commits:** `84598f9`, `e661330`, `4158d60`, `5fac3d1`
**Resultado:** ✅ 4 módulos mejorados. Build limpio. Push + deploy en todos los commits.

**Trabajo realizado:**

1. **Sparkline de tendencia en keywords** (`KeywordsTable.tsx`):
   - Componente `MiniSparkline` — SVG inline 60×24px, sin Recharts (demasiado pesado para celda de tabla).
   - Y-axis invertido: posición 1 = arriba, posición 100 = abajo.
   - Color dinámico: verde si mejoró, rojo si empeoró, gris si sin cambio.
   - Columna "Tendencia" entre Posición y 7d en la tabla. No afecta sort ni filtros.

2. **Export CSV de keywords** (`KeywordsTable.tsx`):
   - Botón "CSV" en toolbar, junto al contador.
   - Exporta los datos ya filtrados y ordenados (respeta el estado actual de filtros).
   - Columnas: Keyword, Tipo, País, Posición, 7d, 30d, URL rankeando, Actualizado.
   - BOM UTF-8 para Excel en español. Nombre: `keywords-YYYY-MM-DD.csv`.

3. **Mejoras módulo Insights**:
   - `InsightCards.tsx`: sort por severidad (critical > high > medium > low) antes de renderizar. Link "Ver historial completo" al pie.
   - `insights/[insightId]/page.tsx`: Dark UI completo — `bg-card`, `border-border`, DS tokens de color. Breadcrumb con link al listado. URLs afectadas como links externos. Botones con `buttonVariants`.
   - `insights/page.tsx` (nuevo): página de historial con 3 tabs — Activos / Resueltos / Ignorados. Contadores por tab. Lista densa con ícono por tipo, badge de severidad, descripción truncada, acción sugerida, fecha.

4. **Historial de audits** (`audit/page.tsx`, `audit/AuditScoreChart.tsx`):
   - Fetcha los últimos 24 audits (no solo el más reciente).
   - `AuditScoreChart.tsx` (nuevo): Recharts LineChart con Overall, Técnico, Performance, Contenido. Aparece cuando hay 2+ audits completados.
   - Selector de audits: fila de botones con fecha, tipo, score overall. Navegación via `?auditId=xxx`.
   - Issues se cargan solo para el audit seleccionado (query separada — no penaliza historial grande).
   - Dark UI completo: `bg-card`, `border-border`, severity usa `text-destructive/text-ds-orange/text-ds-yellow/text-ds-blue`.

**Fixes previos (también esta sesión, sesiones previas resumidas):**
- Fix Félix: `session` callback en `auth.ts` re-evalúa `ADMIN_EMAILS` en cada `getServerSession()` — sin requerir re-login. Root cause: `jwt` callback solo corre en sign-in/refresh.
- Búsqueda de clientes: `ClientGrid.tsx` con input en tiempo real, sort inteligente, zero state.
- Dashboard global `/dashboard`: 9 queries paralelas, KPIs, alertas críticas agrupadas por cliente, actividad 7d, estado de ciclos.

**Costo de APIs:** $0 (todo client-side o BD local, sin llamadas a DataForSEO/Claude/GSC).

---

### Sesión 30 — 2026-06-02 ✅ COMPLETA (Reporte PDF exportable)
**Participantes:** Jorge + Claude Code
**Commit:** `3106e9e` — `feat: Reporte PDF exportable — @react-pdf/renderer, ruta /reporte/pdf, botón descarga (Sesión 30)`
**Resultado:** ✅ PDF generado server-side. Botón "PDF" en ReportPanel. Build limpio. Push + deploy.

**Trabajo realizado:**
- `npm install @react-pdf/renderer` (v4.5.1) — librería de PDF puro en JS, sin Puppeteer/Chrome.
- `reporte/ReportPdf.tsx` (nuevo): documento PDF con react-pdf primitives (Document, Page, Text, View, StyleSheet). Layout A4 con:
  - Header: nombre cliente, dominio, período en box gris.
  - Sección "Rankings": KPI cards (total, mejoraron [verde], cayeron [rojo], sin cambio) + tablas top mejoras/caídas en 2 columnas.
  - Sección "Otras métricas": backlinks totales/dominios, mención Claude, tareas completadas (condicionales).
  - Sección "Balance del mes": 2 columnas (Logros verde / Desafíos amarillo) con bullets.
  - Sección "Oportunidades": cards con badge de impacto coloreado.
  - Sección "Plan del próximo mes": lista numerada con badges azules.
  - Sección "Conclusión estratégica".
  - Footer fijo con "Click Society · Cerebro SEO · fecha" + numeración de páginas.
- `reporte/pdf/route.ts` (nuevo): `GET /clientes/[id]/reporte/pdf?mes=YYYY-MM`. Auth check. Fetch del MonthlyReport de BD. `renderToBuffer(element as ReactElement<DocumentProps>)`. Convierte `Buffer → Uint8Array`. Response con headers `application/pdf` + `Content-Disposition: attachment`.
- `ReportPanel.tsx`: importado `Download` de lucide-react. `pdfUrl` calculado en el componente. Botón `<a href={pdfUrl} download>` visible cuando hay `record`, junto al botón de generar.

**Fixes de build:**
- `Font` importado sin usar → removido de imports.
- `renderToBuffer` requiere `ReactElement<DocumentProps>` → cast explícito.
- `Buffer` no asignable a `BodyInit` de `NextResponse` → convertido a `new Uint8Array(buffer)`.

**Decisiones técnicas:**
- `@react-pdf/renderer` sobre Puppeteer: sin dependencias pesadas, sin Chrome, funciona en Vercel/Easypanel sin config extra.
- PDF se genera on-demand (cada click en "PDF") — no se almacena en disco. Si el reporte es pesado en el futuro, considerar caché con `reportPdfUrl` en BD.
- La ruta es pública para cualquier usuario autenticado (ADMIN y EDITOR) — PDFs no contienen información que no puedan ver en la UI.

**Costo de APIs:** $0.

---

### Sesión 29 — 2026-06-02 ✅ COMPLETA (CycleCloseAgent)
**Participantes:** Jorge + Claude Code
**Commit:** `9c559b4` — `feat: CycleCloseAgent — cierre de ciclo con validación de hipótesis (Sesión 29)`
**Resultado:** ✅ Cierre de ciclo operativo. Botón ADMIN en portada. Build limpio. Push + deploy.

**Trabajo realizado:**
- `src/lib/cycle-close.ts` (nuevo): función `closeCycle(clientId)`. Transacción atómica Prisma:
  1. Busca ciclo más reciente en estado ACTIVE o CLOSING.
  2. Tareas PENDING/IN_PROGRESS → BLOCKED.
  3. Hipótesis PENDING: si su tarea asociada quedó DONE → VALIDATED (con nota automática). Si no → PARTIAL (requiere revisión manual).
  4. Ciclo → CLOSED + closedAt = now.
  - Retorna: `CycleCloseResult` (cycleId, yearMonth, tasksBlocked, hypothesesValidated, hypothesesPartial, closedAt).
- `src/app/(admin)/clientes/[id]/cycle-close-actions.ts` (nuevo): `actionCloseCycle(clientId)` — server action ADMIN only. Devuelve `{ ok: true, result }` o `{ ok: false, error }`. `revalidatePath` al terminar.
- `src/app/(admin)/clientes/[id]/CycleCloseButton.tsx` (nuevo): client component con 3 estados:
  1. Botón "Cerrar ciclo" (outline-mono discreto).
  2. Confirm inline: "¿Cerrar ciclo YYYY-MM? No se puede deshacer." + botones Confirmar/Cancelar.
  3. Toast resultado (verde ✓ con stats / rojo × con error). `useTransition` + `router.refresh()`.
- `clientes/[id]/page.tsx`: `CycleCloseButton` importado. Inline header de la sección Operativa (reemplaza `<SectionHeader>` por `<div>` equivalente para alojar el botón a la derecha). Visible solo para ADMIN cuando cycle.status = ACTIVE o CLOSING.

**Decisiones técnicas:**
- Validación de hipótesis algorítmica simple: tarea completada → VALIDATED, resto → PARTIAL. No requiere llamada a Claude ni a APIs externas.
- Sin nueva migración: todos los campos necesarios ya existían (Hypothesis.validation, validatedAt, validationNotes; MonthlyCycle.status, closedAt; Task.status).
- El botón es discreto (outline-mono, tamaño pequeño) — no interfiere visualmente con el header. Solo visible para ADMIN con ciclo activo → 0 surface área para usuarios EDITOR.

**Costo de APIs:** $0.

---

### Sesión 28 — 2026-06-02 ✅ COMPLETA (Módulo Eventos/Timeline)
**Participantes:** Jorge + Claude Code
**Commit:** `64389f5` — `feat: módulo Eventos/Timeline — timeline unificada 7 fuentes, agrupada por mes (Sesión 28)`
**Resultado:** ✅ Timeline operativa. 7 fuentes de datos en una vista cronológica. Build limpio. Push + deploy.

**Trabajo realizado:**
- `src/app/(admin)/clientes/[id]/timeline/page.tsx` (nuevo): server page `force-dynamic`. Fetch paralelo últimos 90 días de 7 fuentes: KeywordRanking (|delta|≥3), Task (status DONE + completedAt), Audit (date), BacklinkSnapshot (capturedAt), Insight (generatedAt), MonthlyReport (createdAt), ClientAnalysis (createdAt).
  - Tipos: `TimelineEvent` (id, kind, date, title, detail, badge?, badgeColor?).
  - `KIND_META`: mapea cada kind a icon + color + bg + border del DS.
  - `EventCard`: icono circular, línea vertical (oculta en último), fecha relativa + fecha absoluta, badge opcional.
  - `groupByMonth`: agrupa eventos en `Map<string, TimelineEvent[]>` por clave "mes año" en español.
  - Leyenda de tipos de evento. Zero state si 0 eventos en 90 días.
- `clientes/[id]/page.tsx`: módulo Eventos activado (`active: true`, href: `"timeline"`, icon `Clock`, color `text-ds-orange`). Reemplazó entrada anterior inactiva (href: `"eventos"`).

**Fixes de build:**
- `prisma.task` (no `prisma.monthlyCycleTask` — el modelo se llama `Task`).
- Campo `date` en Audit (no `createdAt`).
- Campos `scoreOverall` y `pagesCrawled` en Audit (no `score` e `issueCount`).
- `completedAt` en Task (no `updatedAt`), con guard `if (!t.completedAt) continue`.

**Decisiones técnicas:**
- Ventana de 90 días: cubre ciclo actual + parte del anterior. Configurable en futuro.
- Delta negativo en ranking = subió posiciones (pos 5 → pos 2 = delta -3 = mejora).
- No se requieren nuevas APIs ni modelos de BD — todo viene de tablas existentes.

**Costo de APIs:** $0.

---

### Sesión 27 — 2026-06-02 ✅ COMPLETA (Módulo Keyword Ideas)
**Participantes:** Jorge + Claude Code
**Commit:** (parte del mismo push post-sesión 26 con sesión 27+28)
**Resultado:** ✅ Módulo Keyword Ideas operativo. DataForSEO Labs + AddKeywordButton. Build limpio.

**Trabajo realizado:**
- `src/server/providers/dataforseo.ts`: interfaz `KeywordIdea` exportada + método `getKeywordIdeas(seeds, options?, clientId?)`. Endpoint `/dataforseo_labs/google/keyword_suggestions/live`. Hasta 5 seeds en tasks paralelas. Caché Redis 7 días. Deduplica por keyword, ordena por volumen desc.
- `src/app/(admin)/clientes/[id]/keyword-ideas/page.tsx` (nuevo): server page. Seeds = keywords prioritarias (máx 5). Empty state si no hay seeds. KPI cards (total, con volumen, KD≤30, alto volumen). Tabla: keyword, vol/mes, KD badge (verde/amarillo/rojo), CPC, intención, botón agregar. Marca "ya existe" (opacity-50) vs términos ya en BD. Máximo 200 resultados visibles.
- `src/app/(admin)/clientes/[id]/keyword-ideas/AddKeywordButton.tsx` (nuevo): client component. `useTransition` + estado `added`. Llama `actionCreateKeyword({clientId, term, isPriority: false, country: "MX", language: "es"})`. Estados: Plus → Loader2 (pending) → Check (added).
- `clientes/[id]/page.tsx`: módulo Keyword Ideas activado (`active: true`, icon `Lightbulb`, color `text-ds-yellow`).

**Fix:** `actionCreateKeyword` recibe objeto único, no argumentos separados — corregida la llamada en AddKeywordButton.

**Costo de APIs:** ~$0.025/req DataForSEO, cacheable 7 días → costo real ≈$0 en sesiones subsiguientes.

---

### Sesión 26 — 2026-06-02 ✅ COMPLETA (Módulo Reporte Mensual)
**Participantes:** Jorge + Claude Code
**Commit:** `275c8c8` — `feat: módulo Reporte Mensual — generación automática con Claude Sonnet 4.6 (Sesión 26)`
**Resultado:** ✅ Módulo Reporte Mensual operativo. Schema + migración. Librería de contexto + Claude. Vista completa. Build limpio. Push + deploy.

**Trabajo realizado:**
- `prisma/schema.prisma`: modelo `MonthlyReport` (id, clientId, yearMonth, content Text, model, tokens, cost, triggeredBy, createdAt). Índice `[clientId, yearMonth]`. Relación inversa `monthlyReports` en `Client`.
- `prisma/migrations/20260602120000_add_monthly_report/migration.sql`: migración manual creada y registrada con `prisma migrate resolve --applied`.
- `src/lib/monthly-report.ts` (nuevo):
  - `gatherReportContext(clientId, yearMonth)`: agrega datos del período desde BD — ciclo+tareas+hipótesis, keywords+rankings (mes actual vs anterior), backlinks snapshots (actual + anterior para comparar), AI search del mes, insights activos, rankings con mayor movimiento.
  - Calcula métricas de código: keywords que mejoraron/cayeron/sin cambio, top mejoras y caídas, delta backlinks vs mes anterior, tasa AI search.
  - `generateMonthlyReport(clientId, yearMonth, triggeredBy?)`: llama Claude Sonnet 4.6, max_tokens 2500. Persiste a `MonthlyReport`. Log a `ApiUsage`.
  - Tipos: `MonthlyReportResult` (periodo, resumenEjecutivo, logros[], desafios[], metricas, oportunidades[], planProximoMes[], conclusionEjecutiva), `ReportMetricas`.
- `reporte/actions.ts`: `actionGenerateMonthlyReport` (ADMIN only), `getReportHistory`, `getLatestReport`.
- `reporte/ReportPanel.tsx`: client component. Botón trigger + spinner. Loading skeleton. Secciones: resumen ejecutivo, logros/desafíos (grid 2col), métricas keywords (KPI + top mejoras/caídas), otras métricas (backlinks/AI search/ciclo), oportunidades, plan próximo mes, conclusión. Zero state. Historial de reportes.
- `reporte/page.tsx`: server page. Selector de mes por query param `?mes=YYYY-MM`. Default = mes actual. Pasa initialRecord hidratado al panel.
- `clientes/[id]/page.tsx`: módulo Reporte Mensual activado (`active: true`, icon `FileText`, color `text-ds-blue`).

**Fixes de build:**
- `"Generar reporte"` con comillas regulares dentro de JSX string → removidas las comillas (SWC las interpretaba como cierre del string).
- `"` en JSX text content (alrededor de `{m.term}`) → wrapped en template literal `{`"${m.term}"`}`.
- Import `Minus` no utilizado → removido.

**Decisiones técnicas:**
- El reporte agrega datos ya en BD — costo = solo Claude (~$0.02-0.04). Sin llamadas externas en tiempo de render.
- Un reporte por mes por cliente (se puede regenerar — no hay `@@unique`, solo `@@index`).
- El selector de mes usa URL searchParam → SSR correcto, no estado cliente.
- Diferencia clara con Análisis Claude: reporte cubre un período específico, tiene comparativas vs mes anterior, está orientado a compartir. Análisis Claude es snapshot del estado actual sin período fijo.

**Costo de APIs:** $0 en esta sesión. Primer reporte real al hacer click en Generar en producción (~$0.02-0.04 por ejecución).

---

### Sesión 25 — 2026-06-02 ✅ COMPLETA (Módulo SEO Opportunities)
**Participantes:** Jorge + Claude Code
**Commit:** `7bc4272` — `feat: módulo SEO Opportunities — detección algorítmica + 5 tipos de oportunidades (Sesión 25)`
**Resultado:** ✅ Módulo SEO Opportunities operativo. Sin nuevas APIs — usa solo datos GSC ya disponibles. Build limpio. Push + deploy.

**Trabajo realizado:**
- `src/lib/seo-opportunities.ts` (nuevo): librería de detección algorítmica. 5 funciones `detect*` + `buildOpportunitiesReport`. Tipos `SeoOpportunity`, `OpportunityType`, `OpportunityPriority`, `OpportunitiesReport`. Sin llamadas externas — procesa `GscQueryRow[]` y `GscPageRow[]`.
  - `detectQuickWins`: pos 4-10, ≥50 impresiones, score=(10-pos)*2+1)*impressions, top 15.
  - `detectLowCtrQueries`: pos ≤3, CTR < 60% benchmark (28.5%/15.7%/11.0%), top 10.
  - `detectNoCoverage`: keywords prioritarias sin presencia en GSC o pos>50, siempre prioridad "alta".
  - `detectPoorPosition`: pos ≥21, ≥200 impresiones, score=impressions/position, top 10.
  - `detectLowCtrPages`: ≥100 impresiones, CTR < 2%, score=impressions*(2-ctr), top 10.
- `src/app/(admin)/clientes/[id]/oportunidades/page.tsx` (nuevo): server page `force-dynamic`. Empty state si no hay GSC o OAuth. Fetch GSC queries (28d, 1000 rows) + pages (500 rows) + keywords prioritarias de BD. KPI cards (total, alta prioridad, quick wins, sin cobertura). 5 `OpportunitySection` (una por tipo). `OpportunityCard` con icono DS, badge de prioridad, métricas y acción concreta. Footer con rango fechas + count queries.
- `clientes/[id]/page.tsx`: módulo SEO Opportunities activado (`active: true`).

**Fix de build:** Ternarios de prioridad inferidos como `string` por TypeScript strict — añadido `as OpportunityPriority` en las 4 funciones `detect*` con prioridad variable.

**Decisiones técnicas:**
- Módulo 100% server-side — no requiere workers ni jobs. Datos GSC ya están en caché Redis 24h. Costo = $0.
- Detección algorítmica vs Claude: preferida para oportunidades estructuradas (deterministas, instantáneas). Claude Análisis es para insight ejecutivo narrativo.
- `priorityKeywords` viene de `isPriority: true` en la BD local, no de GSC.

**Costo de APIs:** $0.

---

### Sesión 22 — 2026-06-01 ✅ COMPLETA (Módulo Competencia)
**Participantes:** Jorge + Claude Code
**Commit:** `bfce7aa` — `feat: módulo Análisis de Competencia — CompetitorAgent + vista + SoV + keyword gaps (Sesión 22)`
**Resultado:** ✅ CompetitorAgent operativo. Vista `/clientes/[id]/competencia` completa. Build limpio. Push + deploy.

**Trabajo realizado:**
- `prisma/schema.prisma`: modelos `CompetitorSnapshot` y `CompetitorKeywordGap`. Relaciones inversas en `Client` y `Competitor`. Migración `add_competitor_analysis`.
- `dataforseo.ts`: nuevos métodos `getDomainRankOverview(domain, clientId?)` — labs domain_rank_overview, cache 7d. `getKeywordGaps(clientDomain, competitorDomain, options?, clientId?)` — labs domain_intersection, cache 7d. Tipos exportados `DomainRankOverview` y `KeywordGapResult`.
- `competitor-worker.ts` (nuevo): worker BullMQ `createWorker` pattern. Job `analysis:competitors`. Por cada competidor: domain rank overview + keyword gaps, persiste `CompetitorSnapshot` + reemplaza `CompetitorKeywordGap`, actualiza `competitor.lastAnalyzed`. Insights algorítmicos: brecha creciente, SoV del competidor cayendo, gaps de alto volumen (≥500 búsquedas). Concurrencia 1.
- `init.ts`: `await import("./workers/competitor-worker")` activado.
- `competencia/actions.ts` (nuevo): `actionTriggerCompetitorAnalysis` — solo ADMIN, encola job inmediato.
- `competencia/SovChart.tsx` (nuevo): Recharts BarChart horizontal. SoV % por competidor. Colores DS. Labels con %. Altura dinámica.
- `competencia/TriggerCompetitorButton.tsx` (nuevo): `useTransition` + spinner loading state.
- `competencia/page.tsx` (nuevo): server page `force-dynamic`. 3 empty states (sin competidores / con competidores sin datos / con datos). KPI cards (4), SoV chart, cards por competidor con métricas, tabla top 30 keyword gaps con KD badge + intent + posición.
- `clientes/[id]/page.tsx`: módulo Competencia activado (`active: true`).
- `scripts/trigger-competitor-analysis.ts` (nuevo): CLI con soporte `all` para todos los SEO activos.

**Decisiones técnicas:**
- Métodos nuevos fuera de la interfaz `SeoDataProvider` (no rompen stubs existentes en `getCompetitorOverview`).
- SoV = % del pool total (competitorOnly + both + clientOnly) donde rankea el competidor.
- `CompetitorKeywordGap` se elimina y recrea en cada run (no acumulativo — mantiene solo la foto más reciente).

**Costo de APIs:** $0 en esta sesión. Primer análisis real al hacer trigger manual o esperar al día 1/15.

---

### Sesión 21 — 2026-06-01 ✅ COMPLETA (Módulo Backlinks)
**Participantes:** Jorge + Claude Code
**Commit:** `feat: módulo Backlinks — BacklinksAgent + vista + insights semanales (Sesión 21)`
**Resultado:** ✅ BacklinksAgent operativo. Vista `/clientes/[id]/backlinks` con KPIs, gráfica, top 20, cambios. Build limpio. Push + deploy pendiente.

**Trabajo realizado:**
- `prisma/schema.prisma`: relaciones inversas `backlinks Backlink[]` y `backlinkSnapshots BacklinkSnapshot[]` agregadas a `Client`. Migración `add_backlinks_module`.
- `dataforseo.ts`: implementación real de `getBacklinks()` vía `/v3/backlinks/backlinks/live`. Cache Redis 24h. Log a `ApiUsage`. Tipos `DfsBacklinkItem`, `DfsBacklinksLiveResult`.
- `backlinks-worker.ts` (nuevo): worker BullMQ `createWorker` pattern. Job `analysis:backlinks`. Reconciliación upsert/LOST, BacklinkSnapshot semanal, insights algorítmicos (`WIN`/`WARNING`/`HIGH`/`MEDIUM`). Concurrencia 2.
- `init.ts`: `await import("./workers/backlinks-worker")` activado.
- `backlinks/actions.ts` (nuevo): `actionTriggerBacklinksCrawl` — solo ADMIN, encola job inmediato, `revalidatePath`.
- `backlinks/BacklinksEvolutionChart.tsx` (nuevo): client component Recharts AreaChart. Colores DS (verde #7fc15e, azul #5ea8e0). Fallback si < 2 snapshots.
- `backlinks/page.tsx` (nuevo): server page `force-dynamic`. KPI cards (4), gráfica evolución, tabla top 20 con DA badge, sección cambios semana (ganados/perdidos), empty state con trigger. Botón "Disparar crawl" solo ADMIN.
- `clientes/[id]/page.tsx`: módulo Backlinks activado (`active: true`, color `text-ds-blue`).
- `scripts/trigger-backlinks.ts` (nuevo): script CLI manual.

**Decisiones técnicas:**
- Adaptar al schema real (`domainAuthority`/`followType`/`firstSeen`/`lastSeen`) en vez de los nombres del prompt (que usaba `domainRank`/`isDofollow`). Los tipos ya existían en `seo-data.ts`.
- `InsightType.WIN` para backlinks ganados (no `SUCCESS` que no existe en el enum).
- `avgDomainRank` calculado del top 200 fetched (no el DA del sitio destino del summary).
- `uniqueDomains` ← `summary.referringDomains` al crear el snapshot.

**Costo de APIs:** $0 (sin DataForSEO en esta sesión — primer crawl real al hacer trigger manual en producción).

---

### Sesión 20 — 2026-05-31 ✅ COMPLETA (Configuración editable del cliente)
**Participantes:** Jorge + Claude Code
**Commit:** `525e3d1`
**Resultado:** ✅ Página `/configuracion` operativa. CRUD keywords + competidores + GSC/GA4. Trigger manual de tracking para ADMIN. Build limpio. Push + deploy.

**Trabajo realizado:**
- `prisma/schema.prisma`: `Keyword.deletedAt DateTime?`, `Keyword.createdAt DateTime @default(now())`, 2 indexes `[clientId, isPriority]` y `[clientId, deletedAt]`. `Competitor.deletedAt DateTime?`, `Competitor.createdAt DateTime @default(now())`. Migración `add_keyword_softdelete_competitor_timestamps`.
- `configuracion/actions.ts` (nuevo): 8 server actions — `actionCreateKeyword`, `actionToggleKeywordPriority`, `actionDeleteKeyword`, `actionBulkCreateKeywords` (hasta 100, dedupe, cap priority), `actionAddCompetitor` (strip http/www/paths, cap 5), `actionDeleteCompetitor`, `actionUpdateGscProperty` (validación formato), `actionUpdateGa4Property` (validación formato).
- `configuracion/KeywordsManager.tsx` (nuevo): client component con estado local optimista. Star toggle priority (max 10, cursor-not-allowed si lleno). Soft delete con hover reveal. Formulario add individual (term/country/language/isPriority). Panel bulk paste colapsable (textarea, hasta 100, dedupe).
- `configuracion/CompetitorsManager.tsx` (nuevo): client component optimista. Add con auto-strip http/www. Delete hover reveal. Cap 5 con mensaje inline.
- `configuracion/page.tsx` (nuevo): server page `force-dynamic`. 4 secciones con `SectionHeader`: Datos generales (read-only grid), GSC/GA4 (forms con server actions void wrappers), Keywords (KeywordsManager), Competidores (CompetitorsManager). Link a Cerebro si `cerebroClientId` presente.
- `keywords/actions.ts` (nuevo): `actionTriggerRankTracking(clientId, mode)` — verifica ADMIN, encola job BullMQ `data-collection`.
- `keywords/TriggerTrackingButton.tsx` (nuevo): dos botones (priority/bulk) con feedback inline. Solo visible si `isAdmin`.
- `keywords/page.tsx`: migrado a Dark UI (DS tokens + SectionHeader × 3). Filtro `deletedAt: null` en query de keywords. Botón "Configurar keywords" → `/configuracion`. `TriggerTrackingButton` renderizado si `isAdmin`.
- `[id]/page.tsx`: botón "Configuración" en pills del header → `/configuracion`. Import `buttonVariants` + `Settings` icon.
- `rank-tracking-processor.ts`: filtro `deletedAt: null` agregado en query de keywords — bug fix crítico (keywords eliminadas ya no se trackean).

**Fix de build:** `[...new Set(...)]` → `Array.from(new Set(...))` en `actions.ts` (spread de iterables requiere target ES2015+). Form `action` en RSC debe retornar `void` — wrapped en funciones locales con `"use server"`.

**Decisiones técnicas:**
- Soft delete en vez de hard delete — preserva historial de rankings relacionados.
- Server actions para forms simples (GSC/GA4) — no necesitan estado cliente. CRUD interactivo usa server actions + `router.refresh()` para hidratación.
- Configuración separada del wizard — wizard solo maneja alta inicial, `/configuracion` es gestión continua.

**Costo de APIs:** $0 (sin DataForSEO ni Claude).

---

### Sesión 14 — 2026-05-29 ✅ COMPLETA (Design System parte 2 — UI completo)
**Participantes:** Jorge + Claude Code
**Resultado:** ✅ Click Society Dark UI 100% aplicado. Build limpio. 10 archivos + 4 nuevos.

**Trabajo realizado:**
- `src/components/ui-darkui/KpiCard.tsx`: componente DS para KPIs (label/value/delta/icon/variant).
- `src/components/ui-darkui/SectionHeader.tsx`: separador `// label ————` con línea extendida.
- `src/components/ui-darkui/ConclusionCard.tsx`: alert card con borde izquierdo de color (success/warning/error/info).
- `src/components/ui-darkui/index.ts`: barrel export.
- `src/components/layout/Sidebar.tsx`: dot nav (sin íconos), font-display brand, footer con usuario/rol + dropdown.
- `src/app/(admin)/clientes/ServiceToggle.tsx`: pill toggle oscuro (bg-card border-border rounded-full).
- `src/app/(admin)/clientes/page.tsx`: page header DS (font-display extrabold clamp), sin avatar de iniciales.
- `src/app/(admin)/clientes/[id]/page.tsx`: sin hero section, header inline con font-display + pills de estado, SectionHeader en todas las secciones.
- `src/app/(admin)/clientes/[id]/GscSnapshotCards.tsx`: usa KpiCard + DeltaBadge con DS tokens.
- `src/app/(admin)/clientes/[id]/Ga4SnapshotCards.tsx`: usa KpiCard + DeltaBadge con DS tokens.
- `src/app/(admin)/clientes/[id]/InsightCards.tsx`: usa ConclusionCard, preserva acciones resolve/ignore.
- `src/app/(admin)/clientes/[id]/ClientPortadaChart.tsx`: colores DS dark (indigo-400, blue-400, pink-400, emerald-400), grid/ticks con rgba, tooltip dark, tabs como pills DS.
- `src/app/(admin)/clientes/[id]/GscConnectSection.tsx`: sin indigo/gray/white, DS tokens (primary, border, muted-foreground, destructive).
- `src/app/(admin)/clientes/nuevo/page.tsx`: header font-display, stepper con dots DS, contenedor bg-card, hints font-mono.
- `src/app/(auth)/login/page.tsx`: font-display extrabold, rounded-lg (no rounded-2xl).

**Bug fix:** `SectionHeader.tsx`: `//` texto causaba `react/jsx-no-comment-textnodes` → envuelto en `{"//"}`.

**Decisiones técnicas:**
- `client.brandColor` ya no se renderiza en JSX (campo permanece en schema). Avatares eliminados.
- Recharts no acepta CSS vars en SVG fill → colores hex específicos (dark-friendly palette).
- `// label ————` patrón implementado como componente reutilizable, `//` escapado como JSX expression.

### Sesión 13 — 2026-05-27 ✅ COMPLETA (Design System parte 1)
**Participantes:** Jorge + Claude Code
**Resultado:** ✅ Click Society Dark UI aplicado en base. Build limpio. Push a main.

**Trabajo realizado:**
- `src/app/layout.tsx`: tres fuentes via next/font (Syne `--font-display`, Inter `--font-body`, JetBrains Mono `--font-mono`). Clase `dark` permanente en `<html>`.
- `tailwind.config.ts`: `darkMode: "class"`, fontFamily (display/heading/sans/mono), tokens `ds-*` crudos del DS, borderRadius con `--radius: 0.75rem`.
- `src/app/globals.css`: tokens dark en `:root` en formato oklch. Sin bloque `.dark` — la app es permanentemente dark. `--font-heading: var(--font-display)` para Syne en headings de cards.
- `button.tsx`: default=verde lima (`bg-primary`), secondary=cream→verde (`bg-ds-cream`), nueva variante `outline-mono` (borde verde translúcido).
- `badge.tsx`: default=pill verde tenue (`bg-primary/10 border-ds-gd text-ds-green font-mono uppercase`), variantes warning/info añadidas.
- `card.tsx`: `border-border` en vez de `ring-1 ring-foreground/10`, `rounded-lg` (0.75rem), CardTitle usa `font-heading` (Syne bold).
- `input.tsx`: `bg-secondary` (s3 oscuro), `font-mono`, sin overrides `dark:bg-input`.
- `label.tsx`: `font-mono uppercase tracking-wider text-muted-foreground`.
- `select.tsx`: SelectTrigger `bg-secondary` consistente con input.

**Decisiones técnicas:**
- Format oklch para CSS variables (consistente con shadcn base-nova preexistente).
- Tokens raw `--ds-*` en `:root` + en tailwind como `ds-*` para uso directo en componentes de Sesión 14.
- Sin bloque `.dark` en globals.css — valores dark en `:root`, clase `dark` en html activa variantes `dark:` de shadcn.
- Las páginas se verán parcialmente rotas (esperado) — Sesión 14 reimplementa Sidebar + páginas.

**Pendiente Sesión 14:** Sidebar, login, listado de clientes, wizard, vista detalle, KpiCard, SectionHeader, ConclusionCard.

### Sesión 19 — 2026-05-27 ✅ COMPLETA
**Participantes:** Jorge + Claude Code
**Resultado:** ✅ RankTrackingAgent activado. Módulo Keywords con tabla + gráfica. 59/59 tests. Build limpio. Push a main.

**Trabajo realizado:**
- `dataforseo.ts` + `seo-data.ts`: `bulkGetRankings` acepta `depth` configurable (default 30, Standard Queue ~$0.00195/query).
- `rank-tracking-processor.ts`: idempotencia diaria (saltar keywords ya trackeadas hoy), delta prev-curr (positivo = subió), insights algorítmicos (priority >5 posiciones, bulk >10). Caída masiva requiere mínimo 3 keywords (evita falsos positivos con clientes de 1 keyword).
- `rank-tracking-worker.ts`: concurrency 2, encolado en "data-collection". Routing por job.name (tracking:rankings-priority | tracking:rankings-bulk).
- `init.ts`: 3 workers nuevos registrados al startup (audit-quick, audit-complete, rank-tracking).
- `/clientes/[id]/keywords/page.tsx`: servidor dinámico. Calcula delta7d/delta30d/visibilityScore. Expone `KeywordRow` type.
- `KeywordsTable.tsx`: filtros (tipo all/priority/bulk + rango top3/10/30/fuera), columnas ordenables, badges de posición y delta, paginación >50 filas.
- `KeywordEvolutionChart.tsx`: multi-select hasta 5 keywords, Recharts LineChart con eje Y invertido [1,31], `connectNulls=false`, tooltip customizado.
- `/clientes/[id]/page.tsx`: módulo "Keywords objetivo" activado (active: true, icono TrendingUp).
- `scripts/trigger-rank-tracking.ts`: disparo manual con estimación de costo y tip SQL para ver resultados.
- Tests: dataforseo polling (4, con `vi.useFakeTimers` + `vi.runAllTimersAsync()`), rank-tracking-worker (5). Total sesión: 9 nuevos. Total proyecto: 59/59.

**Decisiones técnicas:**
- depth:30 Standard Queue — equilibrio costo/cobertura. $0.00195/query.
- 12 clientes SEO directos (sin piloto). Scheduler ya tenía los cron jobs en `schedulers.ts`.
- Insights algorítmicos (sin Claude). Umbral diferenciado: priority 5 pos, bulk 10 pos.
- Caída masiva: mínimo 3 keywords para activar (1 keyword nunca es "masiva").
- Tests de polling: `vi.useFakeTimers()` solo no basta — hay que arrancar la promise, luego `await vi.runAllTimersAsync()`, luego `await promise`.

**Costo de APIs:** Por sesión: $0 (tests solo, sin llamadas reales a DataForSEO). En producción: ~$0.00195/keyword/día (priority diario) + ~$0.00195/keyword/semana (bulk).
### Sesión 18 — 2026-05-24 ✅ COMPLETA
**Participantes:** Jorge + Claude Code
**Resultado:** ✅ Site Audit técnico implementado. 50/50 tests. Build limpio. Push a main.

**Trabajo realizado:**
- `prisma/schema.prisma`: extiende `Audit` (clientId, type, status, accessibilityScore, seoScore, pagesIndexable/brokenPages/redirectPages, completedAt, error) + nuevo `AuditIssue` (category, severity, type, title, description, affectedUrl, count, data). Migración `extend_audit_model`.
- `src/server/providers/pagespeed.ts`: PSI API v5 — scores 0-100 (performance/a11y/best-practices/seo), CWV (LCP/FCP/CLS/TBT/INP con field data > lighthouse), top-10 oportunidades.
- `src/server/crawler/site-crawler.ts`: Cheerio BFS 50 págs, respeta robots.txt. 12 tipos de issues: missing_title, missing_meta_description, missing_h1, multiple_h1, thin_content, noindex, missing_canonical, images_missing_alt, slow_ttfb, not_found, server_error, fetch_error.
- `src/server/jobs/processors/audit-processor.ts`: modo quick (PSI only, ~15s) + complete (crawl + PSI mobile+desktop). Score ponderado (technical 30% + performance 30% + content 20% + seo 10% + a11y 10%). Issues agrupados y deduplicados. Marca audit running → completed/failed.
- `audit-quick-worker.ts` + `audit-complete-worker.ts`: workers BullMQ, registrados en `init.ts`.
- Schedulers ya tenían `crawler:audit-quick` (miércoles 2AM) y `crawler:audit` (1ro mes 1AM).
- `src/app/(admin)/clientes/[id]/audit/page.tsx`: score cards, CWV con colores good/needs-improvement/poor, stats de crawl, issues por severidad.
- `src/app/(admin)/clientes/[id]/page.tsx`: módulo Site Audit activado (active: true).
- `scripts/trigger-audit.ts`: `tsx scripts/trigger-audit.ts <clientId> [quick|complete]`.
- Tests: pagespeed (7), site-crawler (6), audit-processor (5). Total: 50/50 verdes.

**Decisiones técnicas:**
- Sin Playwright (RAM insuficiente en VPS). Solo Cheerio. SPAs tendrán datos incompletos — aceptable v1.
- PSI falla → audit completa con scores 0, no falla el job. Crawler data sigue siendo útil.
- `Prisma.JsonNull` para `cwvData` nullable JSON (Prisma v5).

**Costo de APIs:** $0/audit. PageSpeed API gratuita (25k req/día). Sin DataForSEO.

**Commit:** `53c0268` (feat: site audit técnico — crawler + PageSpeed + UI)

---

### Sesión 17 — 2026-05-23 ✅ COMPLETA
**Participantes:** Jorge + Claude Code
**Resultado:** ✅ InsightsAgent activado en piloto. UI de insights operativa. 31/31 tests. Build limpio. Push a main.

**Trabajo realizado:**
- `src/env.ts`: `INSIGHTS_PILOT_CLIENT_IDS` opcional — lista de IDs para piloto.
- `.env.example`: documentación de la nueva variable.
- `schedulers.ts`: filtro piloto en `registerClientJobs` — si `INSIGHTS_PILOT_CLIENT_IDS` definido, solo registra insights job para esos clientes.
- `insights-processor.ts`: guard de datos vacíos — si 0 keywords Y sin audit, crea insight INFO `"Análisis disponible cuando el tracking esté activo"` sin llamar a Claude (costo $0). Evita gastar tokens cuando no hay datos de posicionamiento.
- `InsightCards.tsx`: reescrito — badges de severidad (CRITICAL/HIGH=rojo, MEDIUM=ámbar, LOW=azul), tipo (Alerta/Oportunidad/Logro/Info), timestamps relativos, botones "Resuelto" / "Ignorar" / "Ver detalle →".
- `[id]/page.tsx`: insights section siempre visible para clientes SEO (no condicional a `insights.length > 0`), query filtra `acknowledgedAt: null`, `isPilotClient` derivado de `INSIGHTS_PILOT_CLIENT_IDS`.
- `actions.ts`: `resolveInsight` (setea `acknowledgedAt`) e `ignoreInsight` (setea `dismissed: true`) con validación de sesión y `revalidatePath`.
- `insights/[insightId]/page.tsx`: página de detalle — título, análisis completo, acción sugerida, keywords/URLs afectadas, evidencia `dataPoints` en JSON, acciones con `<form>`.
- `scripts/trigger-insights.ts`: disparo manual de InsightsAgent vía BullMQ — para activar piloto sin esperar al cron de 6 AM.
- Tests: `insights-worker.test.ts` (3 casos: happy path, JSON inválido, sin datos), `schedulers.test.ts` (4 casos: piloto, todos, vacío, idempotencia). Total: 31/31 verdes.

**Decisiones técnicas:**
- Schema usa `acknowledgedAt` (resuelto) y `dismissed` (ignorado) — sin nueva migración.
- Costo piloto: ~$0.066/día (3 clientes × $0.022). Si no hay keywords/audit: $0 (guard activado).
- Criterio de expansión: Félix valida insights accionables → borrar `INSIGHTS_PILOT_CLIENT_IDS` de Easypanel.

**Costo de APIs:** ~$2/mes proyectado (3 clientes × $0.022/día × 30 días). Insights reales verificados visualmente en producción post-deploy.

**Commits:** `48f1049` (feat: InsightsAgent piloto + UI cards + detalle), `3ce92b4` (docs: bitácora sesión 17)

---

### Sesión 16 — 2026-05-21 ✅ COMPLETA
**Participantes:** Jorge + Claude Code
**Resultado:** ✅ Bridge completamente operativo. Workers BullMQ inicializados. Primer sync pendiente de primer ciclo (programado).

**Trabajo realizado:**
- `schedulers.ts`: `syncQueue` restaurado, `registerGlobalJobs(seoClients)` — `sync:cerebro` (cada 6h) y `sync:cerebro-tasks` (cada 15min × cliente SEO) activos.
- `page.tsx`: "(Sync pendiente)" → mensajes neutros.
- `middleware.ts`: excluir `/api/jobs` y `/api/internal` del NextAuth middleware.
- `src/instrumentation.ts`: Next.js instrumentation hook — llama `initJobs()` al startup del servidor.
- `next.config.mjs`: `experimental.instrumentationHook: true`.
- `Dockerfile`: `NODE_OPTIONS=--max-old-space-size=2048` (bajado de 4096 → VPS solo tiene 3.8GB RAM sin swap, 4GB causaba OOM Kill silencioso del proceso de build).

**Diagnóstico de OOM (causa raíz de builds fallidos):**
- VPS: 3.8GB RAM total, 0 swap. Con heap de 4GB, el OOM Killer del kernel mataba el build en ~4-8 min.
- Confirmado con `free -h` en el contenedor: `MemTotal: 4009208 kB`, `Swap: 0`.
- Fix: `NODE_OPTIONS=--max-old-space-size=2048` (2GB). Build exitoso en 7 min.
- Commits fallidos: `bf6e551` (docs), `73fdd91` (middleware fix) — todos eran OOM, no errores de código.

**Estado post-deploy (contenedor `eayhrpkwsqa8jb84co0c3dsmk`):**
- `GET /api/jobs/init` → **401** ✅ (ya no es 307 — middleware correcto)
- Workers BullMQ: múltiples `bull:data-collection:repeat:*`, `bull:ai-analysis:repeat:*`, `bull:sync:repeat:*` en Redis ✅
- `JobLog` en BD: 0 entradas (el servidor lleva ~20 min, primer ciclo de 15min aún pendiente)
- 5 clientes ACTIVE: Lavado Real, DPS Gestion Documental, HJ Exhibi Muebles, SSEPO, RML Diseño

**Commits:** `5f7cd35` (workers), `73fdd91` (middleware + instrumentation), `c2a5a18` (fix OOM heap 2GB)

**Costo de APIs:** $0 (REST interno gratuito).

---

### Sesión 15 — 2026-05-21 ✅ COMPLETA
**Participantes:** Claude Code (sesión autónoma con dirección de Jorge)
**Resultado:** ✅ Bridge Cerebro construido completo. 24/24 tests. Build limpio. Workers desactivados pendiente endpoints en Cerebro web.

**Trabajo realizado:**
- `cerebro-bridge.ts`: cliente HTTP tipado con timeout 10s, retry 1x en 5xx, graceful 404 (`console.warn` y array vacío — no crashea cuando los endpoints no existen aún).
- `cerebro-sync-worker.ts`: upsert clientes, guarda contra false negative (array vacío → no marcar nadie PAUSED), no sobrescribe `gscProperty`/`ga4Property`.
- `cerebro-tasks-sync-worker.ts`: upsert tareas + hipótesis, upsert `MonthlyCycle` con `focus`/`goals` (campos nuevos).
- `schedulers.ts`: bloque TODO comentado con instrucciones claras de activación.
- `init.ts`: workers importados y registrados (escuchan la queue pero no hay jobs activos).
- `monthly-summary/route.ts`: GET auth Bearer, hipótesis/tareas/insights del mes. Métricas de tráfico con placeholder "Disponible en Fase 3".
- Panel portada: sección "Operativa del mes" expandida con 3 bloques (Estrategia, Tareas, Hipótesis), estados vacíos limpios con "(Sync pendiente)".
- Migración `add_strategy_fields_to_monthly_cycle`: `focus String?` + `goals String[]` en `MonthlyCycle`.

**Decisiones técnicas:**
- `ClientStatus.PAUSED` como estado "ya no en Cerebro" (el enum no tiene `INACTIVE`)
- Métricas de tráfico GSC/GA4 en `monthly-summary` placeholder hasta Fase 3 (CycleCloseAgent)
- SSO descartado: login separado prevalece sobre 1-click de fricción para equipo de 3

**Commits:** `feat: bridge REST con Cerebro web…` (5711fbb)

**Costo de APIs:** $0 (REST interno gratuito, sin DataForSEO ni Claude).

**Bloqueador para activar workers:** Cerebro web debe implementar 3 endpoints. Cuando existan, descomentar bloque TODO en `schedulers.ts`.

---

### Sesión 14 — 2026-05-20
**Participantes:** Claude Code (sesión autónoma)
**Resultado:** ✅ Módulo Tráfico de páginas implementado. 12/12 tests. Build limpio. Push a main.

**Trabajo realizado:**
- `GoogleSearchConsoleProvider.getPages()`: `dimensions:["page"]`, cache Redis 24h.
- `GoogleAnalytics4Provider.getPagesMetrics()`: `pagePath` + sesiones/usuarios/conversiones/rebote/avgDuration, filtro Organic Search, cache Redis 4h.
- `getPagesTraffic()` server action: `Promise.all` para GSC y GA4 en paralelo, `normalizePagePath()` para convertir URL absoluta GSC → pagePath relativa GA4, outer join en Map, sort con nulls al final, top 200.
- `trafico-paginas/page.tsx`: SSR con datos default, header + breadcrumb, 3 estados (sin propiedades, solo GSC, solo GA4, ambas).
- `PagesTrafficTable.tsx`: columnas condicionales según `hasGsc`/`hasGa4`, toggle range, badges de fuentes, skeleton, null → "—" en gris, tooltip URL completa.
- Portada: "Tráfico de páginas" activado como Link real a `trafico-paginas`.
- 5 nuevos tests (2 GSC pages + 3 GA4 pages). Total: 12/12 verdes.

**Decisión técnica clave:** Normalización URL entre fuentes — GSC entrega URL absoluta (`https://dominio.com/ruta`), GA4 entrega `pagePath` relativa (`/ruta`). Función `normalizePagePath()` usa `new URL(url).pathname` para hacer el match del outer join. Sin esto, cada página aparecería duplicada.

**Commits:** `feat: módulo tráfico de páginas con fusión GA4+GSC por URL` (863867f)

**Costo de APIs:** $0 (GSC free tier, GA4 free tier, sin DataForSEO ni Claude).

---

### Sesión 13 — 2026-05-20
**Participantes:** Claude Code (sesión autónoma)
**Resultado:** ✅ Módulo Términos de búsqueda implementado. 7/7 tests. Build limpio. Push a main.

**Trabajo realizado:**
- `GoogleSearchConsoleProvider.getQueries()`: nuevo método con `dimensionFilterGroups` para filtros device/country, `rowLimit: 1000`, cache Redis 24h por combinación de filtros.
- `getGscQueries()` server action en `actions.ts`: verifica sesión/site/oauth, calcula fechas por range (28d/90d/12m), ordena en memoria, top 200, log ApiUsage.
- `src/app/(admin)/clientes/[id]/terminos-busqueda/page.tsx`: server component con SSR de datos default, breadcrumb, reusar `GscConnectSection`.
- `GscQueriesTable.tsx`: client component con toggle range, selects device/country, tabla shadcn ordenable (ChevronUp/Down por columna), skeleton loading, empty state.
- Portada: módulos ahora tienen `active: boolean`. "Términos de búsqueda" es `<Link>` real, resto sigue `<button disabled>`. href corregido a `terminos-busqueda`.
- shadcn `table` instalado.
- 3 nuevos tests: happy path, filtro device → dimensionFilterGroups, caché hit.

**Commits:** `feat: módulo términos de búsqueda con filtros device/country/range (GSC)` (c9de28b)

**Costo de APIs:** $0 (GSC free tier, sin llamadas DataForSEO ni Claude).

**Pendiente para Sesión 14:**
- Validar en producción con Molino Azteca (Jorge navega a `/clientes/[id]/terminos-busqueda`)
- Siguiente módulo Fase 2 (Tráfico de páginas o Términos de búsqueda mejorado con comparativa)

---

### Sesión 12 — 2026-05-20
**Participantes:** Jorge + Claude (Project, modo diseño y operación)
**Resultado:** ✅ Estrategia de roles C+A desplegada. 3 credenciales rotadas. Documentación corregida. Bloqueador Félix pendiente (incógnito).

**Trabajo realizado:**
- **Diseño de roles**: decidida estrategia C (EDITOR ve todos los clientes) + A (rol por `ADMIN_EMAILS` env var). Descartadas opción B (poblar `ClientUser` por seed) y D (UI de promoción) — sobre-ingeniería para equipo de 3 personas en herramienta interna.
- **Implementación**: callback `jwt` lee `ADMIN_EMAILS` normalizado (lowercase+trim), `clientes/page.tsx` y `[id]/page.tsx` eliminan filtro `ClientUser` para EDITOR, `ClientUser` dormido en schema.
- **Easypanel**: `ADMIN_EMAILS=jorge@clicksociety.com.mx,felix@clicksociety.com.mx` configurado vía API tRPC (`services.app.updateEnv`). Redeploy disparado.
- **Validación Jorge**: login fresco en incógnito → ADMIN → 42 clientes visibles → toggle SEO/Todos funciona.
- **Bloqueador Félix**: entra como EDITOR sin ver clientes. Pendiente prueba en incógnito (Félix no disponible al cierre).
- **Rotación de credenciales**:
  - ✅ `NEXTAUTH_SECRET`: `openssl rand -base64 32`, aplicado, validado (logout+login fresco invalidó sesión vieja)
  - ✅ `SEO_INTERNAL_SECRET`: generado y aplicado (preventivo para bridge Fase 2)
  - ✅ Redis password: `openssl rand -hex 32`, aplicado en `cerebro-seo-redis` Y en `REDIS_URL` de `cerebro-seo`, restart coordinado Redis→app, validado con GSC/GA4 cargando
  - ⏸ Postgres password: aplazado (`cerebro-db` compartido con `cerebro-web`)
  - N/A Meta Token: no existe en Cerebro SEO
- **Corrección documental**: hostname Redis real es `apps_cerebro-seo-redis` (verificado en UI Easypanel). Decisión 2026-05-15 tenía el hostname mal escrito.

**Costo de APIs:** $0 (solo configuración y rotación de secretos).

**Pendiente para Sesión 13:**
- Validación de Félix con incógnito (Jorge coordina).
- Arranque planificación Fase 2.

---

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
