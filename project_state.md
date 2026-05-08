# Cerebro SEO — Project State

> Documento vivo. Se actualiza al inicio y cierre de cada sesión de trabajo. Sirve como punto de continuidad entre sesiones de Claude Code y conversaciones con Cerebro.

**Última actualización:** 2026-05-07
**Fase actual:** Fase 1 — Foundation (en curso)
**Próximo hito:** Completar Fase 1 — setup git + Docker + provider layer DataForSEO + deploy inicial

---

## 1. Estado general

| Área | Estado | Notas |
|---|---|---|
| Concepto y visión | ✅ Completo | Flujo Cerebro↔Cerebro SEO definido |
| Spec de producto | ✅ v2 | Roadmap reordenado a 5 fases en sesión 2 |
| Arquitectura técnica | ✅ v2 | Actualizada con sistema de multiagentes y estructura real del código |
| Cuenta DataForSEO | ✅ Completo | Cuenta creada, $50 depositado, SERP test exitoso (07-may-2026) |
| Repo GitHub | ✅ Creado | `jorgeruiz/cerebro-seo` (privado). Falta: git init local + primer commit + push |
| Proyecto Easypanel | ❌ Pendiente | Después del deploy inicial |
| Subdominio `seo.clicksociety.mx` | ❌ Pendiente | DNS después de Easypanel |
| BD + Redis local (Docker) | ❌ Pendiente | docker-compose pendiente de documentar y levantar |
| Prisma migrations | ❌ Pendiente | Schema existe, falta correr `prisma migrate dev --name init` |
| `.env` local | ❌ Pendiente | Solo existe `.env.example` |
| Next.js + TypeScript inicializado | ✅ Completo | App Router, Tailwind, shadcn base-nova |
| Prisma schema completo | ✅ Completo | Todos los modelos + NextAuth + JobLog |
| Auth (NextAuth) | ✅ Completo | Google OAuth + Magic Link + roles inyectados en sesión |
| Layout + branding | ✅ Completo | Sidebar, gradiente Click Society |
| Sistema de multiagentes | ✅ Completo | Queues, base-worker, InsightsAgent con prompt caching de 3 bloques |
| Listado de clientes | ✅ Completo | Grid con alertas críticas, tareas pendientes, estado del ciclo |
| Wizard de alta de cliente | ✅ Completo | 3 pasos: datos básicos, propiedades GSC/GA4, keywords/competidores |
| Vista detalle del cliente | ✅ Completo | Portada con gráfica mock, InsightCards, operativa del mes, 9 módulos placeholder |
| Provider layer DataForSEO | ❌ Pendiente | Interface + DataForSeoProvider (Fase 1 restante) |
| Conexión GSC y GA4 | ❌ Pendiente | OAuth flows + lectura de datos reales |
| Deploy inicial | ❌ Pendiente | Easypanel + subdominio |

---

## 2. Decisiones tomadas (con fecha)

