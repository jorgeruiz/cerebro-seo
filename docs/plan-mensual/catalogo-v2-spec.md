# Catálogo de Tareas — Auditoría v2

> Auditoría del catálogo v1 del Plan mensual de Cerebro SEO (12 nov 2026).
> Objetivo: que cada tarea se clasifique bien, tenga pasos correctos y que el agente **no invente** pasos, datos ni tareas.
> Leyenda de veredicto: ✅ correcta · ⚠️ correcta con ajustes · ❌ hay que rehacerla.
> Lo marcado **(verificar)** depende de algo que no pude confirmar en la documentación (normalmente una capability del plugin).

---

## 0. RESUMEN DE LA AUDITORÍA

### Causas de fondo de los errores (las 8 que más pesan)

1. **La clasificación depende de "señales" sueltas.** Hay colisiones directas: "rastreo" (en SEO es *crawl*) cae en `verify_tracking`; "yoast" puede ser meta o schema; "crear página" puede ser landing, "Nosotros" o blog; "404" puede ser redirección o enlace roto; "optimizar" sin objeto no dice nada. No hay señales negativas ni reglas de desempate.
2. **El catálogo no refleja lo que ya puede hacer el plugin.** Cerebro Conector v1.6.0 ya tiene escritura en Elementor (`duplicate`, `PATCH widgets`, `apply`, `revert`, `from-template`), pero `create_landing` y `edit_page_text` en WordPress siguen como pasos manuales en Elementor. Además, el código usa `edit_page_widgets` y el catálogo usa `edit_page_text`: son dos nombres para lo mismo.
3. **Faltan campos que el encabezado promete.** El documento dice que cada tarea define `humanReason`, pero ninguna lo tiene. También faltan los datos de entrada obligatorios, las precondiciones (gates), el criterio de aceptación y las señales negativas. Si un dato de entrada falta, el agente lo rellena inventando.
4. **Los pasos `agent` de Next.js no tienen límites.** "IA: Optimizar meta tags (`agent`)" no dice qué archivos puede tocar ni cuándo la tarea está terminada. Aquí es donde el agente se sale de la tarea.
5. **Hay tareas que no se pueden ejecutar tal como están.** `upload_media` es IA, pero la IA no tiene la imagen. `generate_image` como tarea suelta choca con el guard *blog-only* del worker. `fix_redirect` en Next.js está como manual, aunque es trivial para el agente.
6. **Los tipos de paso humano se usan de forma inconsistente.** `config` se usa para "Aprobar tabla de keywords" y también para "Revisar y publicar artículo", que son cosas distintas. No existe un tipo para "el humano aporta material", como fotos reales o testimonios.
7. **Hay rangos que no coinciden entre ejecutores.** El blog de WordPress genera de 1500 a 2500 palabras (`executeWpPublish`) y el generador de Next.js de 800 a 1500. Hay que unificarlo por catálogo y no dejarlo en cada ejecutor.
8. **No hay tratamiento definido para lo que no encaja.** Hoy lo que no encaja se fuerza a la tarea más parecida o el decomposer improvisa los pasos. La sección 5 propone un `other` con reglas estrictas.

### Cambios principales propuestos

- **El catálogo como fuente única en código** (`task-catalog.ts`), con este documento generado a partir de él. Hoy hay tres versiones que se desalinean: este .md, `catalogo-tareas.md` del repo y los prompts.
- **La IA clasifica contra una lista cerrada (enum)**, con confianza y datos de entrada. Las señales quedan solo como validación cruzada. Si la IA y las señales no coinciden, o la confianza es baja, la tarea va a `other`.
- **Los pasos de una tarea del catálogo son fijos.** El LLM solo llena los parámetros (URL, keyword, page_id, brief). Si devuelve pasos de más o de menos, se rechaza.
- **Los modos de WordPress dependen de las capabilities.** Si el plugin tiene la capability, el paso es IA con cambio *staged* y aplicación humana. Si no, cae al fallback manual definido en el catálogo.

---

## 1. CONTRATO DEL CATÁLOGO (reglas globales)

### 1.1 Campos obligatorios por tarea

| Campo | Para qué |
|---|---|
| `actionType` | ID único (enum cerrado). |
| `class` | `execution` (cambia el sitio) · `diagnostic` (solo analiza y genera tareas hijas) · `offsite` (fuera del sitio: GBP, outreach, GSC). |
| `modes[platform]` | IA / HÍBRIDO / MANUAL por plataforma, **y su condición** (capability o gate). |
| `steps[platform]` | Plantilla fija de pasos, con tipo de paso y fallback. |
| `inputs` | Datos que **deben** existir antes de ejecutar. Si falta uno, la tarea no se ejecuta. |
| `gates` | Precondiciones (sección 1.4). Si una falla, la tarea queda `BLOCKED` con su remedio; no pasa a `other`. |
| `acceptance` | Criterios verificables para marcar DONE. |
| `signals` / `negativeSignals` | Pistas y anti-pistas para la validación cruzada. |
| `humanReason` | Por qué cada paso HM es humano. Se muestra en la UI. |
| `complexity` | low / medium / high, que define `maxTurns` (20/40/60). |
| `risk` | low / medium / high. Las de riesgo alto siempre llevan revisión humana explícita. |

### 1.2 Tipos de paso (vocabulario cerrado)

**IA (escriben solo dentro de su carril):**

