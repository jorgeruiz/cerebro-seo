# Cerebro SEO — Project Spec

**Owner:** Jorge Ruiz (Click Society)
**Estado:** Fase 1 en curso (BD funcionando, GSC/GA4 pendiente)
**Última actualización:** 2026-05-10 (v3)

---

## 1. Visión

Cerebro SEO es una aplicación SEO **100% interna** para Click Society que sustituye herramientas externas (SEMrush, Ahrefs, Ubersuggest) y se integra de forma nativa con Cerebro para convertir el trabajo SEO en un ciclo operativo medible: estrategia → tareas → ejecución → resultados.

**Tesis del producto:** Cerebro SEO no compite en métricas SEO crudas — compite en CONTEXTO. Cruza datos SEO (DataForSEO, GSC, GA4) con Notion (clientes, tareas, estrategia, bitácora) y Cerebro web (análisis, conversaciones, hipótesis) en una sola pantalla por cliente.

A diferencia de las herramientas comerciales que solo muestran métricas, Cerebro SEO **da seguimiento a la estrategia**: cada actividad ejecutada se vincula con su impacto medible, y cada mes el sistema valida hipótesis, propone nuevas y cierra el ciclo.

**Propuesta de valor interna:** el equipo (Félix, Cindy, Jorge) trabaja desde una sola interfaz que centraliza datos, tareas y análisis. Reduce horas de reporting manual. No hay portal para clientes finales en v1.

---

## 2. Filosofía de producto

1. **Estrategia primero, métricas después.** El panel se organiza alrededor del ciclo mensual del cliente, no alrededor de las herramientas.
2. **Cada acción es una hipótesis.** Toda tarea declara qué resultado espera producir y en cuánto tiempo. Al cierre del mes se valida.
3. **Cerebro es el cerebro.** Cerebro SEO es la interfaz visual; Cerebro (chat) es donde se piensa, decide y planea. La integración es bidireccional y profunda.
4. **El reporte mensual es el entregable al cliente.** PDF auto-generado, limpio, sin jerga, brandeado Click Society. La interfaz de Cerebro SEO es interna — el cliente no accede al panel.
5. **Pago por uso, no suscripción.** Stack de proveedores externos elegido para escalar linealmente con clientes (DataForSEO).

---

## 3. Flujo operativo (caso de uso central)

Este es el flujo que define la arquitectura completa:

1. **Generación del reporte mensual en Cerebro.** Al cierre de mes, Cerebro ejecuta análisis sobre las métricas del cliente (GSC, GA4, rankings, backlinks).
2. **Análisis automático y propuesta de actividades.** Cerebro lee el historial de estrategias, identifica qué funcionó y qué no, y propone actividades del nuevo mes.
3. **Conversación estratégica en chat.** Jorge/Félix dialogan con Cerebro, refinan estrategia, capturan decisiones.
4. **Captura en Notion.** La estrategia y las tareas se guardan en las bases de Notion existentes (Estrategia Mensual, Tareas).
5. **Seguimiento en Cerebro SEO.** El panel del cliente lee las tareas activas del mes, las muestra como checklist, y vincula cada una con las métricas que debería mover.
6. **Cierre del mes.** Sistema automático valida hipótesis, marca tareas validadas/refutadas/pendientes, y dispara la generación del reporte del siguiente ciclo.

**Cerebro y Cerebro SEO se comportan como una sola persona:** la que reportó, asignó tareas, ejecuta y mide.

---

## 4. Módulos del producto

### 4.1 Vista de listado de clientes
- Grid de clientes SEO activos.
- Indicadores rápidos: estado del ciclo mensual, tareas pendientes, alertas críticas.
- Filtros por estado, por responsable interno, por plan SEO.

### 4.2 Wizard de alta de cliente
- Formulario guiado para capturar datos iniciales del cliente:
  - Datos básicos (nombre, dominio, plan, color de marca)
  - Dominios y propiedades de GSC/GA4 a conectar
  - Keywords objetivo iniciales (top 10 marcan `isPriority: true` para tracking diario)
  - Competidores definidos (máximo 5)
- La estrategia inicial **no se captura aquí**: se genera por conversación con Cerebro tras el alta.

### 4.3 Panel del cliente (vista detalle)
La vista central del producto. Estructura jerárquica:

