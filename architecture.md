# Cerebro SEO — Architecture

**Última actualización:** 2026-05-10 (v3)

---

## 1. Stack técnico

```
Frontend:    Next.js 14 (App Router) + TypeScript + TailwindCSS + shadcn/ui
Charts:      Recharts (consistencia con Cerebro)
Backend:     Next.js API Routes + tRPC (tRPC pendiente de implementar en Fase 2)
DB:          PostgreSQL 16 + Prisma ORM v5.22
Auth:        NextAuth v4 (Google OAuth — solo equipo interno, sin magic link)
Jobs:        BullMQ v5 + Redis / ioredis v5
Crawler:     Cheerio (default) + Playwright (fallback para SPAs)
Cache:       Redis para datos de DataForSEO (TTL 24h-7d según endpoint)
Deploy:      Easypanel VPS (proyecto separado de Cerebro)
Dev local:   OrbStack — PostgreSQL 16 + Redis 7 via docker-compose (Docker Desktop no arranca en MacBook Air M4 / macOS Tahoe 26.2)
Repo:        github.com/jorgeruiz/cerebro-seo (privado, cuenta personal jorgeruiz)
```

**Notas técnicas importantes:**
- **Prisma v5.22** (no v7): Prisma 7 eliminó soporte de `url` en el datasource del schema y cambió el formato de enums — incompatible con el setup estándar de Next.js. Se usa v5 como versión estable.
- **shadcn estilo `base-nova`**: la versión instalada usa `@base-ui/react` como primitivos (no Radix UI). El patrón `asChild` **no existe** en este estilo. Para links con apariencia de botón, usar `buttonVariants({ variant })` aplicado directamente a `<Link>` de Next.js.
- **tRPC pendiente**: el stack define tRPC para APIs internas, pero aún no está implementado. El endpoint `POST /api/clientes` es REST temporal — se migrará a `clientesRouter` tRPC en Fase 2. REST se reserva para: webhooks de proveedores externos, endpoints NextAuth, y bridge con Cerebro vía shared secret.

---

## 2. Estructura de carpetas (estado real)

```
cerebro-seo/
├── prisma/
│   └── schema.prisma              # Schema completo con todos los modelos
├── src/
│   ├── app/
│   │   ├── (admin)/               # Grupo de rutas admin/editor
│   │   │   ├── layout.tsx         # Verifica sesión + rol; redirige CLIENT a /portal
│   │   │   └── clientes/
│   │   │       ├── page.tsx                   # Listado de clientes (server component)
│   │   │       ├── nuevo/
│   │   │       │   └── page.tsx               # Wizard de alta (3 pasos, client component)
│   │   │       └── [id]/
│   │   │           ├── page.tsx               # Detalle del cliente (server component)
│   │   │           ├── ClientPortadaChart.tsx # Gráfica principal Recharts (client)
│   │   │           └── InsightCards.tsx       # Cards de insights proactivos (client)
│   │   ├── (auth)/
│   │   │   ├── layout.tsx
│   │   │   └── login/
│   │   │       └── page.tsx       # Login: Google OAuth + magic link
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts  # Handler NextAuth
│   │   │   ├── clientes/route.ts            # POST: crea cliente (temporal → tRPC Fase 2)
│   │   │   └── jobs/init/route.ts           # GET: inicializa workers (interno, con secret)
│   │   ├── globals.css
│   │   ├── layout.tsx             # Root layout: fuente Inter + SessionProvider
│   │   └── page.tsx               # Redirect a /clientes
│   ├── components/
│   │   ├── layout/
│   │   │   ├── SessionProvider.tsx  # Wrapper "use client" para NextAuth
│   │   │   └── Sidebar.tsx          # Navegación lateral con branding Click Society
│   │   └── ui/                      # shadcn/ui (base-nova): avatar, badge, button,
│   │                                #   card, dropdown-menu, input, label, select, separator
│   ├── env.ts                     # Validación de ENV con Zod al startup
│   ├── lib/
│   │   ├── auth.ts                # NextAuth authOptions + getSession helper
│   │   ├── db.ts                  # Singleton PrismaClient con hot-reload seguro
│   │   ├── redis.ts               # Singleton ioredis (maxRetriesPerRequest: null para BullMQ)
│   │   └── utils.ts               # cn() helper de shadcn
│   ├── middleware.ts              # Protección de rutas via next-auth/middleware
│   ├── server/
│   │   └── jobs/                  # Sistema de multiagentes (ver sección 5)
│   │       ├── init.ts            # Punto de entrada: importa workers + inicia schedulers
│   │       ├── queues.ts          # 3 queues BullMQ + tipos TypeScript de job data
│   │       ├── schedulers.ts      # Cron jobs por cliente (idempotentes con jobId)
│   │       ├── processors/
│   │       │   └── insights-processor.ts  # Lógica InsightsAgent (separada de BullMQ)
│   │       └── workers/
│   │           ├── base-worker.ts         # Factory: logging, ApiUsage, alertas de fallo
│   │           └── insights-worker.ts     # Worker BullMQ (concurrency: 3)
│   └── types/
│       └── next-auth.d.ts         # Extensión de tipos: Session.user.id y Session.user.role
├── components.json                # Config shadcn (style: base-nova)
├── .env.example                   # Plantilla de variables de entorno
├── next.config.mjs
├── package.json                   # Next 14.2, Prisma 5.22, BullMQ 5.76, Anthropic SDK 0.95
├── tailwind.config.ts
└── tsconfig.json
```

