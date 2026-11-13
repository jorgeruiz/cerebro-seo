# Sesión F2b — Composición del plan mensual

> Correr después de F2 (paquetes). Requiere que la Fase 1 esté cerrada.

## Contexto
Spec: `docs/plan-mensual/catalogo-v2-spec.md`, sección 9.6 (actualiza el archivo del repo con la versión que te pasa Jorge). Hoy el Análisis Claude propone de 4 a 8 tareas de contenido y de 4 a 8 de código, y un humano elige cuáles mandar al plan. El objetivo de esta sesión es que el plan salga **balanceado**: urgentes primero, mayoría de easy wins, una parte estratégica, mínimos por categoría y respeto a la capacidad humana. **El LLM propone las candidatas; el código decide la mezcla.**

## Parte 1 — Diagnóstico
- ¿Cómo genera hoy candidatas el Análisis Claude? ¿Cuántas por corrida y con qué datos (evidence, métricas)?
- ¿Qué datos hay en la BD para calificar impacto y urgencia: impresiones, posición, CTR y clics por URL/keyword, 404 con tráfico, backlinks a URLs muertas, estado de indexación, hallazgos de seguridad, caídas de tráfico?
- Distribución actual de candidatas por categoría en 3 clientes reales. ¿Hay categorías que el Análisis nunca propone?

## Parte 2 — Implementación
1. **Catálogo:** agregar `humanMinutes` a cada paso HM (estimación inicial razonable, fácil de ajustar) y un campo `impactBasis` por actionType, que indica qué métrica respalda su impacto.
2. **Configuración por cliente** (`ClientPlanConfig`), con valores por defecto si no existe:
   - `maxTasks` (por defecto 10).
   - `mix`: urgentes tope 30%, easy wins 50%, estratégicas 25–30%.
   - `categoryMinimums`: technical 1, content 2, aeo_geo 1; authority_local y measurement_conversion en 0 salvo que apliquen.
   - `categoryWeights`.
   - `humanMinutesCap` (por defecto 240) y `apiCostCapUsd`.
3. **Clasificación por tipo** en `src/lib/plan/plan-composer.ts`, sin LLM:
   - `urgent`, `easy_win` o `strategic`, según las reglas de la sección 9.6.
   - Puntuación = impacto (de `impactBasis` y los datos reales) × confianza del dato ÷ esfuerzo (complejidad + `humanMinutes`).
4. **Algoritmo de selección** (determinístico):
   1. Excluir candidatas con un gate fallido (se listan aparte con su remedio; una candidata `install_package` las puede desbloquear).
   2. Excluir duplicadas: tareas activas, o hechas sobre el mismo target en los últimos 3 meses sin cambio en los datos.
   3. Meter las urgentes por puntuación hasta su tope.
   4. Cumplir los mínimos por categoría con las de mejor puntuación.
   5. Llenar la cuota de easy wins y después la de estratégicas.
   6. Revisar los topes de capacidad humana y de costo: si se pasa, cambiar la tarea con más `humanMinutes` y menor puntuación por la siguiente automática.
   7. Guardar en cada tarea `selectionReason` (tipo, puntuación, dato de respaldo) y en cada excluida `exclusionReason`.
5. **Análisis Claude:** ajustar el prompt para que genere candidatas **en todas las categorías aplicables** (al menos 2 por categoría cuando haya datos), cada una con su evidencia. Si una categoría no tiene datos, dice "sin datos" en lugar de inventar candidatas.
6. **UI de propuesta de plan:**
   - Candidatas seleccionadas, agrupadas por categoría y marcadas con su tipo (urgente / easy win / estratégica), con el "por qué entró" visible.
   - Barras de mezcla real vs objetivo, de minutos humanos vs tope y de costo estimado.
   - El humano puede quitar o agregar candidatas antes de confirmar. Al agregar, avisar si se rompe una cuota o un tope, pero sin bloquear.
   - Lista de excluidas con su razón.
   - Configuración del cliente editable desde la vista del cliente.
7. **Tests:** cada regla de selección por separado; el tope humano provoca el reemplazo; los mínimos de categoría se respetan aunque haya mejores candidatas en otra categoría; las duplicadas se excluyen; las urgentes nunca pasan de su tope; el resultado es determinístico (mismas entradas, mismo plan).

## Fuera de alcance
El cron y la ejecución automática (F4). Aquí el plan sigue confirmándose a mano.

## Cierre
Actualizar `project_state.md`, `architecture.md` y `project_spec.md`. Reportar commits, tests y un ejemplo real: la propuesta de plan de un cliente, con su mezcla, sus minutos humanos y 3 razones de selección y 3 de exclusión.
