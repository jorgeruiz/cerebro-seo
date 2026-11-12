# Diagnóstico F1 — Estado actual del Plan Mensual

> Generado: 2026-11-12. Fuente: análisis de código de Cerebro SEO.
> Complementa la spec `catalogo-v2-spec.md`.

---

## 1. Inventario de actionTypes en el código

Existen **DOS sistemas de tipos separados** que deben unificarse:

### Sistema A: `WpActionType` (analysis-candidates.ts:34-42)
Usado SOLO en la fase de Análisis Claude.

| WpActionType | Capability requerida | Modo base |
|---|---|---|
| `create_blog` | `publish` | HYBRID |
| `update_meta` | `seo_write` | AI |
| `upload_media` | `media` | AI |
| `update_post` | `update` | AI |
| `edit_page_widgets` | (ninguna — HUMAN) | HUMAN |
| `create_landing_from_template` | (ninguna — local) | HYBRID |
| `generate_image` | `media` | AI |
| `other` | (ninguna) | HUMAN |

### Sistema B: `ActionType` (task-templates.ts:17-31)
Usado en descomposición y templates.

| ActionType | Tiene template | Observación |
|---|---|---|
| `create_blog` | ✅ | Coincide con Sistema A |
| `update_meta` | ✅ | Coincide |
| `keyword_research` | ✅ | **No existe en Sistema A** |
| `schema` | ✅ | **No existe en Sistema A** |
| `internal_links` | ✅ | **No existe en Sistema A** |
| `edit_page_text` | ✅ | **Nombre diferente** al Sistema A (`edit_page_widgets`) |
| `create_landing` | ✅ | **Nombre diferente** (`create_landing_from_template`) |
| `upload_media` | ✅ | Coincide |
| `generate_image` | ✅ | Coincide |
| `verify_indexation` | HUMAN-only | **No existe en Sistema A** |
| `fix_redirect` | HUMAN-only | **No existe en Sistema A** |
| `verify_tracking` | HUMAN-only | **No existe en Sistema A** |
| `other` | Fallback | Coincide |

### Mapeo Sistema A ↔ Sistema B ↔ Spec v2

| Sistema A (WpActionType) | Sistema B (ActionType) | Spec v2 | Discrepancia |
|---|---|---|---|
| `create_blog` | `create_blog` | `create_blog` | Ninguna |
| `update_meta` | `update_meta` | `update_meta` | Ninguna |
| `upload_media` | `upload_media` | **`add_image`** (fusionado con generate_image) | Spec fusiona ambos |
| `update_post` | *(no existe)* | *(no existe como tipo)* | Huérfano — sin template |
| `edit_page_widgets` | `edit_page_text` | `edit_page_text` | Nombre diferente |
| `create_landing_from_template` | `create_landing` | `create_landing` | Nombre diferente |
| `generate_image` | `generate_image` | **`add_image`** (fusionado) | Spec fusiona |
| `other` | `other` | `other` | Ninguna |
| *(no existe)* | `keyword_research` | `keyword_research` | Solo en Sistema B |
| *(no existe)* | `schema` | `schema` | Solo en Sistema B |
| *(no existe)* | `verify_indexation` | `verify_indexation` | Solo en Sistema B |
| *(no existe)* | *(no existe)* | `fix_headings` | **Nuevo en spec** |
| *(no existe)* | *(no existe)* | `fix_broken_links` | **Nuevo en spec** |
| *(no existe)* | *(no existe)* | `refresh_content` | **Nuevo en spec** |
| *(no existe)* | *(no existe)* | `add_faq` | **Nuevo en spec** |
| *(no existe)* | *(no existe)* | `aeo_readiness` | **Nuevo en spec** |
| *(no existe)* | *(no existe)* | `merge_content` | **Nuevo en spec** |
| *(no existe)* | *(no existe)* | `add_human_evidence` | **Nuevo en spec** |
| *(no existe)* | *(no existe)* | `security_fix` | **Nuevo en spec** |
| *(no existe)* | *(no existe)* | `optimize_alt_text` | **Nuevo en spec** |
| *(no existe)* | *(no existe)* | `configure_sitemap` | **Nuevo en spec** |
| *(no existe)* | *(no existe)* | `improve_speed` | **Nuevo en spec** |
| *(no existe)* | *(no existe)* | `setup_gbp` | **Nuevo en spec** |
| *(no existe)* | *(no existe)* | `audit_duplicate` | **Nuevo en spec** |
| *(no existe)* | *(no existe)* | `optimize_images` | **Nuevo en spec** |
| *(no existe)* | *(no existe)* | `configure_robots` | **Nuevo en spec** |
| *(no existe)* | *(no existe)* | `configure_canonical` | **Nuevo en spec** |
| *(no existe)* | *(no existe)* | `link_building` | **Nuevo en spec** |
| *(no existe)* | `verify_tracking` | **`verify_analytics`** (renombrado) | Spec renombra y divide |