**Sección portada (sin scroll, lo más importante):**
- Gráfica principal de líneas con métricas filtrables: tráfico orgánico, sesiones, rebote, conversiones, posición promedio, impresiones, CTR. Datos combinados de GSC + GA4.
- Rangos de tiempo: 7d, 28d, 90d, 12m, custom.

**Sección snapshot (KPIs):**
- Domain Authority (vía DataForSEO Domain Rank)
- Score de calidad del sitio (calculado por nuestro auditor)
- Posición promedio actual
- Comparativa vs mes anterior

**Sección operativa del mes:**
- Pendientes del mes con checklist (sincronizado con Notion).
- Análisis breve de actividades realizadas y resultados (generado por Claude leyendo datos del ciclo).
- Indicador del estado del ciclo mensual.

**Sección de módulos (tarjetas estilo GA4):**

| Módulo | Función |
|---|---|
| Términos de búsqueda | Queries de GSC con clics, impresiones, CTR, posición. Filtros por dispositivo/país. |
| AI Search Visibility | Tracking de presencia en respuestas de ChatGPT, Perplexity, Google AI Overviews, Claude. |
| SEO Opportunities | Lista priorizada de mejoras detectadas automáticamente. |
| Keyword ideas | Investigación de keywords nuevas con volumen, dificultad, intent. |
| Tráfico de páginas | Performance por URL: tráfico orgánico, conversiones, tendencias. |
| Eventos | Timeline de cambios, updates de algoritmo, acciones SEO ejecutadas. |
| Site Audit | Auditoría técnica on-site (crawler propio + Core Web Vitals). |
| Análisis de competencia | Comparativa de rankings, share of voice, gap de keywords. |
| Backlinks | Perfil de enlaces, nuevos/perdidos, comparativa vs competidores. |

---

## 5. Roles, permisos y modelo de servicios

### 5.1 Roles y acceso

| Rol | Acceso | Notas |
|---|---|---|
| ADMIN (Jorge) | Todo. Ve **todos** los clientes activos sin filtrar por asignación. Configura clientes, ve costos de API, gestiona equipo. | Google OAuth |
| EDITOR (Félix, Cindy) | Solo los clientes que tenga asignados vía `ClientUser.email`. Sin visibilidad de costos. Acceso a cliente no asignado devuelve 404 (no 403 — no revelar existencia). | Google OAuth |

> La asignación EDITOR ↔ Cliente se gestiona en la tabla `ClientUser` por email (no por userId). No hay UI de asignación en v1 — se hace directamente en BD o via seed.
> `CLIENT` existe en el enum del schema pero no se usa en v1. La herramienta es 100% interna — no hay portal para clientes finales.

### 5.2 Modelo de servicios por cliente

El campo `services String[]` en `Client` determina qué módulos y jobs se activan para cada cliente. Valores normalizados:

| Slug | Servicio | Fuente Notion |
|---|---|---|
| `seo` | SEO orgánico | "SEO" en campo multi_select "Servicio" |
| `google_ads` | Google Ads | "Google Ads" |
| `meta_ads` | Meta Ads | "Meta Ads" |
| `contenidos` | Marketing de contenidos | "Contenidos" |

**Impacto en el sistema:**
- **Vista `/clientes`:** filtro default muestra solo clientes con `services.has("seo")`. Toggle "Todos los activos" muestra los 42.
- **Vista `/clientes/[id]`:** módulos SEO (AI Search Visibility, SEO Opportunities, Keyword Ideas, Competencia, Backlinks) muestran lock icon con tooltip para clientes sin `"seo"` en services.
- **BullMQ schedulers:** jobs de costo variable (ranking tracking, insights, backlinks, competitors, ai-search) **solo** se encolan para clientes con `services.includes("seo")`. Audit y sync aplican a todos los activos.

> Distribución real (2026-05-14): ~12 clientes con `seo`, ~38 con `google_ads`, ~8 con `meta_ads`, ~6 con `contenidos`. El seed lee el campo "Servicio" (multi_select) desde Notion via `notion-direct.ts`.

---

## 6. Conceptos clave del modelo de negocio SEO

