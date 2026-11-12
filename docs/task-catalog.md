# Catálogo de Tareas — Cerebro SEO

> Tabla viva. Se actualiza cada vez que descubrimos un nuevo tipo de tarea
> que el Análisis Claude puede generar. Cada entrada define cómo se resuelve
> por plataforma.

## Tareas con Template (determinísticas)

| actionType | Señal en título | WP | Next.js | Fuente |
|---|---|---|---|---|
| `create_blog` | blog, redactar, crear artículo | AI: content_package → publish → image → HM: revisar | Carril contenido (sin branch) | template |
| `update_meta` | meta title/description, yoast, focus keyword, optimizar meta | AI: seo (1 paso, stagedChange) | AI: agent (1 paso) | template |
| `create_landing` | landing, página de servicio, crear página | AI: content_package → HM: Elementor × 2 | AI: agent (1 paso) | template |
| `keyword_research` | investigar keywords, seleccionar keywords, palabras clave | AI: research → HM: aprobar → AI: aplicar | Igual | template |
| `schema` | schema, json-ld, datos estructurados | HM: Yoast/Rank Math manual | AI: agent | template |
| `internal_links` | enlaces internos, interlinking | HM: Elementor manual | AI: agent | template |
| `edit_page_text` | optimizar texto/contenido, editar texto | AI: content_package → HM: Elementor | AI: agent | template |
| `upload_media` | subir imagen | AI: image | AI: image | template |
| `generate_image` | generar imagen AI | AI: image | AI: image | template |

## Tareas HUMAN (sin handler AI, paso directo)

| Señal en título | actionType | WP humanReason | Next.js humanReason | Descubierta en |
|---|---|---|---|---|
| indexación, indexar, verificar indexados | `verify_indexation` | external_tool (GSC) | external_tool (GSC) | QE nov-2026 |
| redirección, redirect, 301, 302, 404 redirigir | `fix_redirect` | wp_manual (plugin Redirection) | terminal | QE nov-2026 |
| verificar tracking, configuración keywords | `verify_tracking` | config (Cerebro SEO) | config | QE nov-2026 |
| FAQ schema en artículos existentes | `schema` | wp_manual (Yoast) | agent | QE nov-2026 |

## Tareas pendientes de catalogar

> Agregar aquí cuando aparezcan en producción y no se resuelvan correctamente.

| Tarea observada | Cliente | Fecha | Problema | Resolución propuesta |
|---|---|---|---|---|
| _ejemplo: "Optimizar alt text de imágenes"_ | _Cliente X_ | _2026-XX-XX_ | _sin template, crash_ | _AI si plugin soporta, HUMAN si no_ |

## Reglas de coherencia (task-coherence.ts)

1. META se evalúa ANTES que BLOG (más específico primero)
2. BLOG solo matchea "blog", "redactar", "crear/escribir/nuevo/publicar artículo" — no "artículo" suelto
3. "keyword" solo matchea keyword_research si dice "investigar/seleccionar" — no como mención casual
4. Indexación/redirect → siempre `other` → HUMAN
5. WP AI sin acción JSON válida → se degrada a HUMAN automáticamente
6. Category siempre se corrige para coincidir con actionType

## Cómo agregar una nueva tarea

1. Observar el error/clasificación incorrecta en producción
2. Agregar la señal en `task-coherence.ts` (pattern + actionType)
3. Si necesita template → agregar en `task-templates.ts`
4. Si es HUMAN → documentar aquí + el decomposer la degrada automáticamente
5. Bump DECOMPOSER_VERSION → las tareas viejas se rehacen con "Rehacer todas"