**Implementado en Sesión 3 (ahora existe):**
```
src/server/providers/
├── seo-data.ts    # Interface SeoDataProvider + 8 tipos auxiliares
└── dataforseo.ts  # DataForSeoProvider: getKeywordRanking, bulkGetRankings,
                   #   getDomainAuthority, getBacklinksSummary (reales)
                   #   + stubs: getKeywordSuggestions, getKeywordVolume,
                   #     getCompetitorOverview, getOrganicCompetitors, getSerp (Fase 2-3)

scripts/
└── validate-dataforseo.ts  # Script de validación SERP Live (15 queries, ejecutado ×2)

prisma/migrations/
└── 20260510075453_init/    # Primera migración — 21 tablas creadas
    └── migration.sql
```

**Por implementar (no existe todavía):**
```
src/
├── server/
│   ├── trpc/                       # Routers tRPC — Fase 2
│   │   └── routers/
│   │       ├── clientes.ts         # Migración de /api/clientes
│   │       ├── ciclos.ts
│   │       └── insights.ts
│   └── jobs/
│       └── workers/                # Agentes pendientes — Fases 2-4
│           ├── crawler-worker.ts
│           ├── rank-tracking-worker.ts
│           ├── backlinks-worker.ts
│           ├── competitor-worker.ts
│           ├── ai-search-worker.ts
│           ├── cycle-close-worker.ts
│           ├── report-worker.ts
│           └── sync-worker.ts
└── lib/
    ├── cerebro-bridge.ts           # Cliente REST para Cerebro — Fase 2
    └── notion.ts                   # Acceso a Notion vía Cerebro — Fase 2
```

---

## 3. Modelo de datos (schema real, v2)

### Modelos NextAuth (agregados en sesión 2)

```prisma
enum UserRole { ADMIN EDITOR CLIENT }

model User {
  id            String    @id @default(cuid())
  name          String?
  email         String    @unique
  emailVerified DateTime?
  image         String?
  role          UserRole  @default(EDITOR)
  createdAt     DateTime  @default(now())
  accounts      Account[]
  sessions      Session[]
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?
  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expires      DateTime
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime
  @@unique([identifier, token])
}
```

### ApiUsage — columnas reales (verificado contra BD 2026-05-10)

```prisma
model ApiUsage {
  id       String   @id @default(cuid())
  provider String                          // "dataforseo", "anthropic", etc.
  endpoint String                          // e.g. "serp/organic/live/validation"
  cost     Decimal  @db.Decimal(10, 6)    // CUIDADO: es "cost", no "costUsd"
  clientId String?
  date     DateTime @default(now())        // CUIDADO: es "date", no "createdAt"

  @@index([provider, date])
  @@index([clientId, date])
}
```

> **Nota para queries manuales:** usar `cost` y `date`, no `costUsd` ni `createdAt`. Ejemplo:
> ```sql
> SELECT provider, endpoint, cost, date FROM "ApiUsage" ORDER BY date DESC LIMIT 10;
> ```

### Modelos de negocio (campos nuevos vs v1 marcados con ★)

