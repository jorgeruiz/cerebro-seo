# Cerebro SEO ↔ Cerebro — Integration

> Cómo Cerebro y Cerebro SEO se comportan como una sola persona: la que reporta, asigna, ejecuta y mide.

**Última actualización:** 2026-05-07 (v2)

---

## 1. Filosofía de la integración

Cerebro y Cerebro SEO son dos aplicaciones independientes pero acopladas funcionalmente:

- **Cerebro** es la capa de **pensamiento**: chat con el equipo, planeación, decisiones, generación de reportes y estrategias.
- **Cerebro SEO** es la capa de **ejecución y observación**: dashboards, métricas en tiempo real, tracking de tareas y hipótesis.

Para Jorge y el equipo, deben sentirse como **una sola herramienta con dos interfaces**.

---

## 2. Flujo operativo central (mes a mes)

```
DÍA 1 DEL MES                                    DÍA 30 DEL MES
─────────────                                    ─────────────

[Cerebro genera reporte mensual del cliente]
        │
        ▼
[Cerebro propone actividades del nuevo mes]
        │
        ▼
[Jorge/Félix conversan estrategia con Cerebro]
        │
        ▼
[Cerebro guarda Estrategia + Tareas en Notion]
        │
        ▼
[Cerebro SEO sincroniza tareas del mes]
        │
        ▼
[Panel del cliente muestra checklist + métricas]
        │
        ▼
[Equipo ejecuta tareas, marcando en Notion o Cerebro SEO]
        │
        ▼
[Cerebro SEO trackea métricas, genera insights]
        │
        ▼
[Día 30: Cerebro SEO valida hipótesis, dispara cierre]
        │
        ▼
[Cerebro genera reporte mes con resultados medidos]
```

---

## 3. Datos compartidos

### 3.1 Datos que viven en Cerebro (source of truth)
- Información del cliente (Notion: Clientes Actuales)
- Bitácora de actividades (Notion: Bitácora)
- Estrategia mensual (Notion: Estrategia Mensual)
- Tareas (Notion: Tareas)
- Métricas mensuales agregadas (Notion: Métricas Mensuales)
- Conversaciones del chat (Cerebro DB)

### 3.2 Datos que viven en Cerebro SEO (source of truth)
- Rankings históricos de keywords
- Auditorías técnicas y sus issues
- Backlinks crawleados
- Métricas de PageSpeed/Core Web Vitals
- Insights generados automáticamente
- Hipótesis y su validación
- Eventos del timeline
- AI Search Visibility data
- ApiUsage (costos)

### 3.3 Datos compartidos (lectura cruzada)
- **Cliente:** Cerebro SEO mantiene su propia tabla `Client` con un campo `cerebroClientId` que referencia al cliente en Cerebro/Notion. Datos críticos sincronizados.
- **Tareas activas del mes:** Cerebro SEO lee desde Cerebro (que a su vez lee de Notion).
- **Estrategia del mes:** Cerebro SEO muestra como contexto, no la edita.

---

## 4. Mecanismos de comunicación

### 4.1 Sync de clientes (Notion → Cerebro SEO)
**Frecuencia:** Cada 6 horas vía job programado (`sync:cerebro`), o on-demand (`scripts/seed-clients.ts`).
**Mecanismo:** Lectura directa a Notion API (BD "Clientes Actuales") via `src/lib/notion-direct.ts`.

**Filtro de Estado (lista blanca):**
- Solo importa clientes con `Estado ∈ {Activo, En Pausa}`.
- Cancelado, Proyecto, Consultoría y cualquier otro valor NO pasan.
- Es lista BLANCA (solo pasa lo permitido), NO lista negra — si agregan un estado nuevo en Notion, no se cuela.

**Upsert por cerebroClientId:**
- `cerebroClientId` = Notion page ID (sin dashes). Campo `@unique` en modelo Client.
- Si el cliente ya existe → actualiza name, domain, status, services. NO toca gscProperty/ga4Property (configuración local de Cerebro SEO).
- Si no existe → crea Client + Site asociado.

**Ocultamiento al salir del filtro:**
- Clientes locales cuyo `cerebroClientId` ya no aparece en el sync → `status: PAUSED` (ocultos de todas las vistas y workers).
- NO se borran — el historial (insights, rankings, etc.) se preserva.
- Si el cliente se reactiva en Notion (vuelve a Activo/En Pausa), el siguiente sync lo restaura automáticamente.

**Guard contra falsos negativos:**
- Si Notion devuelve 0 clientes (posible error de API), el sync se salta sin desactivar nadie.

### 4.2 Sync de tareas (Cerebro → Cerebro SEO)
**Frecuencia:** Cada 15 minutos.
**Mecanismo:**
```
GET /api/internal/seo/clients/:id/tasks/active
GET /api/internal/seo/clients/:id/strategy/current
```

Cerebro SEO crea/actualiza `Task` y `MonthlyCycle` localmente.

### 4.3 Métricas y resultados (Cerebro SEO → Cerebro)
**Cuándo:** On-demand cuando Cerebro está generando un reporte.
**Mecanismo:**
```
GET /api/internal/cerebro/clients/:id/monthly-summary?yearMonth=2026-04
Authorization: Bearer ${SEO_INTERNAL_SECRET}

Response:
{
  "yearMonth": "2026-04",
  "metrics": {
    "organicTraffic": { "current": 1200, "previous": 980, "delta": 22.4 },
    "avgPosition": { "current": 18.3, "previous": 21.5, "delta": -14.9 },
    "impressions": { ... },
    "ctr": { ... },
    "conversions": { ... }
  },
  "topWins": [...],
  "topLosses": [...],
  "hypothesesResults": {
    "validated": 4,
    "refuted": 1,
    "pending": 2,
    "details": [...]
  },
  "tasksCompleted": [...],
  "criticalIssues": [...]
}
```