| Tipo | Plataforma | Qué hace |
|---|---|---|
| `content_package` | Ambas | Genera textos (título, cuerpo, metas, FAQs, antes→después). No escribe en el sitio. |
| `publish` | WP | Crea un borrador en WP (`POST /publish`). |
| `seo` | WP | Metas *staged* (`POST /seo/{id}`); se aplican con "Publicar en WordPress". |
| `elementor_edit` | WP | `duplicate` → `PATCH widgets` → staged. **Nuevo en el catálogo**; ya existe en código (`executeWpElementor`). |
| `elementor_template` | WP | Borrador desde plantilla (`POST /elementor/from-template`). **Nuevo.** |
| `image` | Ambas | Higgsfield → WebP → QA con Vision. |
| `agent` | Next.js | Agent SDK en la rama del plan, **con alcance de archivos declarado**. |
| `content_lane` | Next.js | Commit directo a main vía GitHub API (blogs). |
| `nextjs_blog_generate` | Next.js | Genera el MDX del blog. |
| `keyword_research` / `apply_keywords` | Ambas | DataForSEO y configuración de keywords. |
| `analysis` | Ambas | **Nuevo. Solo lectura** (GSC, GA4, crawl, DataForSEO, repo). Produce una lista o tabla; nunca escribe. |

**HM (humano):**

| Tipo | Qué es | `humanReason` por defecto |
|---|---|---|
| `review` | Aprobar contenido o tabla dentro de Cerebro SEO | "Decisión editorial o de negocio: requiere criterio humano." |
| `wp_manual` | Acción en WP Admin o Elementor | "El plugin no tiene la capability para hacerlo." |
| `external_tool` | GSC, GA4, GTM, GBP u otra herramienta | "Herramienta externa sin API de escritura disponible." |
| `config` | Configuración dentro de Cerebro SEO | "Configuración de la cuenta del cliente." |
| `terminal` | Ajuste en la terminal web | "Requiere juicio técnico interactivo." |
| `input` | **Nuevo.** El humano aporta material real: fotos, testimonios, datos, accesos | "La IA no debe inventar este material." |

### 1.3 Modos (unificar nombres)

| Catálogo | Lane en BD | Regla |
|---|---|---|
| IA | `AUTO` | Todos los pasos son IA. La revisión ocurre a nivel plan (merge en Next.js; "Publicar en WordPress" en WP). |
| HÍBRIDO | `ASSISTED` | Al menos un paso IA y al menos un paso HM. |
| MANUAL | `MANUAL` | Solo pasos HM, aunque puede haber un `analysis` IA previo de solo lectura. |

> Eliminar "HT" de la UI y de los docs; usar solo estos tres.

### 1.4 Gates globales

| Gate | Aplica a | Si falla |
|---|---|---|
| G1 Cliente activo con SEO contratado | Todas | Se excluye del plan. |
| G2 Sitio sin migración no autorizada | Todas | Se excluye del plan. |
| G3 Memoria del repo FULL (spec/map/state) | Next.js `agent` | BLOCKED: "Completar docs del repo." |
| G4 `catalog-schemas.md` con `## Blog` / `## Landing Pages` / `## Micrositios` | Next.js blog / landing | BLOCKED: "Correr bootstrap." |
| G5 Capability del plugin presente (`/capabilities`) | WP pasos IA | Se usa el fallback del catálogo (normalmente `wp_manual`). |
| G6 Servicio verificado | Blog, landing, edición de texto | VOIDED: "Servicio no ofrecido." |
| G7 Anti-canibalización: keyword no asignada a otra URL ni a otra tarea activa | Blog, landing, meta | BLOCKED con la URL en conflicto. |
| G8 Target resuelto: URL responde 200 y hay page_id (WP) | Tareas sobre páginas existentes | BLOCKED: "No se encontró la página." No se crea un staged con page_id=0. |

### 1.5 Reglas anti-invención (aplican a todas las tareas)

1. **Una tarea = un actionType = un target** (una URL o una keyword). Los objetivos compuestos se dividen. Por ejemplo, "crear blog y enlazarlo desde servicios" son `create_blog` + `internal_links`.
2. **Los pasos son los de la plantilla.** El decomposer no agrega, quita ni reordena pasos; solo llena los parámetros.
3. **Si falta un input, la tarea no se ejecuta.** Pasa a `NEEDS_INPUT` y genera un paso HM `input`; no se asume nada.
4. **Datos que nunca se generan sin una fuente:** cifras, años de experiencia, número de clientes, certificaciones, testimonios, casos de éxito, reseñas o `aggregateRating`, precios, horarios, direcciones, fotos que aparenten ser reales (producto, equipo, instalaciones).
5. **Solo se enlazan URLs existentes** (200) y servicios verificados.
6. **El `analysis` IA nunca escribe.** Si un análisis concluye que hay que cambiar algo, crea tareas hijas del catálogo.
7. **No hay pasos con referencias genéricas.** Un paso que dice "las URLs con 404", "las keywords a posicionar" o "las páginas con meta duplicada" **debe incluir la lista concreta** como tabla en el paso: URL, keyword, valor actual, valor propuesto, métrica de origen y fecha del dato. Cada actionType declara sus `dataSources` (GSC, audit, rank tracking, GA4, DataForSEO, crawl, repo, plugin), y el decomposer las consulta **antes** de redactar los pasos. Si la fuente no tiene datos, la tarea pasa a `NEEDS_INPUT` o agrega un paso `analysis` previo; no se inventa la lista. Esto aplica igual a los pasos manuales.

---

## 2. TAREAS CON TEMPLATE (revisadas)