Los modelos base (Client, Site, MonthlyCycle, Task, Hypothesis, Keyword, KeywordRanking, Competitor, Audit, Backlink, PageMetric, Insight, TimelineEvent, AiSearchVisibility, ClientUser, ApiUsage) mantienen la misma estructura. Campos y modelos agregados:

```prisma
model Insight {
  // ... campos base sin cambios ...
  suggestedAction  String?  @db.Text  // ★ acción recomendada en lenguaje natural
  dataPoints       Json?              // ★ evidencia numérica que soporta el insight
}

model KeywordRanking {
  // ... campos base sin cambios ...
  delta  Int?  // ★ cambio de posición vs período anterior
}

model Competitor {
  // ... campos base sin cambios ...
  snapshotData  Json?  // ★ último snapshot de DataForSEO Labs (DA, traffic, keywords)
}

model Audit {
  // ... campos base sin cambios ...
  summary  String?  @db.Text  // ★ resumen en lenguaje natural generado por Haiku 4.5
}

// ★ nuevo modelo: registro de ejecución de jobs para observabilidad
model JobLog {
  id        String   @id @default(cuid())
  jobName   String
  clientId  String?
  status    String   // success | failed
  error     String?  @db.Text
  attempts  Int
  createdAt DateTime @default(now())
  @@index([jobName, createdAt])
}
```

**Enums sin cambios:** `SeoPlan`, `ClientStatus`, `CycleStatus`, `TaskStatus`, `ValidationStatus`, `BacklinkStatus`, `InsightType`, `EventType`.

---

## 4. Provider Layer

Toda integración con APIs externas de SEO se abstrae detrás de `SeoDataProvider`. Permite cambiar/agregar proveedores sin tocar lógica de negocio ni frontend.

**Estado:** ✅ Implementado (Sesión 3). Archivos: `src/server/providers/seo-data.ts` y `src/server/providers/dataforseo.ts`.

```typescript
// src/server/providers/seo-data.ts

export interface SeoDataProvider {
  name: string;

  // Rankings
  getKeywordRanking(params: {
    keyword: string;
    domain: string;
    country: string;
    language: string;
  }): Promise<RankingResult>;
  bulkGetRankings(keywords: KeywordQuery[]): Promise<RankingResult[]>;

  // Backlinks
  getBacklinks(domain: string, options?: BacklinkOptions): Promise<Backlink[]>;
  getDomainAuthority(domain: string): Promise<number>;

  // Keyword research
  getKeywordSuggestions(seed: string, country: string): Promise<KeywordSuggestion[]>;
  getKeywordVolume(keywords: string[], country: string): Promise<KeywordVolume[]>;

  // Competitor analysis
  getCompetitorOverview(domain: string): Promise<CompetitorData>;
  getOrganicCompetitors(domain: string): Promise<string[]>;

  // SERP
  getSerp(keyword: string, country: string): Promise<SerpResult>;
}

export class DataForSeoProvider implements SeoDataProvider { /* ... */ }
```

**Métodos implementados en DataForSeoProvider:**
- `getKeywordRanking()` — SERP Live, depth 100, con retry exponencial
- `bulkGetRankings()` — SERP Standard Queue con polling (max 10 min, batches de 100)
- `getDomainAuthority()` — Labs Domain Rank, cache Redis 7d
- `getBacklinksSummary()` — Backlinks Summary, cache Redis 24h

**Stubs (Fase 2-3):** `getKeywordSuggestions`, `getKeywordVolume`, `getCompetitorOverview`, `getOrganicCompetitors`, `getSerp`.

**Nota de costos DataForSEO:** el precio base $0.002/query es para depth:10. depth:100 cuesta $0.0155/query ($0.002 + 9 × $0.0015). Para tracking masivo en producción usar Standard Queue.

**Beneficios:**
- Swap del provider sin refactorizar frontend ni lógica de negocio.
- Tests con `MockProvider` trivial.
- Cada llamada se loggea en `ApiUsage` con costo y `clientId`.

---

## 5. Sistema de Multiagentes (infraestructura transversal)

El sistema de multiagentes ya está construido como infraestructura. No es una fase del roadmap — es la capa de inteligencia que acompaña todo el sistema. Los agentes se activan conforme las fases proveen datos reales.

### Arquitectura

