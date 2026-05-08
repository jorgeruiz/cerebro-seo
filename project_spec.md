# Cerebro SEO — Project Spec

**Owner:** Jorge Ruiz (Click Society)
**Estado:** Fase 1 en curso
**Última actualización:** 2026-05-07 (v2)

---

## 1. Visión

Cerebro SEO es una aplicación SEO white-label para Click Society que sustituye herramientas externas (SEMrush, Ahrefs, Ubersuggest) y se integra de forma nativa con Cerebro para convertir el trabajo SEO en un ciclo operativo medible: estrategia → tareas → ejecución → resultados.

A diferencia de las herramientas comerciales que solo muestran métricas, Cerebro SEO **da seguimiento a la estrategia**: cada actividad ejecutada se vincula con su impacto medible, y cada mes el sistema valida hipótesis, propone nuevas y cierra el ciclo.

**Propuesta de valor para clientes:** transparencia total del trabajo SEO en un panel branded de Click Society, con métricas en tiempo real y reporte mensual auto-generado.

**Propuesta de valor interna:** Félix (responsable SEO) trabaja desde una sola interfaz que centraliza datos, tareas y análisis. Reduce horas de reporting manual.

---

## 2. Filosofía de producto

1. **Estrategia primero, métricas después.** El panel se organiza alrededor del ciclo mensual del cliente, no alrededor de las herramientas.
2. **Cada acción es una hipótesis.** Toda tarea declara qué resultado espera producir y en cuánto tiempo. Al cierre del mes se valida.
3. **Cerebro es el cerebro.** Cerebro SEO es la interfaz visual; Cerebro (chat) es donde se piensa, decide y planea. La integración es bidireccional y profunda.
4. **El cliente ve lo mismo que el equipo, sin jerga.** Misma data, vista limpia, sin notas internas, exportable a PDF.
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

## 5. Roles y permisos

| Rol | Acceso | Notas |
|---|---|---|
| ADMIN (Jorge) | Todo. Configura clientes, ve costos de API, gestiona equipo. | Google OAuth |
| EDITOR (Félix, Cindy) | Todos los clientes asignados. Sin visibilidad de costos. | Google OAuth |
| CLIENT | Solo su propia cuenta. Vista limpia, sin jerga, sin notas internas. | Magic link, sin password |

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
| Equipo con Google OAuth, clientes con magic link | ✅ Decidido | Sin password para nadie |
| Sync de clientes con Cerebro | ✅ Decidido | REST interno con shared secret |
| Frecuencia de tracking | ✅ Decidido | Diario top 10 keywords (`isPriority`), semanal resto |
| Vista cliente en v1 | ✅ Decidido | Implementada en Fase 5 |
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
- ❌ Setup git + Docker + primera migración
- ❌ Provider layer DataForSEO (interface + DataForSeoProvider)
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

**Fase 3 — Competencia + Backlinks + Eventos**
- Módulo Análisis de competencia (share of voice, keyword gaps)
- Módulo Backlinks (nuevos/perdidos, DA)
- Módulo Eventos / Timeline
- RankTrackingAgent, BacklinksAgent, CompetitorAgent activados

**Fase 4 — IA y diferenciadores**
- Módulo AI Search Visibility (ChatGPT, Perplexity, Gemini)
- Módulo Keyword ideas
- Módulo SEO Opportunities
- Reporte mensual auto-generado (ReportAgent + PDF)
- CycleCloseAgent: cierre automático de ciclo y validación de hipótesis

**Fase 5 — Vista cliente**
- Magic links para acceso de clientes finales
- Vista limpia sin jerga interna
- Export PDF del dashboard
- Personalización de branding por cliente

**Total estimado:** 10-12 semanas trabajando en paralelo a operación normal.

---

## 10. Costos operativos estimados

**10 clientes SEO activos:**

| Servicio | Uso mensual | Costo |
|---|---|---|
| DataForSEO – SERP tracking | ~2,000 reqs | ~$1.20 |
| DataForSEO – Backlinks/competencia | ~10 dominios | ~$10–15 |
| DataForSEO – Site audits | ~1,000 reqs | ~$5 |
| DataForSEO – Keyword research | ~200 lookups | ~$3–5 |
| PageSpeed Insights | Free tier | $0 |
| Search Console + GA4 | Free | $0 |
| Claude API (insights diarios + reportes + cierre) | ~310 operaciones | ~$9–12 |
| Hosting Easypanel | Ya pagado | $0 |
| **Total** | | **~$28–37 USD/mes** |

Escala lineal: 30 clientes ≈ $84–111 USD/mes.

---

## 11. Decisiones abiertas

1. **Single Sign-On real** entre Cerebro y Cerebro SEO: ¿cookie compartida en dominio padre `clicksociety.mx`, o login separado con mismas credenciales? *Resolver antes de Fase 5.*
2. **AI Search Visibility provider:** DataForSEO LLM APIs vs Profound vs stack propio. *Resolver en Fase 4.*

---

## 12. Próximo paso concreto

Completar los pendientes de **Fase 1**:
1. `git init` local → `.gitignore` → primer commit → push a `jorgeruiz/cerebro-seo`
2. `docker-compose.yml` con PostgreSQL 16 + Redis 7 para dev local
3. Llenar `.env` local con credenciales reales (DataForSEO ya disponibles)
4. `npx prisma migrate dev --name init`
5. Implementar `DataForSeoProvider` + validar calidad datos vs GSC (3 clientes × 5 keywords)
6. Conectar GSC y GA4 con OAuth + datos reales en portada
7. Deploy en Easypanel + DNS para `seo.clicksociety.mx`