### create_blog — Crear artículo de blog · ⚠️

| | WordPress | Next.js |
|---|---|---|
| **Modo** | HÍBRIDO | HÍBRIDO |
| **Paso 1** | IA: Paquete de contenido (`content_package`) | IA: Generar artículo (`nextjs_blog_generate`) |
| **Paso 2** | IA: Crear borrador en WP (`publish`, cap. `publish`) | IA: Imagen de portada (`image`) |
| **Paso 3** | IA: Imagen de portada (`image`, cap. `media`) | HM: Revisar texto (`review`) |
| **Paso 4** | HM: Revisar y publicar borrador (`wp_manual`) | IA: Publicar en main (`content_lane`) |
| **Inputs** | keyword objetivo, intención, servicio relacionado (del catálogo del cliente) | Igual |
| **Gates** | G1, G2, G5, G6, G7 | G1, G2, G4 (`## Blog`), G6, G7 |
| **Aceptación** | 1 H1 con la keyword · title ≤60 · description ≤155 · **[decidir rango único de palabras]** · 1–3 enlaces internos a servicios verificados · sin `[COMPLETAR` · máx. 2 imágenes | Igual + MDX con frontmatter válido y build OK |
| **humanReason** | Paso 4: "Decisión: en WP los blogs se publican manualmente desde el borrador." | Paso 3: "Revisión editorial antes de publicar en producción." |
| **Señales** | blog, artículo nuevo, redactar artículo, crear artículo, nota de blog | |
| **Señales negativas** | actualizar artículo, artículo existente, URL de /blog/ ya existente (→ `refresh_content`) · "publicar artículo" por sí sola no basta | |

**Hallazgos:**
- En Next.js, el paso humano estaba como `config` y al final. Como el carril de contenido hace commit directo a main, **la revisión tiene que ir antes del commit**; si va después, el artículo ya está en producción. **(verificar el orden real en el worker)**
- Hay que unificar el rango de palabras: WP genera de 1500 a 2500 y Next.js de 800 a 1500. Propuesta: definirlo por intención (informacional de 1200 a 1800; respuesta corta/AEO de 600 a 900).

### update_meta — Optimizar meta tags · ⚠️

| | WordPress | Next.js |
|---|---|---|
| **Modo** | IA | IA |
| **Paso 1** | IA: Generar metas (`seo`, cap. `seo_write`) → staged | IA: Editar metadata (`agent`) |
| **Alcance del agente** | — | Solo el `metadata` o `generateMetadata` de la ruta target. Prohibido tocar contenido o componentes. |
| **Inputs** | URL target, keyword focus | Igual |
| **Gates** | G5, G7, **G8 (page_id resuelto; nunca staged con page_id=0)** | G3, G7, G8 |
| **Aceptación** | title 50–60 car. con la keyword · description 140–155 · title único en el sitio · sin la marca duplicada | Igual |
| **Aplicación** | Botón "Publicar en WordPress" (nivel plan; no cuenta como paso) | Merge del plan |
| **Señales** | meta title, meta description, meta tag, title tag, focus keyword, CTR bajo | |
| **Señales negativas** | H1, encabezado (→ `fix_headings`) · schema/datos estructurados (→ `schema`) · "yoast" sola no basta | |

### create_landing — Crear landing / página de servicio · ❌ (WP desactualizado)