| Fecha | Decisión |
|---|---|
| 2026-05-07 | App separada de Cerebro (hermana, no hija). Repos, BD y deploy independientes. |
| 2026-05-07 | Stack: Next.js 14 + Prisma + PostgreSQL + NextAuth (mismo que Cerebro). |
| 2026-05-07 | Subdominio: `seo.clicksociety.mx`. |
| 2026-05-07 | Provider primario de datos SEO: DataForSEO (pay-per-use). |
| 2026-05-07 | Provider layer abstraído para permitir cambio futuro. |
| 2026-05-07 | Equipo con Google OAuth, clientes con magic link. Sin password para nadie. |
| 2026-05-07 | Ciclo mensual SEO como entidad de primera clase. |
| 2026-05-07 | Hipótesis verificables como diferenciador del producto. |
| 2026-05-07 | AI Search Visibility incluido en v1 como diferenciador comercial. |
| 2026-05-07 | Sync con Cerebro: REST interno con shared secret. Descartado Prisma multi-schema. |
| 2026-05-07 | **Prisma v5** (no v7): Prisma 7 tiene breaking changes incompatibles — datasource URL eliminada del schema, formato de enums roto. Se usa v5.22 como versión estable. |
| 2026-05-07 | **shadcn estilo `base-nova`**: usa `@base-ui/react` (no Radix UI). El patrón `asChild` no existe. Para botones-link, usar `buttonVariants({ variant })` directamente en `<Link>`. |
| 2026-05-07 | **tRPC para APIs internas** (confirmado). REST exclusivamente para: (a) webhooks de proveedores externos, (b) endpoints NextAuth, (c) bridge interno con Cerebro vía shared secret. El endpoint `/api/clientes` es temporal — migrar a `clientesRouter` tRPC en Fase 2. |
| 2026-05-07 | **Sistema de multiagentes como infraestructura transversal**, no como fase del roadmap. InsightsAgent construido; los demás agentes se activan conforme las fases proveen datos reales. |
| 2026-05-07 | **Fase 0 parcialmente completada fuera del flujo formal**: cuenta DataForSEO creada, $50 depositado, credenciales verificadas con llamada SERP de prueba exitosa. La validación de calidad de datos vs GSC (3 clientes × 5 keywords) se hará combinada con la implementación del `DataForSeoProvider` en la siguiente sesión, no como PoC aislado. |
| 2026-05-07 | **Docker para desarrollo local**: PostgreSQL 16 + Redis 7 via docker-compose. Easypanel solo para producción. |
| 2026-05-07 | **Roadmap reordenado a 5 fases** (ver sección 6). Sistema de multiagentes pasa a ser infraestructura. |
| 2026-05-07 | **Frecuencia de tracking**: diario para top 10 keywords (`isPriority: true`), semanal para el resto. |
| 2026-05-07 | **Vista cliente en Fase 5**: incluir en v1 pero como última fase del roadmap. |
| 2026-05-07 | **Multi-tenant**: solo Click Society en v1. Refactorizar si se comercializa. |
| 2026-05-07 | **Repo GitHub**: `jorgeruiz/cerebro-seo` (privado, bajo cuenta personal `jorgeruiz`). Click Society no usa GitHub Organizations por costo — todos los repos del agency van bajo `jorgeruiz`. |

---

## 3. Decisiones pendientes

1. **Single Sign-On real** entre Cerebro y Cerebro SEO: ¿cookie compartida en dominio padre `clicksociety.mx`, o login separado con mismas credenciales? *Resolver antes de Fase 5.*
2. **AI Search Visibility provider**: DataForSEO LLM APIs vs Profound vs stack propio. *Resolver en Fase 4.*

---

## 4. Backlog de Fase 1 (en curso)

**Completado:**
- [x] Proyecto Next.js 14 inicializado (App Router + TypeScript + Tailwind + shadcn base-nova)
- [x] Prisma schema completo: modelos de negocio + NextAuth (User, Account, Session, VerificationToken) + JobLog
- [x] `src/env.ts`: validación de ENV con Zod al startup — la app no arranca si falta variable requerida
- [x] `src/lib/redis.ts`, `src/lib/db.ts`: singletons de ioredis y Prisma con hot-reload seguro
- [x] NextAuth v4: Google OAuth + Magic Link + roles (ADMIN/EDITOR/CLIENT) inyectados en sesión
- [x] Middleware de protección de rutas
- [x] Sistema de multiagentes: `queues.ts` (3 queues BullMQ), `base-worker.ts` (factory), `insights-processor.ts` (InsightsAgent con prompt caching de 3 bloques, deduplicación, ~$0.022/run), `insights-worker.ts`, `schedulers.ts`, `init.ts`
- [x] Layout admin: Sidebar con branding (gradiente Click Society, user menu con roles)
- [x] Página de login: Google OAuth + magic link
- [x] Listado de clientes: grid con estado del ciclo, alertas críticas, tareas pendientes
- [x] Wizard de alta de cliente: 3 pasos (datos básicos + plan, propiedades GSC/GA4, keywords + competidores)
- [x] Vista detalle de cliente: portada con gráfica mock (Recharts), InsightCards, operativa del mes, 9 módulos placeholder
- [x] `POST /api/clientes`: endpoint REST temporal que procesa el wizard (migrar a tRPC en Fase 2)
- [x] `.env.example` con todas las variables necesarias