---

## 2. Entradas que crean PlanTask

| Entrada | Archivo | Función | Cómo asigna actionType | Cómo asigna mode |
|---|---|---|---|---|
| Análisis Claude | `analisis/plan-actions.ts:173` | `actionSendToPlan` | Directo de `candidate.actionType` (WpActionType, nullable) | De `candidate.mode` (análisis), respetado por plataforma |
| Módulos (9) | `add-to-plan-action.ts:134` | `actionAddToPlan` | De `input.actionType` (opcional) | De template `resolveTaskMode` si actionType + plataforma; fallback legacy |
| *(No hay otras rutas de producción)* | | | | |

**Problema**: cuando Análisis envía `actionType: "edit_page_widgets"` (WpActionType), el template solo conoce `"edit_page_text"` → no matchea → cae al LLM libre.

---

## 3. Dónde se decide la estructura de pasos

### Flujo del decomposer (task-decomposer.ts)

```
1. Coherence preflight (task-coherence.ts)
   → auto-corrige actionType, category, targetKeyword
   → HUMAN-only actions (verify_*, fix_redirect) → WAITING_HUMAN directo

2. HUMAN_ONLY_ACTIONS check
   → Si actionType ∈ {other, verify_indexation, fix_redirect, verify_tracking}
   → 1 paso HUMAN directo, SIN LLM

3. Template path
   → Si getTemplate(actionType, platform) retorna template
   → Pasos FIJOS de la plantilla, LLM NO los toca
   → LLM solo llena payloads (keyword, page_title, brief)

4. Free-form LLM path (si nada matchea)
   → Claude genera 1-5 pasos con tipo AI/HUMAN
   → Validación post-generación:
     - Zod schema
     - humanReason obligatorio para HUMAN
     - WP: AI sin acción JSON válida → degradar a HUMAN
     - Filtro audit/lighthouse
   → Sin validación de: número de pasos, orden, tipos de paso
```

**Libertad del LLM en free-form**: total. Puede generar cualquier combinación de pasos AI/HUMAN, en cualquier orden, con cualquier prompt. Las validaciones post-generación son reactivas (rechazan lo inválido) pero no proactivas (no fuerzan estructura).

---

## 4. Capabilities reales de Cerebro Conector v1.6.x

