# Sesión F1b — Clasificador único + tratamiento de `other`

## Contexto
F1a dejó `src/lib/plan/task-catalog.ts` y `disambiguation.ts` (datos puros) y el diagnóstico en `docs/plan-mensual/diagnostico-f1.md`. Spec: `docs/plan-mensual/catalogo-v2-spec.md` (secciones 1.5, 5 y 6). Lee ambos antes de empezar.

**Objetivo:** que todas las entradas que crean tareas pasen por un único clasificador, y que lo que no encaje quede en `NEEDS_DEFINITION` en vez de forzarse o inventarse.

## 0. Ajustes derivados del diagnóstico F1a (hacer primero)
- **Eliminar `WpActionType` por completo.** Debe quedar solo el `ActionType` del catálogo. Lo que hoy lo usa (`ACTION_TYPE_CAPABILITIES`, `enforceModeRules`, `claude-analysis.ts`, `wp-executor.ts`) pasa a usar el catálogo.
- **`ACTION_TO_CATEGORY` está duplicado en 2 archivos:** eliminar ambos y derivar la categoría de `task-catalog.ts`.
- **Capa de capabilities:** crear `src/lib/plan/capabilities.ts`, que mapea los nombres de capability del catálogo (`publish`, `media`, `seo_write`, `elementor_write`, etc.) a lo que realmente devuelve `GET /capabilities` del plugin. Una capability sin mapeo confirmado se trata como **ausente** y se usa el fallback; no se asume. Deja el mapeo como una tabla fácil de editar, con un comentario `// TODO confirmar` donde aplique.
- **Ajustar el catálogo con lo confirmado en F1a** (si no quedó así en F1a):
  - `configure_canonical` en WP: no hay canonical en `/seo/{id}` → `content_package` + `wp_manual`.
  - `add_faq` en WP: no se pueden crear widgets → `content_package` + `wp_manual`.
  - `optimize_alt_text` en WP: el alt solo se puede poner al subir la imagen (`POST /media`). Imágenes nuevas → IA; imágenes existentes → `content_package` + `wp_manual`.
  - Regenerar `docs/catalogo-tareas.md`.

## 1. Schema (Prisma, `migrate dev`; nada de SQL crudo)
- `PlanTask`: `actionType` (string validado contra el enum del catálogo), `category`, `classificationConfidence Float?`, `classificationMeta Json?` (candidatos, señales que coincidieron, conflictos, datos faltantes, versión del catálogo), `blockedReason String?`, `remedy String?`.
- Nuevos estados de `PlanTaskStatus`: `NEEDS_DEFINITION`, `NEEDS_INPUT`, `BLOCKED`.
- Migrar los datos existentes (no borrar nada):
  - `edit_page_widgets` → `edit_page_text`.
  - `create_landing_from_template` → `create_landing`.
  - `update_post` → `refresh_content` **solo si** el target es un post de blog (post_type, ruta `/blog/` o un `sourceRef` que lo indique); si no se puede determinar → `other` + `NEEDS_DEFINITION`.
  - Cualquier actionType desconocido → `other` + `NEEDS_DEFINITION`.
  - Reportar el conteo por cada tipo de migración.
- Modelo `ClassificationEvent` (taskId, original, final, actor, motivo, fecha) para registrar las reclasificaciones humanas. Alimenta el set de pruebas y el reporte mensual.

## 2. Clasificador — `src/lib/plan/classify-task.ts`
1. **Paso LLM** (Claude Sonnet, tool-use): una herramienta `classify` cuyo `actionType` es **un enum con los valores del catálogo**. Devuelve `confidence`, `targetUrl`, `targetKeyword`, `inputs` extraídos, `splitInto` (si el objetivo es compuesto) y `reasoning` breve. El prompt incluye para cada actionType su descripción, sus señales, sus señales negativas y la regla "una tarea = un actionType = un target".
2. **Validación determinística** (sin LLM):
   - El actionType está en el enum y es compatible con la plataforma del sitio.
   - Reglas de `disambiguation.ts` y `negativeSignals`: si apuntan a otro actionType → conflicto.
   - Confianza < `OTHER_CONFIDENCE_THRESHOLD`, conflicto, o el objetivo no tiene objeto → `other` + `NEEDS_DEFINITION`, guardando los 2 candidatos más cercanos y los datos faltantes en `classificationMeta`.
   - Inputs obligatorios (zod) incompletos → `NEEDS_INPUT`, con la lista de faltantes.
   - `splitInto` con más de un elemento → crear las tareas hijas, cada una clasificada por separado. Si no se puede dividir con seguridad → `other`.
3. **Modo**: se resuelve con el catálogo + capabilities (cache de 24 h, como hoy). Las regex de `enforceModeRules` se eliminan como mecanismo de clasificación; si el proxy no responde, se usa el fallback del catálogo y se anota en `classificationMeta`.

## 3. Conectar TODAS las entradas
Las que listó el diagnóstico de F1a: Análisis Claude (`claude-analysis.ts`, que debe proponer usando el enum), `actionAddToPlan` (9 módulos) y cualquier otra. **Ninguna** debe conservar su lógica vieja de clasificación. Si una no puede migrarse en esta sesión, repórtala.

## 4. UI (página Plan mensual)
- **Tarjeta de definición** para `NEEDS_DEFINITION`: objetivo original, módulo de origen, qué entendió la IA, los 2 candidatos con su razón, datos faltantes. Cuatro acciones:
  - **Reclasificar:** selector de actionType → aplica la plantilla.
  - **Manual libre:** el humano escribe las instrucciones → un único paso HM con `humanReason = "Tarea fuera de catálogo"`.
  - **Dividir:** en N tareas.
  - **Anular.**
  Cada acción registra un `ClassificationEvent`.
- **Tarjeta de NEEDS_INPUT** con un formulario de los inputs faltantes.
- **BLOCKED** muestra `blockedReason` + `remedy`.
- Los contadores IA/Híbrido/Manual excluyen `NEEDS_DEFINITION`. En la barra de progreso, esas tareas cuentan como pendientes hasta que se resuelven o se anulan.
- Badge de categoría en cada tarea y filtro por categoría.
- Quitar "HT" de toda la UI (usar IA/Híbrido/Manual).

## 5. Tests
- Clasificador con el LLM mockeado: confianza baja → other; conflicto con señales negativas → other; faltan inputs → NEEDS_INPUT; objetivo compuesto → split; plataforma incompatible → other.
- Al menos 1 caso por cada fila de la matriz de desambiguación.
- Migración de datos (alias y desconocidos).

## Fuera de alcance
El decomposer, los gates, los ajustes del worker y **el set de pruebas con su evaluación** van en F1c. No los adelantes.

## Cierre
Actualizar `project_state.md`, `architecture.md` y `project_spec.md`. Reportar commits, tests, entradas migradas y cualquier entrada que haya quedado pendiente.
