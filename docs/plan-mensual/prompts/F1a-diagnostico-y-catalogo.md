# Sesión F1a — Diagnóstico + catálogo como fuente única

## Contexto
El Plan mensual clasifica mal las tareas, genera pasos equivocados y el agente inventa cuando algo no encaja. Hay una spec nueva del catálogo: `docs/plan-mensual/catalogo-v2-spec.md` (Jorge la sube junto con este prompt). Léela completa antes de empezar; es la fuente de verdad de esta fase.

La Fase 1 tiene 3 sesiones:
- **F1a (esta):** diagnóstico + catálogo en código. **Sin cambios de comportamiento.**
- F1b: clasificador + `other`.
- F1c: decomposer acotado + gates + evaluación.

## Parte 1 — Diagnóstico (antes de escribir código)

Genera `docs/plan-mensual/diagnostico-f1.md` con lo siguiente:

1. **Inventario de actionTypes en el código** (`analysis-candidates.ts`: `WpActionType`, `ACTION_TYPE_CAPABILITIES`, `WP_ALLOW_AI_PATTERNS`, `WP_FORCE_HUMAN_PATTERNS`, `enforceModeRules`; `claude-analysis.ts`; `task-decomposer.ts` SYSTEM_PROMPT; los kinds del advisor que sigan vivos; `docs/catalogo-tareas.md`). Tabla: actionType en el código, equivalente en la spec v2 (sección 2–4) y diferencias.
2. **Todas las entradas que crean `PlanTask`**: Análisis Claude, `actionAddToPlan` (9 módulos), terminal y cualquier otra. Para cada una: archivo, función y cómo asigna hoy el actionType y el modo.
3. **Dónde se decide hoy la estructura de pasos** (decomposer) y qué libertad tiene el LLM.
4. **Capabilities reales de Cerebro Conector v1.6.x**: qué devuelve `/capabilities` según los tipos de `wp-proxy-client.ts` y los usos en el código. Confirma o descarta: alt de medios, canonical en `/seo/{id}` y creación de widgets nuevos (no solo edición). Si no se puede confirmar desde este repo (el plugin vive en cerebro-web), márcalo "no confirmado"; no lo asumas.
5. **Orden real de pasos del blog Next.js**: ¿la revisión humana ocurre antes o después del commit a main por el carril de contenido?
6. **Rangos de palabras** que usa cada ejecutor.
6b. **Datos disponibles por actionType:** para cada uno, qué tablas o servicios de Cerebro SEO ya tienen los datos concretos que necesitarían sus pasos (404 de GSC/audit, keywords del rank tracking, CTR por URL, enlaces rotos del crawl, etc.). Busca también 3 o más ejemplos reales de pasos genéricos generados hoy ("las URLs con 404" sin lista). Esto alimenta `dataSources` en F1c.
7. **Mapeo de lanes** (`AUTO/ASSISTED/MANUAL`) ↔ IA/HÍBRIDO/MANUAL ↔ "HT" en la UI.
8. **Discrepancias con la spec** que cambien el diseño. **Si encuentras alguna que contradiga la spec de forma importante, detente aquí y repórtala antes de la Parte 2.**

## Parte 2 — Catálogo en código (datos puros, sin conectar)

1. Crear `src/lib/plan/task-catalog.ts`:
   - Tipos: `ActionType` (enum cerrado con todas las tareas de las secciones 2, 3 y 4 de la spec + `other`), `TaskClass`, `TaskCategory` (6 categorías, sección 9.1), `StepKind` (vocabulario cerrado, sección 1.2), `Mode`, `Risk`, `Complexity`, `GateId` (G1–G8).
   - `CatalogEntry`: `class`, `category`, `tags`, `modes[platform]` (con condición de capability y fallback), `steps[platform]` (plantilla con kind, título y `humanReason` en los HM), `inputs` (schema zod), `gates`, `acceptance`, `signals`, `negativeSignals`, `complexity`, `risk`, y `wordRange` donde aplique.
   - Constantes de configuración: `OTHER_CONFIDENCE_THRESHOLD = 0.75` y los rangos de palabras por intención.
   - Aplicar las decisiones de la sección 8 de la spec (fusión en `add_image`, review antes de `content_lane`, etc.).
   - Nombre canónico `edit_page_text`; `edit_page_widgets` queda como alias deprecado (solo para mapear datos existentes).
2. Mover la matriz de desambiguación (sección 6) a `src/lib/plan/disambiguation.ts` como reglas declarativas. Todavía no se usa.
3. Crear `scripts/generate-catalog-doc.ts`, que regenera `docs/catalogo-tareas.md` desde el catálogo. Ese documento queda marcado como "generado, no editar".
4. Tests de integridad del catálogo (vitest):
   - Todo paso HM tiene `humanReason`.
   - Modo IA ⇒ sin pasos HM; MANUAL ⇒ sin pasos IA de escritura (sí se permite `analysis`); HÍBRIDO ⇒ al menos uno de cada tipo.
   - Todo `StepKind` usado pertenece al vocabulario.
   - Toda entrada tiene al menos un criterio de `acceptance`, una `category` y al menos una señal.
   - Ninguna señal positiva de una entrada es idéntica a una señal positiva de otra sin una regla de desambiguación que las separe.
   - Los pasos IA de WP que dependen de una capability tienen fallback.

## Fuera de alcance
No conectar el catálogo al flujo, no cambiar el decomposer ni los ejecutores, no hacer migraciones de BD. Todo eso va en F1b y F1c.

## Cierre
- Actualizar `project_state.md` (bitácora de la sesión F1a y decisiones), `architecture.md` (nuevo módulo `src/lib/plan/`) y `project_spec.md`.
- Reportar: hallazgos clave del diagnóstico (máximo 10 viñetas), commits, número de tests y discrepancias abiertas para Jorge.