| Capability | Endpoint | Estado |
|---|---|---|
| Leer páginas | `GET /pages` | ✅ Confirmado |
| Leer capabilities | `GET /capabilities` | ✅ Confirmado |
| Leer Elementor | `GET /elementor/{id}` | ✅ Confirmado |
| Leer Kit (colores) | `GET /kit` | ✅ Confirmado |
| Publicar post/blog | `POST /publish` | ✅ Confirmado |
| Subir media **con alt text** | `POST /media` | ✅ Confirmado (payload acepta `alt_text`) |
| Meta tags (title, desc, keyword) | `POST /seo/{id}` | ✅ Confirmado |
| **Canonical en `/seo/{id}`** | | ❌ **NO confirmado** — solo title, description, focus_keyword |
| Duplicar página Elementor | `POST /elementor/duplicate/{id}` | ✅ Confirmado |
| Editar widgets existentes | `PATCH /elementor/{id}/widgets` | ✅ Confirmado |
| Aplicar borrador Elementor | `POST /elementor/apply/{id}` | ✅ Confirmado |
| Revertir Elementor | `POST /elementor/revert/{id}/{rev}` | ✅ Confirmado |
| Crear desde plantilla | `POST /elementor/from-template` | ✅ Confirmado |
| Importar estructura | `POST /elementor/import` | ✅ Confirmado |
| Actualizar post | `PUT /update/{id}` | ✅ Confirmado |
| **Crear widgets NUEVOS** | | ❌ **NO confirmado** — solo edita/importa existentes |
| **Alt de medios existentes** | | ⚠️ `POST /media` sí acepta alt, pero para editar alt de imagen YA subida no hay endpoint |

---

## 5. Orden real de pasos del blog Next.js

```
processNextjsBlogTask():
  1. Preflight: catalog-schemas.md tiene ## Blog ✓
  2. Para cada step AI:
     a. Image step → executeImage() → resultado en memoria
     b. Content step → generateBlogArticleData() → stagedChange
  3. Task → WAITING_HUMAN ← el artículo NO se commitea aún
  4. Usuario revisa texto + portada en la UI
  5. Clic "Publicar en main" → commitFiles() a main vía GitHub API
```

**Confirmado**: la revisión humana va **DESPUÉS** de generar y **ANTES** de commitear. La spec v2 decisión #1 es correcta.

---

## 6. Rangos de palabras por ejecutor

| Ejecutor | Contexto | Rango | Archivo:línea |
|---|---|---|---|
| `executeWpPublish` | Blog WP (artículo completo) | 1500–2500 | wp-executor.ts:814 |
| `executeContentPackage` | Blog WP (content_package) | 1200–1800 | wp-executor.ts:561 |
| `executeContentPackage` | Landing WP | Sin rango explícito (por secciones) | wp-executor.ts:562 |
| `generateBlogArticleData` | Blog Next.js | **Sin rango** (no validado) | task-processor.ts |

**Discrepancia**: WP blog genera 1500–2500 en un ejecutor y 1200–1800 en otro. Next.js no tiene rango. La spec v2 propone unificar: informacional 1200–1800, respuesta corta/AEO 600–900.

---

## 6b. Datos disponibles por actionType

| actionType | Dato necesario | Fuente disponible en Cerebro SEO | Tabla/servicio |
|---|---|---|---|
| `fix_redirect` | URLs con 404 | DataForSEO audit, GSC coverage | `Audit` table, GSC API |
| `update_meta` | title/desc actuales | WP plugin GET /seo/{id}, crawl | `PageMetric`, wp-proxy |
| `keyword_research` | Volumen, KD, GSC | DataForSEO Labs, GSC API | `Keyword`, `KeywordRanking` |
| `internal_links` | Mapa de enlaces | Crawl (Cheerio BFS) | `Audit` → internal links |
| `fix_broken_links` | Enlaces rotos | Crawl, DataForSEO audit | `Audit` table |
| `verify_indexation` | URLs y estado | GSC URL Inspection API | GSC API (no tabla local) |
| `schema` | Schema actual | Crawl (extrae JSON-LD) | `Audit` → schema check |
| `edit_page_text` | Texto actual | WP plugin GET /elementor/{id} | wp-proxy-client |

### Ejemplos de pasos genéricos (sin datos concretos)

El SYSTEM_PROMPT del decomposer no contiene ejemplos genéricos directamente, pero los templates generan pasos como:
1. `"Generar meta tags"` — sin decir cuáles son los metas actuales ni la URL específica
2. `"Paquete de contenido"` — sin los textos actuales de la página
3. `"Configurar schema en Yoast"` — sin el tipo de schema ni los datos NAP