**Pendiente:**
- [ ] **Setup git**: `git init` local → `.gitignore` (Next.js + Prisma + .env) → primer commit → `git remote add origin https://github.com/jorgeruiz/cerebro-seo.git` → push a main
- [ ] **Docker compose**: `docker-compose.yml` con PostgreSQL 16 + Redis 7 para desarrollo local
- [ ] **Primer `.env` local**: llenar credenciales reales (DataForSEO ya disponibles)
- [ ] **Primera migración**: `npx prisma migrate dev --name init`
- [ ] **Provider layer**: interface `SeoDataProvider` + implementación `DataForSeoProvider` (rankings, backlinks, domain authority, keyword suggestions)
- [ ] **Validación DataForSEO vs GSC**: 3 clientes reales × 5 keywords, comparar resultados
- [ ] **Conexión GSC**: OAuth flow + lectura de datos reales en portada
- [ ] **Conexión GA4**: OAuth flow + métricas de sesiones/conversiones
- [ ] **Deploy inicial**: Easypanel + subdominio `seo.clicksociety.mx`

---

## 5. Backlog por fases (post Fase 1)

### Fase 2 — Datos reales fluyendo
- GSC + GA4 conectados y mostrando en portada del cliente
- Módulo Términos de búsqueda (queries GSC)
- Módulo Tráfico de páginas (GA4 + GSC)
- Primer audit técnico con crawler (Cheerio + PageSpeed Insights)
- Sync con Notion: tareas y estrategia del mes en panel
- InsightsAgent corriendo con datos reales (primer ciclo completo)
- tRPC routers: `clientesRouter`, `ciclosRouter`, `insightsRouter`
- Refactorizar `POST /api/clientes` → `clientesRouter.create` tRPC

### Fase 3 — Competencia + Backlinks + Eventos
- Módulo Análisis de competencia (share of voice, keyword gaps)
- Módulo Backlinks (nuevos/perdidos, DA)
- Módulo Eventos / Timeline (anotaciones manuales + automáticas)
- RankTrackingAgent, BacklinksAgent, CompetitorAgent activados con datos reales

### Fase 4 — IA y diferenciadores
- Módulo AI Search Visibility (ChatGPT, Perplexity, Gemini)
- Módulo Keyword ideas (DataForSEO Keyword Suggestions)
- Módulo SEO Opportunities (cálculo automático de oportunidades)
- Reporte mensual auto-generado (ReportAgent + PDF)
- CycleCloseAgent: cierre de ciclo y validación de hipótesis automatizados

### Fase 5 — Vista cliente
- Magic links para acceso de clientes finales
- Vista limpia sin jerga interna
- Export PDF del dashboard
- Personalización de branding por cliente

---

## 6. Bloqueadores actuales

1. **No hay `.env` local** → la app no puede arrancar ni conectar a BD o Redis.
2. **No hay `git init` local** → el repo GitHub existe pero no está vinculado al código local.
3. **No hay docker-compose** → setup local no está documentado ni es reproducible.

Los tres se resuelven en los primeros 30 minutos de la próxima sesión, antes de tocar cualquier código nuevo.

---

## 7. Riesgos vivos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Calidad de datos de DataForSEO no es la esperada | Baja | Alto | Validación vs GSC como parte del DataForSeoProvider (Fase 1) |
| Costos de DataForSEO se disparan con escala | Media | Medio | `ApiUsage` table + alertas + caching agresivo (ya diseñado) |
| Sync con Cerebro más complicado de lo previsto | Media | Medio | REST simple ya decidido; `cerebro-bridge.ts` pendiente Fase 2 |
| Sitios bloquean al crawler | Media | Bajo | User agent custom, respeto robots.txt, fallback Playwright |
| Cliente accede a datos de otro cliente | Baja | Crítico | Tests de autorización; toda query Prisma filtra por `clientId` de sesión |