Cerebro usa este JSON para generar el reporte mensual y la propuesta del nuevo mes.

### 4.4 Webhooks (eventos en tiempo real)

**Cerebro SEO → Cerebro** cuando ocurre algo crítico:
```
POST {cerebro_url}/api/internal/webhooks/seo-event
{
  "type": "critical_drop" | "new_opportunity" | "hypothesis_validated" | "audit_complete",
  "clientId": "...",
  "data": { ... }
}
```

Cerebro puede notificar al equipo en chat o disparar acciones.

---

## 5. Auth entre servicios

- **Shared secret rotable** vía variables de entorno (`CEREBRO_INTERNAL_SECRET`, `SEO_INTERNAL_SECRET`).
- Header: `Authorization: Bearer ${secret}`.
- Validar IP de origen (ambos en mismo VPS Easypanel, IP interna).
- Logging de cada request entre servicios para auditoría.

**Futuro (cuando haya más de 2 servicios):** considerar JWT con shared key o servicio de auth interno tipo OAuth2 client credentials.

---

## 6. Branding y experiencia visual

Cerebro SEO debe sentirse como una extensión natural de Cerebro:

- **Mismo gradiente principal:** `#6366f1 → #3b82f6 → #ec4899`
- **Misma tipografía y espaciado**
- **Mismo sistema de componentes** (shadcn/ui con tokens compartidos)
- **Logo "Cerebro SEO"** derivado del logo de Cerebro (a diseñar)
- **Navegación cruzada:** botón en header de cada app que lleva a la otra ("Ir a Cerebro" / "Ir a Cerebro SEO")
- **Single Sign-On efectivo:** si estás logueado en Cerebro, al ir a Cerebro SEO entras directo (mismo NextAuth provider, misma sesión).

---

## 7. Casos de uso integrados (ejemplos concretos)

### Caso 1: Reporte mensual con datos reales
1. Día 1 del mes: Jorge entra a Cerebro y dice: "Genera el reporte de abril del cliente Quicsa".
2. Cerebro llama a Cerebro SEO: `GET /api/internal/cerebro/clients/quicsa/monthly-summary?yearMonth=2026-04`.
3. Cerebro recibe métricas, hipótesis validadas, insights del mes.
4. Cerebro lee también de Notion: bitácora del mes, tareas completadas.
5. Cerebro genera reporte estructurado en chat + lo guarda en Notion (Métricas Mensuales).
6. Cerebro propone estrategia del nuevo mes basándose en patrones.

### Caso 2: Tarea con hipótesis
1. Jorge en chat con Cerebro: "Vamos a crear contenido sobre 'instalación filtros industriales' para Quicsa, esa keyword tiene buen volumen y estamos en posición 15".
2. Cerebro pregunta: "¿Qué resultado esperas y en cuánto tiempo?"
3. Jorge: "Subir a top 5 en 90 días".
4. Cerebro guarda en Notion: tarea + descripción + URL afectada futura.
5. Cerebro SEO sincroniza, crea `Task` + `Hypothesis` con baseline de la keyword (posición 15 al momento).
6. Durante 90 días, Cerebro SEO trackea posición de esa keyword.
7. A los 90 días: si está en top 5 → hipótesis validada. Si no → refutada con datos.
8. En el reporte mensual aparece como "validada" o "refutada con razones".

### Caso 3: Insight proactivo
1. Cerebro SEO detecta: "Quicsa cayó de posición 4 a 11 en 'tratamiento agua industrial' en 7 días".
2. Crea `Insight` tipo `WARNING` severity `HIGH`.
3. Webhook a Cerebro: notifica en chat de equipo.
4. Cerebro genera mensaje proactivo en el chat: "Atención, Quicsa perdió 7 posiciones en su keyword principal. Posibles causas:..." (analiza con Claude).
5. Equipo decide acción → nueva tarea con hipótesis → de vuelta al ciclo.

---

## 8. Arquitectura preferida vs alternativas

### ✅ Decisión tomada (07-may-2026): REST API entre servicios

**Pros:** desacoplamiento claro, fácil de evolucionar, posibilidad de mover servicios a infraestructura distinta.
**Contras:** latencia mayor, duplicación de algunos datos.

Alternativas evaluadas y descartadas:
- **Prisma multi-schema**: acoplamiento fuerte, riesgo en migraciones, difícil separar infraestructura a futuro.
- **Redis Pub/Sub**: más complejo, requiere idempotencia cuidadosa, debugging más difícil para el equipo actual.

**Patrón adoptado:** REST API con shared secret + webhooks para eventos críticos. Migrar a Pub/Sub solo si la latencia se convierte en problema real y medido.

---

## 9. Decisiones pendientes

1. ¿Single Sign-On real (sesión compartida vía cookie/JWT en dominio padre `clicksociety.mx`) o login separado con mismas credenciales? *Pendiente — resolver antes de Fase 5.*
3. ¿Las conversaciones del chat de Cerebro deben quedar visibles en Cerebro SEO (timeline del cliente)? *Pendiente — evaluar en Fase 3 al construir el módulo de Eventos.*

**Decisiones ya tomadas de esta sección:**
- ✅ **Cerebro SEO solo lee de Notion.** Las escrituras pasan siempre por Cerebro (regla en `CLAUDE.md`).
- ✅ **Notion es source of truth del cliente como entidad de negocio.** Cerebro SEO mantiene su propia copia sincronizada con datos SEO-específicos. Campo `cerebroClientId` en modelo `Client` referencia al cliente en Notion/Cerebro.