| | WordPress (con cap. `elementor_write` + plantilla) | WordPress (fallback) | Next.js |
|---|---|---|---|
| **Modo** | HÍBRIDO | HÍBRIDO | IA |
| **Paso 1** | IA: Paquete de contenido (`content_package`) | IA: Paquete de contenido (`content_package`) | IA: Crear landing (`agent`) |
| **Paso 2** | IA: Borrador desde plantilla (`elementor_template`) + llenar widgets (`elementor_edit`) | HM: Armar en Elementor (`wp_manual`) | — |
| **Paso 3** | HM: Revisar y publicar (`review` + "Publicar en WordPress") | HM: Revisar y publicar (`wp_manual`) | — |
| **Inputs** | tipo (servicio / ubicación / producto), servicio verificado, keyword, **plantilla Elementor del sitio** | Igual sin plantilla | tipo, servicio, keyword |
| **Gates** | G5, G6, G7 | G6, G7 | G3, G4 (`## Landing Pages`), G6, G7 |
| **Aceptación** | 1 H1 · metas · CTA y formulario existentes del sitio · sin datos inventados (1.5 #4) · enlazada desde al menos 1 página (o tarea `internal_links` hija) | | Igual + ruta en el site-map + build OK |
| **Señales** | landing, página de servicio, página para [ciudad], página de producto | |
| **Señales negativas** | blog, artículo · "crear página" o "nueva página" **sin servicio ni ubicación** (→ `other`) | |

**Hallazgo:** con la v1.6.0 ya existe `from-template`. Falta una **configuración por sitio: "plantilla de landing por defecto"**. Sin ella, se usa el fallback.

### keyword_research — Investigar y seleccionar keywords · ⚠️

| | Ambas plataformas |
|---|---|
| **Clase** | `diagnostic` (no toca el sitio) |
| **Modo** | HÍBRIDO |
| **Paso 1** | IA: Investigar (`keyword_research`, DataForSEO, con caché) |
| **Paso 2** | HM: Aprobar tabla (`review`) |
| **Paso 3** | IA: Aplicar keywords aprobadas (`apply_keywords`): seguimiento de posiciones y asignación de URL |
| **Inputs** | servicio o semilla, ubicación, idioma |
| **Aceptación** | Tabla con volumen, KD, intención y **URL objetivo (existente o "nueva")** · sin keywords asignadas a dos URLs · costo registrado en ApiUsage |
| **Tareas hijas** | Las keywords con URL "nueva" se proponen como `create_blog` o `create_landing` (no se crean solas) |
| **humanReason** | "Selección estratégica: define en qué invierte el mes." |
| **Señales** | investigar keywords, palabras clave prioritarias, keyword research, **configurar keywords, rank tracking** (movidas desde `verify_tracking`) |
| **Señales negativas** | competencia o competidores sin "keywords" (→ `other` o módulo de competencia) |

**Hallazgo:** el paso 2 estaba como `config`; es `review`. Hay que definir qué hace exactamente `apply_keywords` (¿alta en seguimiento de posiciones?, ¿asignación keyword→URL?).

### schema — Schema markup (JSON-LD) · ⚠️

| | WordPress | Next.js |
|---|---|---|
| **Modo** | **HÍBRIDO** (antes MANUAL) | IA |
| **Paso 1** | IA: Generar y validar JSON-LD (`content_package`) | IA: Implementar JSON-LD (`agent`) |
| **Paso 2** | HM: Pegar en Rank Math/Yoast (`wp_manual`) | — |
| **Alcance del agente** | — | Componente JSON-LD en la ruta target o en el layout (Organization/LocalBusiness) |
| **Tipos permitidos** | Organization, LocalBusiness, Service, Article/BlogPosting, FAQPage, BreadcrumbList, Product | |
| **Inputs** | URL target, tipo de schema, datos NAP (de Notion/cliente) | Igual |
| **Aceptación** | JSON válido · **todo lo marcado está visible en la página** · **prohibido `aggregateRating`/`review` sin reseñas reales** · NAP igual al sitio | Igual + build OK |
| **humanReason** | "El plugin no escribe schema; se pega en el plugin SEO." | — |
| **Señales** | schema, json-ld, datos estructurados, structured data, rich results | |

**Hallazgo:** el schema es uno de los puntos donde más se inventa (FAQs que no están en la página, ratings). Por eso la regla de "visible en la página" va en la aceptación.

### internal_links — Enlaces internos · ⚠️

| | WordPress | Next.js |
|---|---|---|
| **Modo** | **HÍBRIDO** (antes MANUAL) | IA |
| **Paso 1** | IA: Mapa de enlaces (`analysis`): origen, ancla, destino, ubicación | IA: Agregar enlaces (`agent`) |
| **Paso 2** | IA: Aplicar en widgets de texto (`elementor_edit`) **si hay cap.**; en posts, vía `/update` | — |
| **Paso 2 (fallback)** | HM: Aplicar en Elementor (`wp_manual`) | — |
| **Alcance del agente** | — | Solo el cuerpo de contenido de las páginas origen. Prohibido tocar nav y footer. |
| **Inputs** | URL destino (la que se quiere empujar) | Igual |
| **Aceptación** | Destinos con 200 · máx. 3 enlaces nuevos por página origen · anclas variadas (no siempre exact-match) · sin autoenlaces | Igual |
| **Señales** | enlaces internos, interlinking, internal links, enlazar desde | |
| **Señales negativas** | backlinks, enlaces externos (→ `link_building`) · enlaces rotos (→ `fix_broken_links`) | |

### edit_page_text — Optimizar texto de página existente · ❌ (WP desactualizado)

> Unificar el nombre con el código (`edit_page_widgets`). Propuesta: quedarse con `edit_page_text`.

| | WordPress (con cap. `elementor_write`) | WordPress (fallback) | Next.js |
|---|---|---|---|
| **Modo** | IA (aplicación humana a nivel plan) | HÍBRIDO | IA |
| **Paso 1** | IA: Duplicar y editar widgets (`elementor_edit`) → staged | IA: Paquete antes→después (`content_package`) | IA: Editar contenido (`agent`) |
| **Paso 2** | — (se aplica con "Publicar en WordPress") | HM: Aplicar en Elementor (`wp_manual`) | — |
| **Casos que fuerzan el fallback** | Texto dentro de **global widget o plantilla insertada** (el plugin lo marca con `template_source`) | | |
| **Alcance del agente** | — | | Solo el copy de la ruta target. Sin cambios de diseño ni estructura. |
| **Inputs** | URL target, keyword, **qué mejorar** (de qué hallazgo viene) | | Igual |
| **Aceptación** | Mismos servicios y mismos datos duros (1.5 #4) · keyword en H1/H2/primer párrafo sin stuffing · diff legible antes→después | | Igual + build OK |
| **Señales** | optimizar texto, reescribir contenido, mejorar copy, ampliar contenido de [página] | |
| **Señales negativas** | meta, title (→ `update_meta`) · H1 (→ `fix_headings`) · artículo de blog (→ `refresh_content`) · FAQ (→ `add_faq`) | |

### upload_media — Subir imagen · ❌

**Problema:** está como IA, pero la IA no tiene la imagen. Además, el guard *blog-only* del worker la bloquea fuera de blogs.

| | WordPress | Next.js |
|---|---|---|
| **Modo** | **HÍBRIDO** | **HÍBRIDO** |
| **Paso 1** | HM: Subir archivo en Cerebro SEO (`input`) | Igual |
| **Paso 2** | IA: Optimizar (WebP, ≤200 KB) + alt + subir/insertar (`image`, cap. `media`) | IA: Optimizar + insertar (`agent`) |
| **Inputs** | archivo real, página target, ubicación (slot) | Igual |
| **humanReason** | "Material real del cliente: la IA no debe inventarlo." | |

**Propuesta:** fusionar con `generate_image` en una sola tarea `add_image` con `origen = proporcionada | generada`, y ampliar el guard del worker a "blog o slot declarado".

### generate_image — Generar imagen con IA · ❌ como tarea suelta

- Como tarea independiente choca con el guard *blog-only*, así que falla o inventa dónde va la imagen.
- **Propuesta:** dejarla solo como **sub-paso** de `create_blog` (y después de `create_landing`). Si se quiere como tarea suelta, que exija target + slot y un `review` humano.
- **Regla anti-invención:** nunca generar imágenes que aparenten ser fotos reales del producto, el equipo, las instalaciones o los clientes. Esas van por `upload_media` (`input`).

---

## 3. TAREAS HUMAN-ONLY (revisadas)

### verify_indexation — Verificar indexación · ⚠️

| | Ambas |
|---|---|
| **Clase** | `offsite` |
| **Modo** | HÍBRIDO (antes MANUAL) |
| **Paso 1** | IA: Revisar URLs con la URL Inspection API de GSC (`analysis`, solo lectura) |
| **Paso 2** | HM: Solicitar indexación de las no indexadas (`external_tool`) |
| **Inputs** | Lista de URLs (de la tarea padre, del sitemap o de páginas nuevas del mes) |
| **Instrucciones** | **Ya no se usa "el objetivo como instrucción".** El paso 2 recibe la tabla de URLs con su estado y la acción por URL. |
| **humanReason** | "GSC no permite solicitar indexación por API para páginas normales." |
| **Señales** | indexación, indexar, no indexada, cobertura |
| **Señales negativas** | noindex, desindexar, bloquear (→ `configure_robots` o `fix_indexability`) |

### fix_redirect — Redirecciones 301 · ❌ (Next.js)

| | WordPress | Next.js |
|---|---|---|
| **Modo** | HÍBRIDO | **IA** (antes MANUAL terminal) |
| **Paso 1** | IA: Tabla origen→destino (`analysis`, desde GSC 404 o el audit) | IA: Tabla origen→destino (`analysis`) |
| **Paso 2** | HM: Configurar en el plugin Redirection (`wp_manual`) | IA: Implementar en `next.config` o middleware (`agent`) |
| **Inputs** | Tabla origen→destino **o** una fuente de 404 de donde derivarla | Igual |
| **Aceptación** | 301 por defecto (302 solo si es temporal y explícito) · sin cadenas ni loops · destino responde 200 | Igual + build OK |
| **humanReason** | "Cerebro Conector no gestiona redirecciones." (Propuesta: endpoint futuro.) | — |
| **Señales** | redirección, redirect, 301, URL antigua, migración de URLs | |
| **Señales negativas** | enlace roto interno (→ `fix_broken_links`) · "404" sola no basta | |

### verify_tracking · ❌ → se divide en dos

Las señales actuales mezclan tres cosas distintas: la analítica (GA4/GTM), el seguimiento de posiciones y "rastreo", que en SEO significa *crawl*.

| Nueva tarea | Qué cubre | Modo | Pasos |
|---|---|---|---|
| `verify_analytics` | GA4/GTM, eventos y conversiones | HÍBRIDO | IA: Revisar que lleguen eventos vía la GA4 Data API (`analysis`) → HM: Corregir en GTM/GA4 (`external_tool`) |
| (absorbida por `keyword_research`) | Configuración de keywords y seguimiento de posiciones | — | — |
| "rastreo" | Se elimina como señal de tracking; se mapea a `configure_robots` / `configure_sitemap` | — | — |

**Señales de `verify_analytics`:** GA4, GTM, analytics, conversiones, eventos, píxel, medición. **Negativas:** rastreo, crawl, posiciones, ranking.

---

## 4. TAREAS NUEVAS (catalogadas)

> Formato compacto. Se aplican igual los gates G1/G2, la sección 1.5 y el alcance del agente en Next.js.

### 4.1 Las 9 que estaban pendientes

| actionType | Clase | WP: modo y pasos | Next.js: modo y pasos | Inputs | Aceptación clave / notas |
|---|---|---|---|---|---|
| `optimize_alt_text` | execution | IA: alt vía media (cap. `media_alt` **(verificar)**); sin cap. → HÍBRIDO: `content_package` + `wp_manual` | IA: `agent` (alt en componentes y MDX) | URL target | Alt descriptivo de ≤125 car., sin keyword stuffing, decorativas con `alt=""`. **Si la IA no puede ver la imagen (Vision), no inventa: deja la lista para un humano.** |
| `configure_sitemap` | execution | MANUAL: verificar el sitemap de Yoast/Rank Math (`wp_manual`) → enviar en GSC (`external_tool`) | HÍBRIDO: `agent` (`app/sitemap.ts`) → enviar en GSC (`external_tool`, o API si el scope lo permite) | — | Incluye todas las URLs indexables y excluye las noindex/redirect. **La validación del sitemap después de cada tarea de contenido es un check automático, no esta tarea.** Esta tarea solo aplica si el sitemap falta o está roto. |
| `improve_speed` | execution | MANUAL: caché, CDN, plugin de optimización (`wp_manual`) | HÍBRIDO: `analysis` (PSI) → `agent` (next/image, fuentes, lazy de terceros) → `review` | URL target + métrica (LCP/CLS/INP) | PSI antes/después sin regresión. Riesgo alto y complejidad high. |
| `setup_gbp` | offsite | HÍBRIDO: `content_package` (descripción ≤750, categorías, servicios, 4 posts) → `external_tool` | Igual | **NAP, horarios y accesos (`input`)** | NAP idéntico al sitio. Nunca inventar horarios ni direcciones. La verificación de la ficha la hace el cliente. |
| `audit_duplicate` | **diagnostic** | HÍBRIDO: `analysis` (similitud de contenido + queries de GSC repartidas entre URLs) → `review` | Igual | — | No escribe nada. Produce tareas hijas: `merge_content`, `configure_canonical`, `fix_redirect`, `edit_page_text`. |
| `optimize_images` | execution | MANUAL: plugin de compresión/WebP (`wp_manual`) | IA: `agent` (sharp → WebP/AVIF, `next/image` con `sizes`) | — | ≤200 KB por imagen, sin cambio visual, build OK. |
| `configure_robots` | execution | HÍBRIDO: `content_package` → pegar en el editor del plugin SEO (`wp_manual`) | HÍBRIDO: `agent` (`app/robots.ts`) → **`review` obligatorio** | — | **Guards automáticos:** rechazar `Disallow: /` global; rechazar el bloqueo de GPTBot, ClaudeBot, PerplexityBot u OAI-SearchBot (contradice la estrategia AEO); debe referenciar el sitemap. Riesgo alto. |
| `configure_canonical` | execution | IA vía `/seo/{id}` si la cap. incluye canonical **(verificar)**; si no, `wp_manual` | IA: `agent` (`alternates.canonical`) | URL target + canonical destino | Absoluta, self-referencing por defecto, coherente con el sitemap y con el destino final de las redirecciones. Normalmente nace de `audit_duplicate`. |
| `link_building` | offsite | HÍBRIDO: `analysis` (gaps de backlinks de la competencia, DataForSEO) → `review` → outreach (`external_tool`) | Igual | Competidores configurados | **Solo prospectos que salen de los datos**; nunca listas inventadas de medios o directorios. Costo de DataForSEO registrado. |

### 4.2 Tareas que faltaban en el catálogo

| actionType | Clase | WP | Next.js | Por qué agregarla |
|---|---|---|---|---|
| `fix_headings` | execution | IA: `elementor_edit` (widget heading) → staged; fallback `wp_manual` | IA: `agent` | Ya estaba entre las tareas "seguras" automáticas. Aceptación: 1 H1 por página, jerarquía sin saltos. |
| `fix_broken_links` | execution | HÍBRIDO: `analysis` (audit) → `elementor_edit` o `wp_manual` | IA: `analysis` → `agent` | Hoy "404" la manda a redirecciones por error. |
| `refresh_content` | execution | IA: `content_package` → `/update/{id}` **como staged o revisión** → `review` | HÍBRIDO: `nextjs_blog_generate` (edición) → `review` → `content_lane` | Distinguir "actualizar artículo existente" de "crear artículo". Exige la URL existente. |
| `add_faq` | execution | HÍBRIDO: `content_package` → `wp_manual` (el plugin edita widgets, no los crea **(verificar)**) | IA: `agent` (sección + FAQPage) | Foco AEO. Respuestas solo con información verificada del sitio o del cliente. |
| `aeo_readiness` | execution | MANUAL/HÍBRIDO: `content_package` (llms.txt) → `wp_manual` | IA: `agent` (llms.txt, rutas .md, `Link rel=alternate`, robots para bots IA) | Liga los 10 checks de AEO Readiness con acciones. Nunca cloaking ni user-agent sniffing. |
| `merge_content` | execution | HÍBRIDO: `analysis` (plan de fusión) → `review` → `edit_page_text` + `fix_redirect` | Igual con `agent` | Resolver canibalización con un procedimiento definido y no improvisado. |
| `add_human_evidence` | execution | HÍBRIDO: **`input` obligatorio** (caso, testimonio, datos reales) → `content_package` → `wp_manual` o `elementor_edit` | HÍBRIDO: `input` → `agent` | El análisis de sitio propone contenido "humano". Es la tarea con mayor riesgo de invención, así que **sin `input` no arranca**. |
| `security_fix` | execution | MANUAL (`wp_manual`: actualizar plugins, etc.) | IA: `agent` (alcance = hallazgo puntual) → `review` | Hallazgos del lente de seguridad del Análisis de sitio. |

---

## 5. TRATAMIENTO DE `other` (lo que no encaja)

### 5.1 Cuándo una tarea es `other`

Se cumple cualquiera de estas condiciones:
- El clasificador devuelve una confianza menor al umbral (propuesta: < 0.75).
- La IA y las señales apuntan a actionTypes distintos.
- Coinciden señales de 2 o más actionTypes y ninguna regla de la sección 6 desempata.
- El objetivo no tiene objeto concreto ("optimizar el sitio", "mejorar SEO").
- Es compuesto y no se puede dividir con seguridad.

> Un gate fallido **no** convierte la tarea en `other`: queda `BLOCKED` con su remedio.

### 5.2 Qué puede y qué no puede hacer el agente

| Puede | No puede |
|---|---|
| Explicar qué entendió del objetivo | Generar pasos de ejecución |
| Proponer **los 2 actionTypes más cercanos**, con la razón de cada uno | Escribir en el repo, en WP o en herramientas externas |
| Listar qué datos faltan para clasificarla | Elegir él mismo un actionType del catálogo |
| Correr **un** `analysis` de solo lectura si le ayuda a describirla (opcional, con tope de costo) | Contar la tarea como hecha |

### 5.3 Flujo en la UI

1. La tarea entra con estado **`NEEDS_DEFINITION`**, badge gris y fuera de los conteos IA/Híbrido/Manual.
2. Una tarjeta de definición muestra el objetivo original, el módulo de origen (`sourceRef`), lo que entendió la IA, los 2 candidatos y los datos faltantes.
3. El humano elige una de cuatro opciones:
   - **a) Reclasificar** en un actionType del catálogo. Se aplica la plantilla de ese tipo, sin LLM para la estructura de pasos.
   - **b) Manual libre:** el humano escribe las instrucciones. Queda un único paso HM con `humanReason = "Tarea fuera de catálogo"`.
   - **c) Dividir** en varias tareas, cada una con su actionType.
   - **d) Anular.**