### 6.1 Ciclo mensual SEO
Entidad de primera clase. Un `MonthlyCycle` por cliente por mes, con estados:
- `PLANNING` — Reporte del mes anterior generado, estrategia del nuevo mes en discusión.
- `ACTIVE` — Tareas en ejecución, métricas siendo trackeadas.
- `CLOSING` — Mes terminó, sistema validando hipótesis.
- `CLOSED` — Reporte final generado, ciclo siguiente iniciado.

### 6.2 Hipótesis verificables
Cada tarea importante declara:
- **Qué cambia** ("Optimizar título de /servicios")
- **Qué espera mover** ("Subir 3 posiciones en keyword X")
- **En cuánto tiempo** ("60 días")
- **URLs/keywords afectadas** (para tracking automático)

Al cierre del ciclo, el sistema marca: `VALIDATED` / `REFUTED` / `PARTIAL` / `PENDING`.

### 6.3 Insights proactivos
Cards automáticas generadas por Claude (InsightsAgent, diario) analizando datos en background. Ejemplos:
- "Tu página /servicios cayó de posición 4 a 8 en los últimos 7 días — posible canibalización con /productos."
- "La keyword 'instalación de filtros industriales' subió a top 3 — oportunidad de optimizar CTR (actualmente 1.2%)."
- "Tres backlinks de alta autoridad perdidos esta semana — revisar."

### 6.4 Reporte mensual auto-generado
PDF brandeado Click Society. Estructura:
1. Resumen ejecutivo (1 página, generado por Claude Haiku 4.5)
2. Trabajo realizado (tareas cerradas con su impacto medido)
3. Resultados vs hipótesis
4. Estrategia del próximo mes
5. Anexos con métricas detalladas

---

## 7. Decisiones tomadas

| Decisión | Estado | Notas |
|---|---|---|
| App separada de Cerebro (hermana, no hija) | ✅ Decidido | Repos, BD y deploy independientes. |
| Subdominio: `seo.clicksociety.mx` | ✅ Decidido | |
| Stack: Next.js 14 + Prisma + PostgreSQL + NextAuth | ✅ Decidido | Mismo stack que Cerebro |
| Deploy en Easypanel VPS | ✅ Decidido | Proyecto separado en el mismo VPS |
| Provider de datos SEO: **DataForSEO** | ✅ Decidido | Pay-per-use, escala lineal |
| Provider abstraído (provider layer) | ✅ Decidido | Interface `SeoDataProvider` |
| Solo Google OAuth (equipo interno) | ✅ Decidido | Sin magic link, sin portal cliente en v1 |
| Sync de clientes con Cerebro | ✅ Decidido | REST interno con shared secret |
| Frecuencia de tracking | ✅ Decidido | Diario top 10 keywords (`isPriority`), semanal resto |
| Vista cliente en v1 | ❌ Eliminado | Herramienta 100% interna. Reabrír debate si se necesita en el futuro. |
| Multi-tenant | ✅ Decidido | Solo Click Society en v1; refactorizar si se comercializa |

---

## 8. Comparación con el mercado

| Feature | SEMrush | Ahrefs | Ubersuggest | Cerebro SEO |
|---|---|---|---|---|
| Datos SEO completos | ✅ | ✅ | ⚠️ Limitado | ✅ (vía DataForSEO) |
| Dashboard branded para cliente | ❌ Add-on caro | ❌ Add-on caro | ❌ | ✅ Nativo |
| Integración con estrategia/tareas | ❌ | ❌ | ❌ | ✅ Nativo |
| Hipótesis verificables | ❌ | ❌ | ❌ | ✅ Diferenciador |
| AI Search Visibility | ⚠️ Beta | ⚠️ Beta | ❌ | ✅ v1 |
| Reporte mensual auto-generado | ⚠️ Manual | ⚠️ Manual | ❌ | ✅ Automático |
| Costo (10 clientes) | ~$500 USD/mes | ~$200 USD/mes | $99/mes con techo | ~$30-50 USD/mes |

---

## 9. Roadmap por fases

> El **sistema de multiagentes** (BullMQ queues, workers, InsightsAgent) es **infraestructura transversal**, no una fase. Ya está construido. Los agentes se activan conforme cada fase provee datos reales.

