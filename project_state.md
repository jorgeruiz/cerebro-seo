# Cerebro SEO — Project State

> Documento vivo. Se actualiza al inicio y cierre de cada sesión de trabajo.

**Última actualización:** 2026-05-10
**Fase actual:** Fase 1 — Foundation (en curso — BD funcionando, GSC/GA4 pendiente)
**Próximo hito:** Conexión GSC y GA4 con datos reales → deploy inicial Easypanel

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
| Conexión GSC y GA4 | ❌ Pendiente | OAuth Client ID creado; código pendiente |
| Deploy inicial Easypanel | ❌ Pendiente | Después de verificar app completa |

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

**Pendiente:**
- [ ] Comparar `validation-report.md` contra GSC de los 3 clientes
- [ ] Conexión GSC: OAuth flow + datos reales en portada
- [ ] Conexión GA4: OAuth flow + métricas reales
- [ ] Deploy inicial Easypanel + DNS `seo.clicksociety.mx`

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

Ninguno. El bloqueador de Docker fue resuelto con OrbStack en Sesión 4.

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

## 10. Próximo paso concreto

1. **Comparar `validation-report.md` contra GSC** de Molino Azteca, RFN y Quicsa para validar DataForSEO.
2. **Implementar conexión GSC**: OAuth flow con Google Search Console API + mostrar datos reales en portada del cliente.
3. **Implementar conexión GA4**: OAuth flow + métricas reales en portada.
4. **Deploy inicial Easypanel** + configurar DNS `seo.clicksociety.mx`.

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