4. Para la barra al 100%, una tarea `other` cuenta como pendiente hasta que se resuelve (a, b o c) o se anula (d).

### 5.4 Retroalimentación al catálogo

- Cada `other` se registra con el objetivo original, el cliente, la plataforma, el módulo de origen y la resolución elegida.
- Cada reclasificación (a) se guarda como **ejemplo etiquetado** para el set de pruebas (sección 7, punto 7).
- Un reporte mensual agrupa los `other` resueltos con (b). **Si un patrón aparece 3 o más veces en el mes, se propone como actionType nuevo** en la sección "Pendientes de catalogar".

---

## 6. MATRIZ DE DESAMBIGUACIÓN

| Si el objetivo dice… | Y además… | → actionType |
|---|---|---|
| optimizar | meta, title, description, CTR | `update_meta` |
| optimizar | texto, contenido, copy + URL de página | `edit_page_text` |
| optimizar | artículo o URL de /blog/ existente | `refresh_content` |
| optimizar | imágenes, peso, WebP | `optimize_images` |
| optimizar | velocidad, Core Web Vitals, LCP | `improve_speed` |
| optimizar | (nada más) | `other` |
| crear página / nueva página | servicio, ciudad o producto | `create_landing` |
| crear página / nueva página | ninguno de los anteriores | `other` |
| yoast / rank math | schema | `schema` |
| yoast / rank math | title, description, keyword | `update_meta` |
| 404 | redirigir, URL antigua, backlinks a URL muerta | `fix_redirect` |
| 404 | enlace roto dentro del sitio | `fix_broken_links` |
| rastreo, crawl | robots | `configure_robots` |
| rastreo, crawl | sitemap | `configure_sitemap` |
| tracking | GA4, GTM, conversiones | `verify_analytics` |
| tracking | posiciones, keywords | `keyword_research` (`apply_keywords`) |
| indexar | (sin "no") | `verify_indexation` |
| noindex, desindexar | — | `configure_robots` o `other` |
| enlaces | internos, interlinking | `internal_links` |
| enlaces | backlinks, externos | `link_building` |
| duplicado, canibalización | sin una decisión tomada | `audit_duplicate` |
| duplicado, canibalización | "fusionar" o "consolidar" + URLs | `merge_content` |
| imagen | nuevo blog | sub-paso de `create_blog` |
| imagen | alt | `optimize_alt_text` |
| imagen | foto real, del cliente | `upload_media` (`input`) |
| testimonios, casos de éxito | — | `add_human_evidence` |
| preguntas frecuentes, FAQ | — | `add_faq` |
| llms.txt, IA, ChatGPT, AEO | legibilidad o rastreo de bots IA | `aeo_readiness` |