```
BullMQ Scheduler (cron)
├── Queue: data-collection   → agentes de recolección (sin Claude)
├── Queue: ai-analysis       → agentes que usan Claude API
└── Queue: sync              → sincronización con Cerebro/Notion
```

Los agentes coordinan a través de:
- **Redis** — estado temporal, cache de APIs, resúmenes entre agentes (TTL por tipo de dato)
- **PostgreSQL** — outputs permanentes
- **BullMQ job chaining** — un job encola el siguiente al terminar

### Los 9 agentes

| Agente | Queue | Modelo Claude | Estado |
|---|---|---|---|
| InsightsAgent | ai-analysis | Sonnet 4.6 | ✅ Implementado |
| CrawlerAgent | data-collection | Haiku 4.5 (solo síntesis) | Pendiente Fase 2 |
| RankTrackingAgent | data-collection | Sin Claude | Pendiente Fase 2 |
| CerebroSyncAgent | sync | Sin Claude | Pendiente Fase 2 |
| BacklinksAgent | data-collection | Sin Claude | Pendiente Fase 3 |
| CompetitorAgent | data-collection | Haiku 4.5 (3 observaciones) | Pendiente Fase 3 |
| AiSearchAgent | data-collection | Sin Claude | Pendiente Fase 4 |
| CycleCloseAgent | ai-analysis | Sonnet 4.6 | Pendiente Fase 4 |
| ReportAgent | ai-analysis | Sonnet 4.6 + Haiku 4.5 | Pendiente Fase 4 |

### InsightsAgent — optimización de contexto

El InsightsAgent usa Sonnet 4.6 con prompt caching de 3 bloques:

| Bloque | Contenido | Cambia | Cache |
|---|---|---|---|
| A | System prompt + perfil cliente + objetivos del ciclo | Nunca en el mes | ✅ `cache_control: ephemeral` |
| B | Tendencias diarias (rankings resumidos, audit score) | 1× por día | ✅ TTL 25h en Redis |
| C | Contexto del trigger (ranking drop, audit complete, etc.) | Cada llamada | ❌ dinámico |

**Costo estimado por ejecución:** ~$0.022 (con 75-80% de tokens desde caché).
**Costo mensual para 10 clientes (diario):** ~$8-10 USD.

**Regla maestra:** Claude nunca recibe datos crudos. Un audit de 500 páginas llega a Claude como ~200 tokens (agrupado por tipo de issue). Rankings de 200 keywords llegan como resumen agregado en Redis.

### Cuándo usar cada modelo

| Tarea | Modelo |
|---|---|
| Narrar resumen de audit | Haiku 4.5 |
| Clasificar keywords por intent | Haiku 4.5 |
| Resumen ejecutivo del reporte (sintetiza secciones ya escritas) | Haiku 4.5 |
| Generar insights proactivos (correlación múltiples fuentes) | Sonnet 4.6 |
| Validar hipótesis con datos del mes (razonamiento causal) | Sonnet 4.6 |
| Narrativa del reporte mensual | Sonnet 4.6 |
| Análisis estratégico inter-mensual (desde Cerebro chat) | Opus 4.7 |
| Scores, clasificaciones determinísticas | Algoritmo (sin Claude) |

### Redis key namespace

```
# Cache de APIs externas
cache:dataforseo:domain:{domain}:rank        TTL 7d
cache:dataforseo:backlinks:{domain}:summary  TTL 24h
cache:dataforseo:kw:{kw}:{country}:volume    TTL 30d

# Idempotencia de jobs
job:tracking:{clientId}:{dateISO}:done       set de keywordIds procesados
job:audit:{siteId}:{dateISO}:inprogress      lock flag, TTL 2h

# Resúmenes entre agentes (evitar re-computar)
agent:rankings:{clientId}:summary:{weekISO}  RankingsSummary JSON, TTL 48h
agent:audit:{siteId}:latest                  AuditOutput comprimido, TTL 8h

# Contexto para prompt caching (InsightsAgent)
insights:ctx:{clientId}:{yearMonth}:profile  Bloque A, TTL resto del mes + 2d
insights:ctx:{clientId}:{dateISO}:trends     Bloque B, TTL 25h
insights:ran:{clientId}:{dateISO}:{trigger}  Idempotencia, TTL 25h
```

---

## 6. Jobs en background

