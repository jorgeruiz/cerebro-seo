# Sesión F1c — Decomposer acotado + gates + evaluación

## Contexto
F1a: catálogo en código. F1b: clasificador único y `other`. Spec: `docs/plan-mensual/catalogo-v2-spec.md` (secciones 1.4, 1.5, 2–4 y 8).

**Objetivo:** que los pasos salgan de la plantilla (el LLM solo llena parámetros), que las precondiciones bloqueen en vez de fallar a mitad de la ejecución, y medir la clasificación con casos reales.

## 0. Pendientes de F1b (hacer primero y reportar)
1. **Push:** confirmar que `7caaf1c` y `ca5237e` están en `origin/main`.
2. **`classifyTaskQuick`:** explicar qué hace exactamente. Si clasifica solo con señales o regex, sin el paso LLM con enum cerrado, **las entradas no deben usarlo como clasificador final**: "Agregar al plan" y `plan-actions` deben usar el flujo completo (LLM con enum + validación determinística). `classifyTaskQuick` solo puede servir como pre-filtro o como validación cruzada.
3. **Análisis Claude (`claude-analysis.ts`, ~línea 196):** el prompt y el schema Zod deben usar el **enum del catálogo**, no strings libres ni actionTypes viejos. Esta es la entrada principal, y mientras acepte strings libres el problema de raíz sigue abierto. Los alias solo se aceptan al leer datos viejos, nunca como salida nueva.
4. **Eliminar `enforceModeRules`** y las regex `WP_ALLOW_AI_PATTERNS` / `WP_FORCE_HUMAN_PATTERNS`. El modo sale del catálogo + `capabilities.ts`. Que no queden dos lógicas en paralelo.
5. **Migración de datos:** correr `scripts/migrate-action-types.ts` primero en `--dry-run` y reportar el conteo por tipo de migración (alias→canónico, `update_post`→`refresh_content`, →`other`). Después correrla de verdad.
6. **Completar la tarjeta de definición:** verificar que existan las 4 acciones (Reclasificar, Manual libre, **Dividir**, Anular), que el formulario de `NEEDS_INPUT` guarde los inputs y reintente la clasificación, y que cada acción registre un `ClassificationEvent`. Implementar lo que falte.

## 1. Decomposer acotado (`task-decomposer.ts`)
- Para actionTypes del catálogo: la **lista de pasos** (kind, orden, título, `humanReason`) sale de `steps[platform]`, resolviendo el modo y el fallback según las capabilities. El LLM **solo** genera, por paso, `prompt`, `content_brief` y parámetros (page_id, endpoint, payload, alcance de archivos para `agent`).
- Validador post-LLM: si la salida tiene pasos de más, de menos, otro orden u otro kind → un reintento con el error explicado → si vuelve a fallar → `NEEDS_DEFINITION` con el motivo.
- Los prompts de pasos `agent` incluyen siempre: el alcance de archivos permitido, los criterios de `acceptance` de la tarea y las reglas anti-invención de la sección 1.5.
- **Pasos con datos concretos (regla 1.5 #7 de la spec):**
  - Agregar `dataSources` a cada entrada del catálogo (p. ej. `fix_redirect` → GSC 404 + audit; `keyword_research`/`apply_keywords` → rank tracking + DataForSEO; `update_meta` → GSC queries/CTR de la URL; `fix_broken_links` → crawl del audit; `verify_indexation` → sitemap + URL Inspection).
  - Crear `src/lib/plan/task-data-resolver.ts`, que consulta esas fuentes en la BD de Cerebro SEO (sin llamadas pagadas nuevas, salvo que el catálogo lo indique y quede registrado en ApiUsage) **antes** del LLM. Adjunta el resultado a la tarea como `evidence` (Json: filas, fuente, fecha).
  - El LLM redacta los pasos **usando esa evidencia**. Los pasos HM incluyen la tabla concreta en "Qué hacer" (URL, keyword, actual → propuesto, métrica de origen).
  - Validador: rechazar todo paso que mencione un conjunto ("las URLs", "las keywords", "las páginas") sin su lista. Si `evidence` está vacía → paso `analysis` previo si el catálogo lo permite; si no → `NEEDS_INPUT`, explicando qué dato falta y de dónde se obtiene.
  - UI: mostrar `evidence` como una tabla expandible en la tarea.
- Tareas `other` resueltas como "manual libre": un solo paso HM con las instrucciones del humano, sin pasar por el LLM.
- Si la tarea tiene `sourceRef` con snapshot, se conserva la justificación y el impacto como hoy.

## 2. Gates — `src/lib/plan/plan-gates.ts`
- Implementar G1–G8 (sección 1.4). Reutilizar lo que ya existe: memory classifier, verificación de servicios, anti-canibalización, elegibilidad WP/Next.js.
- Se evalúan al descomponer **y** justo antes de ejecutar. Si uno falla → `BLOCKED` con `blockedReason` + `remedy` (por ejemplo, "Correr bootstrap de blog" o "No se encontró page_id para /servicios").
- G8: nunca crear un staged SEO con `page_id = 0`.

## 3. Ajustes al worker
- Imagen: el guard pasa de "blog-only" a "blog o slot declarado"; `add_image` con `origen = proporcionada` exige el archivo (`input`).
- Rango de palabras: se lee del catálogo según la intención. Quitar los rangos fijos de `executeWpPublish` y de `content-generator.ts`.
- Blog Next.js: el paso `review` ocurre **antes** de `content_lane`. Si el diagnóstico de F1a mostró otro orden, corregirlo.
- Verificador mínimo: antes de marcar DONE, revisar los criterios de `acceptance` que se puedan comprobar automáticamente (H1 único, longitudes de meta, sin `[COMPLETAR`, URLs enlazadas responden 200, build OK). Si falla → `WAITING_HUMAN` con el detalle.

## 4. Evaluación de la clasificación
- `scripts/export-classification-fixtures.ts`: exporta 40–60 objetivos reales de `PlanTask` históricas y de candidatas del Análisis Claude (texto original, plataforma, módulo) a `src/lib/plan/__fixtures__/classification.json`, con un campo `expected` **propuesto** por ti y marcado `"status": "por_validar"`. Jorge y Félix lo validan después; no lo des por bueno.
- `scripts/eval-classifier.ts`: corre el clasificador real contra los fixtures y reporta precisión global, precisión por actionType, tasa de `other`, matriz de confusión y casos fallidos. Costo estimado antes de correr; pide confirmación si pasa de $1 USD.
- Documentar en `docs/plan-mensual/evaluacion.md` cómo correrlo y los resultados de la primera corrida.

## 5. Prueba end-to-end
Con el plan de prueba de Quicsa (Next.js) y, si el plugin está desplegado, Navalsa (WP): crear tareas desde Análisis Claude y desde "Agregar al plan" en 3 módulos distintos, una de ellas con un objetivo ambiguo a propósito. Verificar la clasificación, los pasos según la plantilla, los gates y que la ambigua termine en `NEEDS_DEFINITION`.

## Cierre
Actualizar `project_state.md`, `architecture.md` y `project_spec.md`. Reportar commits, tests, resultados de la evaluación (aunque los fixtures estén por validar) y los resultados del E2E.