---

## 7. CAMBIOS PARA IMPLEMENTAR (checklist para Claude Code)

1. **`src/lib/plan/task-catalog.ts` como fuente única:** un objeto tipado `actionType → { class, modes, steps, inputs (zod), gates, acceptance, signals, negativeSignals, humanReason, complexity, risk }`. Generar `docs/catalogo-tareas.md` desde ahí con un script, para que no se desalinee.
2. **Clasificación (Análisis Claude + Add-to-Plan):** tool-use con un `enum` cerrado de actionTypes + `confidence` + `inputs` extraídos + `targetUrl`/`targetKeyword`. Después, validación determinística: enum, inputs, compatibilidad con la plataforma y matriz de la sección 6 con señales negativas. Si hay conflicto o confianza baja → `other`.
3. **Decomposer acotado:** para actionTypes del catálogo, la estructura de pasos sale de la plantilla. El LLM solo llena `prompt`, `content_brief` y parámetros. Un validador rechaza los pasos cuyo tipo u orden no coincide con la plantilla.
4. **Nuevos estados de PlanTask:** `NEEDS_DEFINITION` (para `other`), `NEEDS_INPUT` (falta un input) y `BLOCKED` con `blockedReason` + `remedy`.
5. **Unificar nombres:** `edit_page_widgets` → `edit_page_text`; lanes AUTO/ASSISTED/MANUAL ↔ IA/HÍBRIDO/MANUAL; eliminar "HT".
6. **Ajustes al worker:** guard de imagen de "blog-only" a "blog o slot declarado"; G8 que impida un staged SEO con page_id=0; rango de palabras desde el catálogo.
7. **Set de pruebas de clasificación:** 40–60 objetivos reales de planes anteriores, con su actionType esperado, en `__fixtures__/classification.json` y un script de evaluación (precisión por actionType y tasa de `other`). Correrlo cada vez que cambie el prompt o el catálogo.
8. **Telemetría:** registrar la clasificación (actionType, confianza, conflicto, reclasificación humana) para el reporte mensual de la sección 5.4.
9. **Configuración por sitio WP:** "plantilla de landing por defecto" (ID de `elementor_library`).