El `context` del payload de SEO (agregado recientemente) incluye `task.objective`, pero no consulta las fuentes de datos concretas.

---

## 7. Mapeo de lanes

| Catálogo (spec v2) | Lane en BD (`TaskMode` enum) | UI actual | Paso HM tipo |
|---|---|---|---|
| IA | `AI` | "IA" (badge azul) | — |
| HÍBRIDO | `HYBRID` | "HÍBRIDO" (badge morado) | Varios: review, wp_manual, config, external_tool |
| MANUAL | `HUMAN` | "Manual" (badge naranja) | Todos los pasos son HM |

**Nota**: la spec propone eliminar "HT" de la UI. Actualmente el label en StepRow es "HT" (monospace). El label del task badge usa "HÍBRIDO" / "Manual" / "IA".

El `resolveTaskMode()` en task-templates.ts ya implementa la regla: todos AI→AI, mezcla→HYBRID, todos HUMAN→HUMAN.

---

## 8. Discrepancias con la spec que cambian el diseño

### ⚠️ DISCREPANCIA IMPORTANTE: Sistema dual de actionTypes

La spec asume un enum cerrado único de actionTypes. Hoy hay dos sistemas (WpActionType en Análisis, ActionType en Templates) con valores que no coinciden:
- `edit_page_widgets` vs `edit_page_text`
- `create_landing_from_template` vs `create_landing`
- `update_post` no existe en templates

**Impacto en el diseño**: el catálogo en código (`task-catalog.ts`) debe ser el **único** enum. `WpActionType` debe desaparecer o ser un alias explícito que mapea al catálogo. Esto afecta `analysis-candidates.ts`, `claude-analysis.ts` (el prompt del análisis), `enforceModeRules()`, y las regex de `task-coherence.ts`.

**Recomendación**: en F1a crear el catálogo como fuente única (enum). En F1b, hacer que el Análisis Claude use ese mismo enum y eliminar WpActionType.

### Otras discrepancias menores

1. **`upload_media` + `generate_image` → `add_image`**: la spec los fusiona pero el código los tiene separados con templates distintos. Resolver en F1a al crear el catálogo.
2. **`verify_tracking` → dividir en `verify_analytics` + absorber en `keyword_research`**: la spec propone dividirlo. El código actual tiene un solo `verify_tracking`.
3. **Nuevos estados de PlanTask**: la spec propone `NEEDS_DEFINITION` y `NEEDS_INPUT`. El enum actual tiene: PLANNING, READY, RUNNING, WAITING_HUMAN, DONE, FAILED, VOIDED. Migración necesaria en F1b.
4. **`analysis` como StepKind de solo lectura**: no existe hoy. Los pasos AI siempre pueden escribir. Necesita nuevo tipo en F1b.
5. **Gates G3-G8**: G4 (catalog-schemas) ya existe en el carril de contenido. Los demás no están implementados como sistema. El preflight actual solo verifica sitio/URL/plataforma/repo.

---

## Resumen: 10 hallazgos clave

1. **Dos sistemas de actionType** (WpActionType vs ActionType) con valores que no coinciden → causa #1 de clasificación incorrecta
2. **Canonical NO disponible** en el plugin (`/seo/{id}` solo acepta title/desc/keyword)
3. **Crear widgets nuevos NO disponible** — solo editar/importar existentes
4. **Alt text de medios SÍ disponible** en `POST /media` (upload)
5. **Blog Next.js: revisión antes de commit** — confirmado, spec correcta
6. **Rangos de palabras inconsistentes**: WP 1500-2500 vs content_package 1200-1800 vs Next.js sin rango
7. **LLM tiene libertad total en free-form** — puede generar cualquier combinación de pasos
8. **ACTION_TO_CATEGORY duplicado** en 2 archivos (coherence + plan-actions) → riesgo de desalineación
9. **14 nuevos actionTypes en la spec** que no existen en el código
10. **`other` hoy genera 1 paso HUMAN genérico** — la spec propone `NEEDS_DEFINITION` con UI de reclasificación
