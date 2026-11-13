# Sesión F1d — Cierre de gaps de la Fase 1

## Contexto
F1c quedó con los gaps que tú mismo reportaste. Esta sesión cierra **solo** lo que impide cumplir el criterio de salida de la Fase 1. No es trabajo nuevo. Spec: `docs/plan-mensual/catalogo-v2-spec.md`.

## Prioridad 1 — Datos concretos en los pasos (el problema original de Jorge)
Que los pasos vengan del catálogo resuelve la **estructura**, pero no los **datos**. El caso que hay que resolver es el de un paso humano que dice "configurar las keywords a posicionar" o "redirigir las URLs con 404" sin decir cuáles.
1. Cada paso (IA **y** HM) que opere sobre un conjunto debe tener `evidence` con filas concretas. En los HM, el bloque "Qué hacer" las muestra como **tabla en la UI** (URL, keyword, actual → propuesto, fuente, fecha), no solo como texto en el prompt.
2. Si la `evidence` que requiere el catálogo para esa tarea (`dataSources`) llega vacía → paso `analysis` previo si el catálogo lo permite; si no → `NEEDS_INPUT`, indicando qué dato falta y de dónde se obtiene. **No se crea el paso sin lista.**
3. Validador de texto: rechazar el contenido generado (instrucciones, `content_brief`, prompts de pasos) que mencione un conjunto ("las URLs", "las keywords", "las páginas", "los enlaces") sin filas en `evidence`.
4. Tests: una tarea `fix_redirect` sin 404 en la BD → `NEEDS_INPUT`; con 404 → paso HM con una tabla de N filas.

## Prioridad 2 — Gates reales (G4, G6, G8)
Hoy devuelven `true`. "Se verifica al ejecutar" es justo el fallo que queremos evitar: las tareas mueren a mitad de la ejecución.
- **G4:** usar el memory classifier existente + heading exacto en `catalog-schemas.md` (`## Blog` / `## Landing Pages` / `## Micrositios`). Si falla → `BLOCKED` con remedy "Instalar bootstrap de …".
- **G6:** reutilizar la verificación de servicios que ya usan el Análisis y el decomposer (la que anuló la landing de análisis de agua en Quicsa). Si falla → `VOIDED` con el motivo.
- **G8:** reutilizar `tryResolvePageId` (WP) / la existencia de la ruta (Next.js). Si falla → `BLOCKED`. Nunca un staged con `page_id = 0`.
- **G5** puede quedarse como degradable, **siempre que** la resolución de modo use el fallback del catálogo. Confirmar con un test.

## Prioridad 3 — Tarjeta de definición completa
- **Dividir:** el usuario escribe N objetivos → se crean N tareas; cada una pasa por `classifyTask()`; la original se cierra como dividida. Registra `ClassificationEvent`.
- **Anular** dentro de la tarjeta, registrando `ClassificationEvent`.

## Prioridad 4 — Menores
- `wp-executor` y `content-generator` leen el rango de palabras del catálogo según el actionType (quitar el hardcode).
- `checkPreDone()`: H1 único, longitudes de meta, sin `[COMPLETAR`, enlaces internos nuevos responden 200 (contra el preview o producción). Si falla → `WAITING_HUMAN` con el detalle.

## Prioridad 5 — Scripts para producción (los corre Jorge en Easypanel)
Deja tres comandos documentados en `docs/plan-mensual/runbook-produccion.md`, listos para correr en la consola del servicio, **sin imprimir secretos**:
1. `migrate-action-types.ts --dry-run` y luego `--apply`, mostrando el conteo por tipo.
2. `export-classification-fixtures.ts`: exporta 40–60 objetivos reales de producción a un archivo descargable, con `expected` propuesto y `status: por_validar`.
3. `eval-classifier.ts`: corre contra los fixtures validados. Debe mostrar el costo estimado y pedir confirmación si pasa de $1 USD.

## Cierre
Actualizar `project_state.md`, `architecture.md` y `project_spec.md`. Reportar commits, tests y el estado de cada prioridad (hecho / no hecho y por qué).
