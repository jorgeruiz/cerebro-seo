# Sesión F3 — Herramientas de Cerebro SEO para la Oficina

> Antes de correr esta sesión, Jorge define: el stack de la Oficina, si su agente puede consumir un servidor MCP o solo HTTP, y dónde corre. Ajusta la sección 1 con esas respuestas.

## Contexto
Spec: `docs/plan-mensual/catalogo-v2-spec.md`, secciones 9.3 y 9.4. La Oficina es solo la interfaz de conversación con los agentes. **Cerebro SEO es dueño del catálogo, los datos, la ejecución y el estado.** Esta sesión expone las capacidades de Cerebro SEO como herramientas. No se construye nada dentro de la Oficina.

## 1. Transporte
- [Ajustar según la respuesta de Jorge] Servidor MCP (HTTP streamable) en Cerebro SEO **o** API REST M2M bajo `/api/agent/*`. Si es MCP, que use la misma capa de servicios que la API, para no duplicar lógica.
- Autenticación M2M con un secreto dedicado (nombre de variable, p. ej. `OFICINA_AGENT_SECRET`; nunca imprimir valores). Cada llamada registra el agente que la hace.

## 2. Herramientas
| Herramienta | Qué hace | Notas |
|---|---|---|
| `listar_clientes` | Clientes activos con su sitio y plataforma | Solo activos con SEO |
| `estado_sitio` | Paquetes, gates, plan actual, salud | Solo lectura |
| `catalogo` | actionTypes y paquetes disponibles, con su descripción | Para que el agente sepa qué puede pedir |
| `ver_plan` | Tareas del mes con su estado | |
| `crear_tarea` | Crea una `PlanTask` con `sourceRef.module = "oficina"` | **Pasa por el clasificador de F1b.** Devuelve la clasificación, el estado y, si queda `NEEDS_DEFINITION` o `NEEDS_INPUT`, qué falta |
| `resolver_tarea` | Reclasificar, aportar inputs, dividir o anular | Registra un `ClassificationEvent` con actor = agente |
| `aprobar_paso` | Completa un paso HM `review` | Solo `review`; nunca `wp_manual` ni `external_tool` |
| `instalar_paquete` | Atajo: `crear_tarea` con `install_package` | Mismo flujo |

**No existe ninguna herramienta para ejecutar directo, editar el repo o llamar al plugin.** Todo pasa por `PlanTask`, el worker, los locks y la bitácora.

## 3. Seguridad y límites
- Cliente A nunca ve datos de cliente B: cada herramienta valida el `clientId`.
- Rate limit por agente.
- Las herramientas de escritura respetan el nivel de autonomía cuando exista (F4); por ahora, todo lo que se crea queda pendiente de ejecución manual.

## 4. Tests
Unit por herramienta; auth rechazada; una orden ambigua termina en `NEEDS_DEFINITION`; una orden que pide ejecutar algo directo se convierte en una tarea, no en una ejecución.

## Cierre
Actualizar `project_state.md`, `architecture.md`, `project_spec.md` e `integration_cerebro.md` (o un doc nuevo `integration_oficina.md` con el contrato de herramientas). Reportar commits y tests, con un ejemplo de llamada a cada herramienta sin secretos.
