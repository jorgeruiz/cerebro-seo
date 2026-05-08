# CLAUDE.md — Instrucciones para Claude Code en Cerebro SEO

> Este documento le dice a Claude Code cómo trabajar en este proyecto. Léelo al inicio de cada sesión.

---

## Contexto del proyecto

Cerebro SEO es una aplicación SEO white-label para Click Society, agencia de marketing digital en Monterrey. Es **hermana** de Cerebro (también de Click Society): comparte branding, stack, y se integra fuerte con ella, pero es un repo, BD y deploy separados.

**Antes de tocar código, lee siempre:**
1. `project_state.md` — estado vivo del proyecto, qué se ha hecho, qué sigue
2. `project_spec.md` — visión y módulos
3. `architecture.md` — stack, modelo de datos, decisiones técnicas
4. `integration_cerebro.md` — cómo se conecta con Cerebro
5. `api_providers.md` — referencia de APIs externas

---

## Stack y convenciones

- **Next.js 14 App Router + TypeScript estricto.** No usar pages router.
- **Prisma v5 + PostgreSQL.** Migraciones siempre con `prisma migrate dev --name descriptive_name`. Nunca `prisma db push` en producción. No actualizar a Prisma 7 — tiene breaking changes incompatibles.
- **tRPC para APIs internas.** REST exclusivamente para: (a) webhooks de proveedores externos, (b) endpoints públicos de NextAuth (`/api/auth/*`), (c) bridge interno con Cerebro vía shared secret. El endpoint `POST /api/clientes` es temporal — migrar a `clientesRouter` tRPC en Fase 2.
- **TailwindCSS + shadcn/ui (estilo `base-nova`).** No agregar otros sistemas de UI. La versión instalada usa `@base-ui/react` (no Radix UI) — el patrón `asChild` **no existe**. Para links con apariencia de botón, usar `buttonVariants({ variant })` directamente en un `<Link>` de Next.js.
- **Recharts para gráficas.** Mismo que Cerebro.
- **NextAuth v4 con Google OAuth (interno) + Magic Link (clientes).**
- **BullMQ + Redis para jobs en background.** Crawls y trackings van por aquí, nunca en el request HTTP.

### Convenciones de código
- Componentes React: PascalCase, un componente por archivo.
- Hooks: `useNombreCamelCase` en `/src/hooks/`.
- Server actions: prefijo `action` (ej: `actionCreateClient`).
- Routers tRPC: agrupados por dominio en `/src/server/trpc/routers/`.
- Variables de entorno: validadas con Zod en `/src/env.ts` al inicio de la app.
- Jamás hardcodear claves o secrets. Todo en `.env`.

### Branding visual
- Gradiente principal: `from-[#6366f1] via-[#3b82f6] to-[#ec4899]`
- Componentes shadcn instalados según se necesiten: `npx shadcn@latest add [componente]` (el paquete correcto es `shadcn`, no `shadcn-ui`)
- Light mode primario, dark mode futuro (no v1)

---

## Setup local con Docker

El entorno de desarrollo usa Docker para PostgreSQL y Redis. Easypanel es **solo para producción**.

### docker-compose.yml (crear en la raíz del proyecto si no existe)

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: cerebro
      POSTGRES_PASSWORD: cerebro
      POSTGRES_DB: cerebro_seo
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

### Variables de entorno para desarrollo local

```bash
DATABASE_URL="postgresql://cerebro:cerebro@localhost:5432/cerebro_seo"
REDIS_URL="redis://localhost:6379"
```

### Secuencia de setup inicial (primera vez)

```bash
# 1. Levantar servicios
docker compose up -d

# 2. Copiar y llenar variables de entorno
cp .env.example .env
# Editar .env con credenciales reales

# 3. Primera migración
npx prisma migrate dev --name init

# 4. Generar cliente Prisma
npx prisma generate

# 5. Arrancar app
npm run dev
```

---

## Cómo trabajar con este proyecto

### Al iniciar sesión:
1. Lee `project_state.md` para saber dónde se quedó el trabajo.
2. Confirma qué fase y qué tareas del backlog se van a abordar.
3. Si hay decisiones pendientes que bloquean, pregunta antes de codear.

### Al hacer cambios:
1. **Migraciones de BD:** siempre con nombre descriptivo. Nunca `prisma db push` en producción.
2. **Tests:** escribir tests para lógica de auth, autorización, y provider layer. UI puede ir sin tests inicialmente.
3. **Commits:** mensaje en español, conciso. Formato: `tipo: descripción` (ej: `feat: vista detalle de cliente con grafica principal`).
4. **No tocar código de otra fase sin avisar.** Si estás en Fase 1 y necesitas algo de Fase 3, pregunta.

### Al cerrar sesión:
1. Actualiza `project_state.md`:
   - Marca tareas completadas
   - Anota decisiones tomadas con fecha
   - Documenta bloqueadores nuevos
   - Agrega entrada en bitácora de sesiones
2. Si se tomaron decisiones técnicas relevantes, actualiza también `architecture.md`.
3. Si se cambió algo del producto, actualiza `project_spec.md`.

---

## Patrones de Cerebro a reutilizar

Cerebro ya resolvió varios problemas. Antes de inventar, revisar cómo se hizo allá:

- **Auth con Google OAuth + roles ADMIN/EDITOR/CLIENT:** ya implementado en Cerebro SEO (copiar de ahí, no de Cerebro).
- **Conexión con Search Console y GA4:** ya hay clientes implementados en Cerebro, exportar como librería compartida o copiar.
- **Conexión con Notion:** patrones documentados (UUID sin dashes en filtros, filtrar por "Estado", etc.).
- **Sistema de tareas y estrategias mensuales:** Cerebro ya tiene `crear_estrategia`, `guardar_estrategia`, `cerrar_mes`. Cerebro SEO consume estos a través del bridge REST.

---

## Reglas críticas

### Seguridad
- **Cliente A nunca debe ver datos de Cliente B.** Toda query de Prisma filtra por `clientId` derivado de la sesión. Nunca confiar en `clientId` que venga del request.
- **CLIENT role solo lee, jamás escribe.** Sus endpoints son `query`, nunca `mutation`.
- **Secrets nunca en commits.** Usar `.env`, agregar `.env*` a `.gitignore` excepto `.env.example`.

### Costos
- **Cada llamada a DataForSEO se loggea en `ApiUsage`** con costo y `clientId`.
- **Cache agresivo:** antes de llamar a DataForSEO, verificar Redis.
- **Standard Queue por default**, Live solo si el usuario lo pidió explícitamente o el contexto lo justifica.

### Datos
- **Cliente como entidad:** Notion es source of truth. Cerebro SEO mantiene copia local sincronizada.
- **Tareas y Estrategia:** Notion vía Cerebro. No escribir directo a Notion desde cerebro-seo.
- **Histórico de rankings, audits, backlinks:** Cerebro SEO es source of truth.

### Performance
- **Crawler asíncrono.** Un sitio grande puede tardar minutos. Frontend hace polling.
- **Reportes y análisis con Claude:** asíncronos, encolados en BullMQ.
- **Dashboards renderizan rápido** usando datos pre-calculados, no consultas en tiempo real a APIs externas.

---

## Cuándo PARAR y preguntar

Para estos casos, no avances sin confirmación:

1. Si una decisión va a afectar la estructura del modelo de datos de forma irreversible.
2. Si se va a integrar un proveedor externo no listado en `api_providers.md`.
3. Si una tarea va a costar más de $20 USD en consumo de DataForSEO durante el desarrollo.
4. Si se necesita escribir en Notion (debería pasar por Cerebro).
5. Si el trabajo va a tomar más de un día completo continuo (probable que falte clarificar scope).
6. Si hay conflicto entre lo que dice el spec y lo que pide el usuario en la sesión actual.

---

## Comunicación con Jorge

- **Idioma:** español natural, sin jerga innecesaria.
- **Concisión:** ir al grano. Jorge prefiere prompts copy-paste-ready y batches de cambios.
- **Honestidad técnica:** si algo no es buena idea, decirlo con razones. No ser complaciente.
- **Contexto:** Jorge no es desarrollador full-time pero entiende el stack. No hay que sobre-explicar conceptos básicos, sí explicar trade-offs.

---

## Información operativa

- **Easypanel VPS:** http://76.13.121.6:3000 — `jorge.arm@gmail.com` / `ClickSociety12#`
- **Conexión a Easypanel:** Claude Code conecta vía HTTP API con curl, no SSH.
- **GitHub repo:** `jorgeruiz/cerebro-seo` (privado, bajo cuenta personal `jorgeruiz`). Click Society no usa GitHub Organizations — todos los repos del agency van bajo `jorgeruiz`.
- **Remote URL:** `https://github.com/jorgeruiz/cerebro-seo.git`
- **Subdominio:** `seo.clicksociety.mx`.
- **Cerebro:** `cerebro.clicksociety.mx` (cuando esté en producción).

---

## Comandos útiles

```bash
# Setup local (primera vez)
docker compose up -d
cp .env.example .env  # llenar con credenciales reales
npx prisma migrate dev --name init
npm run dev

# Setup git (primera vez — repo ya existe en GitHub)
git init
# Crear .gitignore apropiado para Next.js + Prisma
git add .
git commit -m "feat: foundation — next.js, auth, schema, multiagentes, ui base"
git remote add origin https://github.com/jorgeruiz/cerebro-seo.git
git push -u origin main

# Trabajo diario
npm run dev
docker compose up -d  # si los servicios no están corriendo

# Crear nueva migración
npx prisma migrate dev --name nombre_descriptivo

# Generar tipos de Prisma
npx prisma generate

# Ver schema de BD
npx prisma studio

# Instalar componente shadcn
npx shadcn@latest add [nombre-componente]

# Tests
npm test
npm run test:watch

# Lint y format
npm run lint
npm run format

# Deploy (cuando esté configurado en Easypanel)
git push origin main  # auto-deploy configurado
```

---

## Recordatorio final

Este proyecto **NO es un dashboard SEO más**. Es la mitad ejecutiva de un sistema integral de gestión SEO que incluye Cerebro como mitad estratégica. Cuando dudes, pregunta:

> ¿Esto que estoy haciendo refuerza la integración Cerebro ↔ Cerebro SEO, o la rompe?

Si la rompe, probablemente estás resolviendo el problema equivocado.