---

## 8. Bitácora de sesiones

### Sesión 2 — 2026-05-07
**Participantes:** Jorge + Claude Code
**Duración:** ~3h
**Trabajo realizado:**
- Diseño del sistema de multiagentes (blueprint aprobado): 9 agentes, 3 queues BullMQ, estrategia de prompt caching de 3 bloques, estimación de costos Claude ~$9-11 USD/mes para 10 clientes
- Implementación infraestructura de jobs: `queues.ts`, `base-worker.ts`, `insights-processor.ts` (InsightsAgent completo), `insights-worker.ts`, `schedulers.ts`, `init.ts`
- Fase 1 Foundation: Next.js 14 inicializado, Prisma schema completo, auth (Google + magic link), layout sidebar con branding, login page, listado clientes, wizard 3-pasos, vista detalle con gráfica mock y módulos placeholder
- Decisiones técnicas: Prisma 7→5 (breaking changes), shadcn base-nova (asChild no disponible), tRPC vs REST clarificado, Docker para dev local, roadmap reordenado de 7 a 5 fases + multiagentes como infraestructura transversal
- Actualización de todos los documentos de conocimiento del proyecto
- Confirmación: repo `jorgeruiz/cerebro-seo` ya creado en GitHub (privado)

**Pendiente para próxima sesión (en orden):**
1. `git init` local + `.gitignore` + primer commit + push a `jorgeruiz/cerebro-seo`
2. `docker-compose.yml` (PostgreSQL + Redis) + `.env` local con credenciales reales
3. `npx prisma migrate dev --name init`
4. Provider layer DataForSEO + validación vs GSC
5. Conexión GSC/GA4
6. Deploy Easypanel

### Sesión 1 — 2026-05-07
**Participantes:** Jorge + Cerebro
**Duración:** ~1h
**Decisiones:**
- Concepto general aprobado. DataForSEO como provider primario. Ubersuggest descartado.
- Definidos: 9 módulos del panel, ciclo mensual como entidad, hipótesis verificables, AI Search Visibility
- Plan de 7 fases acordado (luego reordenado en sesión 2)
- Documentación base creada: `project_spec.md`, `architecture.md`, `project_state.md`, `integration_cerebro.md`, `api_providers.md`, `CLAUDE.md`

---

## 9. Información operativa

### Acceso a infraestructura
- **Easypanel:** http://76.13.121.6:3000 — `jorge.arm@gmail.com` / `ClickSociety12#`
- **GitHub repo:** https://github.com/jorgeruiz/cerebro-seo (privado)
- **Subdominio destino:** `seo.clicksociety.mx`

### Credenciales disponibles
- ✅ DataForSEO: cuenta creada, $50 depositado, test SERP exitoso (07-may-2026)
- ✅ Google OAuth: en Cerebro — reutilizar con scope ampliado
- ✅ Anthropic API key
- ✅ Notion API key (en Cerebro)
- ❌ PageSpeed Insights API key: generar en Fase 2
- ❌ NEXTAUTH_SECRET: generar con `openssl rand -base64 32`
- ❌ CEREBRO_INTERNAL_SECRET: generar y coordinar con Cerebro

---

## 10. Métricas de éxito

**Internas (Click Society):**
- Reducción de horas/mes de reporting manual: meta -50%
- Hipótesis validadas por mes: meta ≥ 60%
- Costo de stack SEO: meta < $50 USD/mes con 10 clientes

**Producto:**
- Tiempo de generación de reporte mensual: meta < 5 minutos
- Uptime: meta > 99%
- Costo promedio por cliente/mes en DataForSEO: meta < $5 USD

**Cliente final:**
- Adopción del panel: meta > 70% de clientes acceden ≥ 2 veces/mes
- NPS interno (Félix, Cindy): meta > 8/10
