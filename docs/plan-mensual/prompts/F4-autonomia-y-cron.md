# Sesión F4 — Niveles de autonomía + cron mensual

> Correr cuando F1–F2 estén estables en producción.

## Contexto
Spec: `docs/plan-mensual/catalogo-v2-spec.md`, sección 9.5. Jorge quiere probar primero en manual y después pasar a automático sin rehacer nada. El cron vive en Cerebro SEO (job repetible de BullMQ, como el de InsightsAgent). **No usar GitHub Actions ni Vercel cron.**

## 1. Schema
- `Site.autonomyLevel Int @default(0)` (0–3).
- `ActionTypeAutonomy(siteId, actionType, levelOverride Int?, consecutiveSuccesses Int, lastCorrectionAt, lastFailureAt)`.
- Definición de "corrección humana" (reinicia `consecutiveSuccesses`): reintento, edición en la terminal ligada a la tarea, anulación después de ejecutar, reclasificación o un paso `review` rechazado.

## 2. Reglas
| Nivel | Comportamiento |
|---|---|
| 0 | Nada automático (estado actual). |
| 1 | El cron del día 1 genera el plan (Análisis Claude → tareas clasificadas) en estado `PLANNING`; un humano lo activa. |
| 2 | Además, ejecuta solas las tareas de riesgo `low` sin pasos HM pendientes. |
| 3 | Además, las de riesgo `medium`. Las de riesgo `high` **siempre** esperan un `review`. |

- El nivel efectivo de una tarea es el mínimo entre `Site.autonomyLevel` y el nivel del actionType.
- Promoción sugerida: con 5 éxitos seguidos, el actionType se *propone* para subir de nivel (notificación). **No sube solo**; lo aprueba un humano.
- Degradación automática: un fallo o una corrección baja el actionType un nivel.
- **Kill switch global** (variable de entorno o flag en `/settings`) que pone todo en nivel 0.

## 3. Cron
- Job repetible de BullMQ: día 1, 07:30 America/Monterrey, para sitios con nivel ≥ 1. Concurrency 1. Es idempotente: si ya existe el plan del mes, no lo duplica.
- Un job diario procesa las tareas elegibles para ejecución automática según el nivel, respetando los locks y el semáforo de build.
- Registrar todo en la bitácora del plan. Notificar en la UI (y por correo si ya hay un canal) cuando un plan se genera, cuando algo queda `BLOCKED` o `NEEDS_DEFINITION`, y cuando el plan llega al 100%.

## 4. UI
- Selector de nivel por sitio en la configuración del cliente.
- Tabla por actionType: nivel, racha, última corrección y botón "promover".
- Kill switch en `/settings`.

## 5. Tests
Nivel efectivo; promoción y degradación; idempotencia del cron; el kill switch detiene la ejecución; las tareas de riesgo high nunca se ejecutan sin `review`.

## Cierre
Actualizar `project_state.md`, `architecture.md` y `project_spec.md`. Reportar commits y tests, y dejar 1–2 clientes de prueba en nivel 1.