---

## 8. DECISIONES (cerradas 12 nov 2026)

| # | Decisión |
|---|---|
| 1 | Blog en Next.js: la revisión humana (`review`) va **antes** del commit a main por el carril de contenido. |
| 2 | Rango de palabras por intención, definido en el catálogo: informacional 1200–1800; respuesta corta/AEO 600–900. Ningún ejecutor tiene su propio rango. |
| 3 | `upload_media` y `generate_image` se fusionan en `add_image` (`origen = proporcionada \| generada`). La imagen generada solo existe como sub-paso de `create_blog`, hasta que se decida otra cosa. |
| 4 | `link_building` y `setup_gbp` entran al Plan mensual como `offsite`, sin escrituras de IA. |
| 5 | Umbral de confianza para `other`: 0.75, ajustable con el set de pruebas. |
| 6 | Capabilities por confirmar (alt de medios, canonical en `/seo`, crear widgets): se verifican en el diagnóstico de la Fase 1. Mientras no estén confirmadas, se usa el fallback `wp_manual`. |
| 7 | Redirecciones en WP: fallback `wp_manual`. El endpoint en Cerebro Conector queda para después. |

---

## 9. ARQUITECTURA OBJETIVO Y HOJA DE RUTA

### 9.1 Categorías (eje "para qué"; es independiente de `class`, que es el eje "cómo")