| Job | Agente | Frecuencia | Estado |
|---|---|---|---|
| `tracking:rankings-priority` | RankTrackingAgent | Diario 3 AM | Pendiente Fase 2 |
| `tracking:rankings-bulk` | RankTrackingAgent | Lunes 4 AM | Pendiente Fase 2 |
| `crawler:audit-quick` | CrawlerAgent | Miércoles 2 AM | Pendiente Fase 2 |
| `crawler:audit` | CrawlerAgent | Día 1 del mes, 1 AM | Pendiente Fase 2 |
| `insights:generate` | InsightsAgent | Diario 6 AM | ✅ Código listo; espera datos reales |
| `sync:cerebro` | CerebroSyncAgent | Cada 6 horas | Pendiente Fase 2 |
| `analysis:backlinks` | BacklinksAgent | Jueves 5 AM | Pendiente Fase 3 |
| `analysis:competitors` | CompetitorAgent | Días 1 y 15, 7 AM | Pendiente Fase 3 |
| `analysis:ai-search` | AiSearchAgent | Viernes 6 AM | Pendiente Fase 4 |
| `cycle:close` | CycleCloseAgent | Día 1 del mes, 2 AM | Pendiente Fase 4 |
| `report:monthly` | ReportAgent | Día 2 del mes, 6 AM | Pendiente Fase 4 |

---

## 7. Integración con Cerebro

**Decisión tomada (07-may-2026):** REST API interna con shared secret. Descartado Prisma multi-schema.

Implementación pendiente en `src/lib/cerebro-bridge.ts` (Fase 2). Ver `integration_cerebro.md` para detalle de endpoints y contratos de datos.

---

## 8. Caching strategy

| Tipo de dato | TTL | Justificación |
|---|---|---|
| Domain Authority | 7 días | No cambia rápido |
| Backlinks summary | 24 horas | Cambian lento |
| SERP de keyword (rank tracking) | Sin caché | Necesitamos histórico diario |
| Keyword volume | 30 días | Estable |
| Competidores orgánicos | 7 días | Estable |
| GSC data | 24 horas | API gratuita, fresca diaria |
| GA4 data | 4 horas | API gratuita |
| Contexto InsightsAgent Bloque A | Resto del mes | Idéntico para todas las calls del mes |
| Contexto InsightsAgent Bloque B | 25 horas | Regenerado una vez al día |

---

## 9. Seguridad

- **Auth:** NextAuth v4. Google OAuth únicamente — herramienta 100% interna, sin acceso de clientes finales.
- **Session strategy: JWT obligatorio en producción.** `session.strategy: "jwt"` es requerido cuando se usa `next-auth/middleware` en Next.js App Router. Con `strategy: "database"` (default de PrismaAdapter), la cookie `session-token` contiene un UUID opaco. El middleware llama `getToken()` internamente, que solo decodifica JWTs — al recibir un UUID falla silenciosamente y redirige al login aunque la sesión exista en Postgres. PrismaAdapter sigue activo y persiste `User` y `Account` correctamente.
- **Roles:** `UserRole` enum en BD (ADMIN, EDITOR). El rol se incluye en el JWT y se propaga a `session.user.role` vía el callback `jwt`.
- **Autorización server-side:** Admin layout verifica rol ADMIN o EDITOR.
- **Row-level security:** toda query Prisma filtrada por `clientId` derivado de la sesión. Nunca confiar en `clientId` del request.
- **Bridge Cerebro:** shared secret en header `x-internal-secret`, validado en ambos servicios.
- **API keys de proveedores:** solo en variables de entorno, nunca en commits.
- **Webhook validation:** firma HMAC para webhooks de DataForSEO.
- **Sin PII en logs de producción.**

---

## 10. Variables de entorno

Ver `.env.example` en la raíz. Validadas con Zod en `src/env.ts` al startup — la app no arranca si falta cualquier variable requerida.

---

## 11. Decisiones técnicas pendientes

1. **Single Sign-On real** entre Cerebro y Cerebro SEO: cookie en dominio padre `clicksociety.mx` vs login separado con mismas credenciales. *Resolver antes de Fase 2 en producción.*
2. **Almacenamiento de PDFs:** recomendación: Cloudflare R2. Confirmar al implementar ReportAgent en Fase 4.
3. **AI Search Visibility provider:** DataForSEO LLM APIs vs Profound vs stack propio. *Definir en Fase 4.*