**Fase 1 — Foundation (en curso)**
Setup completo + datos reales iniciales + deploy.
- ✅ Next.js, Prisma schema, auth, layout, branding
- ✅ Sistema de multiagentes (infraestructura)
- ✅ Listado de clientes, wizard de alta, vista detalle con gráfica
- ✅ Setup git + OrbStack + primera migración (21 tablas)
- ✅ Provider layer DataForSEO (interface + DataForSeoProvider, 4 métodos reales)
- ✅ BD local funcionando — ApiUsage poblada con 15 rows de validación
- ❌ Conexión GSC + GA4 con datos reales
- ❌ Deploy inicial en Easypanel + subdominio `seo.clicksociety.mx`

**Fase 2 — Datos reales fluyendo**
GSC/GA4 en portada, primer audit, sync con Notion, InsightsAgent con datos reales.
- Módulo Términos de búsqueda (GSC)
- Módulo Tráfico de páginas (GA4 + GSC)
- Primer site audit técnico (crawler + PageSpeed Insights)
- Sync con Notion: tareas y estrategia del mes en panel
- InsightsAgent corriendo primer ciclo completo con datos reales
- tRPC routers: `clientesRouter`, `ciclosRouter`, `insightsRouter`

**Fase 3 — Módulos SEO + Análisis on-demand de Claude**
- Módulo Análisis de competencia (share of voice, keyword gaps)
- Módulo Backlinks (nuevos/perdidos, DA)
- Módulo Eventos / Timeline (con cruce de tareas y conversaciones de Cerebro)
- **Análisis on-demand de Claude**: botón en panel que abre análisis pre-cargado con TODO el contexto del cliente (estrategia, tareas, métricas, conversaciones recientes). NO es chat full-featured.
- RankTrackingAgent, BacklinksAgent, CompetitorAgent activados

**Fase 4 — IA y reportes**
- Módulo AI Search Visibility (ChatGPT, Perplexity, Gemini)
- Módulo Keyword ideas
- Módulo SEO Opportunities
- Reporte mensual auto-generado (ReportAgent + PDF)
- CycleCloseAgent: cierre automático de ciclo y validación de hipótesis

**Total estimado:** 8-10 semanas trabajando en paralelo a operación normal.

---

## 10. Costos operativos estimados

**10 clientes SEO activos:**

| Servicio | Uso mensual | Costo |
|---|---|---|
| DataForSEO – SERP tracking (Standard Queue, depth 30) | ~2,000 reqs | ~$3.90 |
| DataForSEO – Backlinks/competencia | ~10 dominios | ~$10–15 |
| DataForSEO – Site audits | ~1,000 reqs | ~$5 |
| DataForSEO – Keyword research | ~200 lookups | ~$3–5 |
| PageSpeed Insights | Free tier | $0 |
| Search Console + GA4 | Free | $0 |
| Claude API (insights diarios + reportes + cierre) | ~310 operaciones | ~$9–12 |
| Hosting Easypanel | Ya pagado | $0 |
| **Total** | | **~$35–50 USD/mes** |

Escala lineal: 30 clientes ≈ $105–150 USD/mes.

> **Nota costos DataForSEO (actualizada 2026-05-10):** el precio base $0.002/query es para depth:10. depth:100 cuesta $0.0155/query. Para producción se usará Standard Queue + depth:30 (~$0.00195/req), que es el escenario de la tabla.

---

## 11. Decisiones abiertas

1. **Single Sign-On real** entre Cerebro y Cerebro SEO: ¿cookie compartida en dominio padre `clicksociety.mx`, o login separado con mismas credenciales? *Resolver antes de Fase 2 en producción.*
2. **AI Search Visibility provider:** DataForSEO LLM APIs vs Profound vs stack propio. *Resolver en Fase 4.*
3. **Profundidad SERP en producción:** depth:10 ($0.0006/req) vs depth:30 ($0.00195/req estimado) para tracking masivo con Standard Queue. *Decidir al implementar RankTrackingAgent en Fase 2.*

---

## 12. Próximo paso concreto

Completar los pendientes de **Fase 1** (Sesión 5):
1. Comparar `validation-report.md` contra GSC de Molino Azteca, RFN y Quicsa
2. Implementar conexión GSC con datos reales en portada del cliente
3. Implementar conexión GA4 con métricas reales en portada
4. Deploy inicial en Easypanel + DNS `seo.clicksociety.mx`