Cada actionType tiene **una** `category` principal y `tags` secundarios opcionales.

| category | Incluye |
|---|---|
| `technical` | audit, metas, headings, schema, robots, sitemap, canonical, redirecciones, enlaces rotos, velocidad, imágenes, seguridad |
| `content` | blog, landings, micrositios, refresh, enlaces internos, edición de texto |
| `aeo_geo` | FAQ, aeo_readiness, contenido de respuesta, citas en IA, consistencia de la entidad |
| `authority_local` | GBP, link building, directorios |
| `measurement_conversion` | GA4/GTM, formularios y leads, CRO |
| `infrastructure` | **paquetes**: bootstrap de blog/landings/micrositios, integración con CRM, analítica base |

### 9.2 Paquetes (`category = infrastructure`)

Un paquete es una instalación, no una tarea mensual. Tiene cinco campos obligatorios:
- `preflight`: lo que debe existir antes.
- `detect`: cómo saber si ya está instalado, para no duplicarlo (es idempotente).
- `install`: los pasos de instalación.
- `verify`: la prueba final.
- `rollback`: cómo revertirlo.

Se registra un `SitePackage(siteId, packageId, version, installedAt, status)`. El planificador consulta los paquetes de cada sitio antes de proponer tareas; por ejemplo, si no hay `blog_bootstrap`, no propone `create_blog` y propone primero instalar el paquete.

### 9.3 Agente administrador

- **Planificador** (uno): elige tareas del catálogo según los datos.
- **Ejecutores por carril:** agente de código Next.js · ejecutor del plugin WP · carril de contenido · humano/offsite.
- **Verificador:** revisa `acceptance` antes de marcar DONE.
- La especialización por categoría vive en el catálogo y en skills por categoría, **no** en agentes separados.

### 9.4 Oficina ↔ Cerebro SEO

- Cerebro SEO es dueño del catálogo, los datos, la ejecución y el estado. La Oficina es solo la interfaz de conversación.
- Cerebro SEO expone herramientas (MCP o API M2M): `crear_tarea`, `ver_plan`, `estado_sitio`, `instalar_paquete`, `aprobar_paso`.
- Una orden dada en el chat crea una `PlanTask` con `sourceRef.module = "oficina"` y pasa por el mismo clasificador. **Nunca se ejecuta directo.**

### 9.5 Niveles de autonomía (por cliente, y por actionType dentro del cliente)

| Nivel | Comportamiento |
|---|---|
| 0 | Todo con botón (pruebas). |
| 1 | Un cron (job repetible de BullMQ, día 1) arma el plan; un humano lo aprueba. |
| 2 | Ejecuta solas las tareas de riesgo bajo. |
| 3 | Ejecuta también las de riesgo medio. Las de riesgo alto siempre llevan `review`. |

Un actionType sube de nivel después de 5 ejecuciones seguidas sin corrección humana.

### 9.6 Hoja de ruta

| Fase | Sesiones | Criterio de salida |
|---|---|---|
| 1. Catálogo y clasificación | F1a diagnóstico + catálogo en código · F1b clasificador + `other` · F1c decomposer acotado + gates + evaluación | Set de pruebas con más del 90% correcto; un plan real ejecutado sin pasos inventados |
| 2. Categorías y paquetes | F2 (`blog_bootstrap` primero) | El planificador propone instalar el paquete antes de proponer blogs |
| 3. Herramientas para la Oficina | F3 | Una tarea creada desde la Oficina aparece en el plan con el flujo normal |
| 4. Autonomía y cron | F4 | 1–2 clientes en nivel 1 durante un mes sin incidentes |

---

## 10. PENDIENTES DE CATALOGAR

> Se alimenta automáticamente desde los `other` resueltos con "manual libre" (sección 5.4).

| Tarea observada | Cliente | Veces/mes | ¿Qué debería ser? | actionType propuesto | Modo | Pasos WP | Pasos Next.js |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
