# Catálogo de Tareas — Cerebro SEO

> ⚠️ GENERADO AUTOMÁTICAMENTE desde `src/lib/plan/task-catalog.ts`.
> No editar manualmente. Correr `npx tsx scripts/generate-catalog-doc.ts` para regenerar.

Fecha de generación: 2026-11-12
Total: 29 actionTypes
Umbral de confianza para other: 0.75
Rangos de palabras: informacional 1200–1800, AEO 600–900, landing 800–1200

---

## create_blog

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | content |
| **WP modo** | HYBRID |
| **Next.js modo** | HYBRID |
| **Complejidad** | high |
| **Riesgo** | low |
| **Palabras** | 1200–1800 |
| **Gates** | G1, G2, G6, G7 |

**Pasos WordPress:**
- IA: Paquete de contenido (`content_package`)
- IA: Crear borrador en WordPress (`publish` (cap: publish) → fallback: wp_manual)
- IA: Imagen de portada (`image` (cap: media) → fallback: input)
- HM: Revisar y publicar borrador (`review`)

**Pasos Next.js:**
- IA: Generar artículo (`nextjs_blog_generate`)
- IA: Imagen de portada (`image`)
- HM: Revisar texto (`review`)
- IA: Publicar en main (`content_lane`)

**Señales:** blog · artículo nuevo · redactar artículo · crear artículo · nota de blog
**Señales negativas:** actualizar artículo · artículo existente · URL de /blog/ ya existente

**Aceptación:**
- 1 H1 con la keyword
- title ≤60 chars
- description ≤155 chars
- 1–3 enlaces internos a servicios verificados
- sin [COMPLETAR
- máx. 2 imágenes

---

## update_meta

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | technical |
| **WP modo** | AI (requiere seo_write) |
| **Next.js modo** | AI |
| **Complejidad** | low |
| **Riesgo** | low |
| **Gates** | G1, G2, G7, G8 |

**Pasos WordPress:**
- IA: Generar meta tags (`seo` (cap: seo_write) → fallback: wp_manual)

**Pasos Next.js:**
- IA: Editar metadata (`agent`)

**Señales:** meta title · meta description · meta tag · title tag · focus keyword · CTR bajo
**Señales negativas:** H1 · encabezado · schema · datos estructurados · yoast sola

**Aceptación:**
- title 50–60 chars con la keyword
- description 140–155 chars
- title único en el sitio

---

## create_landing

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | content |
| **WP modo** | HYBRID (requiere elementor_write) → fallback HYBRID |
| **Next.js modo** | AI |
| **Complejidad** | high |
| **Riesgo** | medium |
| **Palabras** | 800–1200 |
| **Gates** | G1, G2, G6, G7 |

**Pasos WordPress:**
- IA: Paquete de contenido para landing (`content_package`)
- IA: Borrador desde plantilla (`elementor_template` (cap: elementor_write) → fallback: wp_manual)
- HM: Revisar y publicar (`review`)

**Pasos Next.js:**
- IA: Crear landing page (`agent`)

**Señales:** landing · página de servicio · página para ciudad · página de producto
**Señales negativas:** blog · artículo · crear página sin servicio ni ubicación

**Aceptación:**
- 1 H1 con la keyword
- metas completos
- CTA y formulario existentes del sitio
- sin datos inventados

---

## keyword_research

| Campo | Valor |
|---|---|
| **Clase** | diagnostic |
| **Categoría** | technical |
| **WP modo** | HYBRID |
| **Next.js modo** | HYBRID |
| **Complejidad** | medium |
| **Riesgo** | low |
| **Gates** | G1, G2 |

**Pasos WordPress:**
- IA: Investigar y seleccionar keywords (`keyword_research`)
- HM: Aprobar tabla de keywords (`review`)
- IA: Aplicar keywords aprobadas (`apply_keywords`)

**Pasos Next.js:**
- IA: Investigar y seleccionar keywords (`keyword_research`)
- HM: Aprobar tabla de keywords (`review`)
- IA: Aplicar keywords aprobadas (`apply_keywords`)

**Señales:** investigar keywords · palabras clave prioritarias · keyword research · configurar keywords · rank tracking
**Señales negativas:** competencia sin keywords · competidores sin keywords

**Aceptación:**
- Tabla con volumen, KD, intención y URL objetivo
- Sin keywords asignadas a dos URLs
- Costo registrado en ApiUsage

---

## schema

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | technical |
| **WP modo** | HYBRID |
| **Next.js modo** | AI |
| **Complejidad** | medium |
| **Riesgo** | medium |
| **Gates** | G1, G2, G8 |

**Pasos WordPress:**
- IA: Generar y validar JSON-LD (`content_package`)
- HM: Pegar en Rank Math/Yoast (`wp_manual`)

**Pasos Next.js:**
- IA: Implementar JSON-LD (`agent`)

**Señales:** schema · json-ld · datos estructurados · structured data · rich results
**Señales negativas:** meta title · meta description

**Aceptación:**
- JSON válido
- Todo lo marcado está visible en la página
- Prohibido aggregateRating/review sin reseñas reales

---

## internal_links

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | content |
| **WP modo** | AI (requiere elementor_write) → fallback HYBRID |
| **Next.js modo** | AI |
| **Complejidad** | medium |
| **Riesgo** | low |
| **Gates** | G1, G2, G8 |

**Pasos WordPress:**
- IA: Mapa de enlaces: origen, ancla, destino (`analysis`)
- IA: Aplicar en widgets de texto (`elementor_edit` (cap: elementor_write) → fallback: wp_manual)

**Pasos Next.js:**
- IA: Agregar/optimizar enlaces internos (`agent`)

**Señales:** enlaces internos · interlinking · internal links · enlazar desde
**Señales negativas:** backlinks · enlaces externos · enlaces rotos

**Aceptación:**
- Destinos con 200
- Máx 3 enlaces nuevos por página origen
- Anclas variadas (no siempre exact-match)
- Sin autoenlaces

---

## edit_page_text

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | content |
| **WP modo** | AI (requiere elementor_write) → fallback HYBRID |
| **Next.js modo** | AI |
| **Complejidad** | medium |
| **Riesgo** | medium |
| **Gates** | G1, G2, G7, G8 |

**Pasos WordPress:**
- IA: Duplicar y editar widgets (`elementor_edit` (cap: elementor_write) → fallback: wp_manual)

**Pasos Next.js:**
- IA: Editar contenido de la página (`agent`)

**Señales:** optimizar texto · reescribir contenido · mejorar copy · ampliar contenido
**Señales negativas:** meta · title tag · H1 solo · artículo de blog · FAQ

**Aceptación:**
- Mismos servicios y datos duros
- Keyword en H1/H2/primer párrafo sin stuffing
- Diff legible antes→después

---

## add_image

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | content |
| **WP modo** | HYBRID |
| **Next.js modo** | HYBRID |
| **Complejidad** | low |
| **Riesgo** | low |
| **Gates** | G1, G2, G8 |

**Pasos WordPress:**
- HM: Proporcionar imagen (o generar con IA) (`input`)
- IA: Optimizar + subir (`image` (cap: media) → fallback: wp_manual)

**Pasos Next.js:**
- HM: Proporcionar imagen (o generar con IA) (`input`)
- IA: Optimizar e insertar (`agent`)

**Señales:** imagen · foto · media
**Señales negativas:** alt text solo

**Aceptación:**
- Alt descriptivo ≤125 chars
- Sin keyword stuffing en alt
- ≤200 KB

---

## verify_indexation

| Campo | Valor |
|---|---|
| **Clase** | offsite |
| **Categoría** | technical |
| **WP modo** | HYBRID |
| **Next.js modo** | HYBRID |
| **Complejidad** | low |
| **Riesgo** | low |
| **Gates** | G1, G2 |

**Pasos WordPress:**
- IA: Revisar URLs con GSC URL Inspection (`analysis`)
- HM: Solicitar indexación de las no indexadas (`external_tool`)

**Pasos Next.js:**
- IA: Revisar URLs con GSC URL Inspection (`analysis`)
- HM: Solicitar indexación de las no indexadas (`external_tool`)

**Señales:** indexación · indexar · no indexada · cobertura
**Señales negativas:** noindex · desindexar · bloquear

**Aceptación:**
- URLs indexadas o solicitud enviada
- Documentar motivo de no-indexación

---

## fix_redirect

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | technical |
| **WP modo** | HYBRID |
| **Next.js modo** | AI |
| **Complejidad** | low |
| **Riesgo** | medium |
| **Gates** | G1, G2 |

**Pasos WordPress:**
- IA: Tabla origen→destino (`analysis`)
- HM: Configurar en plugin Redirection (`wp_manual`)

**Pasos Next.js:**
- IA: Tabla origen→destino (`analysis`)
- IA: Implementar en next.config o middleware (`agent`)

**Señales:** redirección · redirect · 301 · URL antigua · migración de URLs
**Señales negativas:** enlace roto interno · 404 sola

**Aceptación:**
- 301 por defecto
- Sin cadenas ni loops
- Destino responde 200

---

## verify_analytics

| Campo | Valor |
|---|---|
| **Clase** | offsite |
| **Categoría** | measurement_conversion |
| **WP modo** | HYBRID |
| **Next.js modo** | HYBRID |
| **Complejidad** | medium |
| **Riesgo** | low |
| **Gates** | G1, G2 |

**Pasos WordPress:**
- IA: Revisar eventos vía GA4 Data API (`analysis`)
- HM: Corregir en GTM/GA4 (`external_tool`)

**Pasos Next.js:**
- IA: Revisar eventos vía GA4 Data API (`analysis`)
- HM: Corregir en GTM/GA4 (`external_tool`)

**Señales:** GA4 · GTM · analytics · conversiones · eventos · medición
**Señales negativas:** rastreo · crawl · posiciones · ranking

**Aceptación:**
- Eventos configurados y con datos
- Conversiones registrándose

---

## optimize_alt_text

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | technical |
| **WP modo** | HYBRID |
| **Next.js modo** | AI |
| **Complejidad** | low |
| **Riesgo** | low |
| **Gates** | G1, G2, G8 |

**Pasos WordPress:**
- IA: Generar alt text descriptivo (`content_package`)
- HM: Aplicar alt en medios (`wp_manual`)

**Pasos Next.js:**
- IA: Actualizar alt en componentes/MDX (`agent`)

**Señales:** alt text · alt de imágenes · texto alternativo
**Señales negativas:** imagen nueva · generar imagen

**Aceptación:**
- Alt descriptivo ≤125 chars
- Sin keyword stuffing
- Decorativas con alt=""

---

## configure_sitemap

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | technical |
| **WP modo** | MANUAL |
| **Next.js modo** | HYBRID |
| **Complejidad** | low |
| **Riesgo** | low |
| **Gates** | G1, G2 |

**Pasos WordPress:**
- HM: Verificar sitemap en Yoast/Rank Math (`wp_manual`)
- HM: Enviar en GSC (`external_tool`)

**Pasos Next.js:**
- IA: Configurar app/sitemap.ts (`agent`)
- HM: Enviar en GSC (`external_tool`)

**Señales:** sitemap · sitemap.xml
**Señales negativas:** robots.txt

**Aceptación:**
- Incluye URLs indexables
- Excluye noindex/redirect

---

## improve_speed

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | technical |
| **WP modo** | MANUAL |
| **Next.js modo** | HYBRID |
| **Complejidad** | high |
| **Riesgo** | high |
| **Gates** | G1, G2 |

**Pasos WordPress:**
- HM: Configurar caché, CDN, plugin optimización (`wp_manual`)

**Pasos Next.js:**
- IA: Diagnóstico PSI (`analysis`)
- IA: Optimizar (next/image, fuentes, lazy) (`agent`)
- HM: Verificar sin regresión (`review`)

**Señales:** velocidad · Core Web Vitals · LCP · CLS · INP · performance

**Aceptación:**
- PSI antes/después sin regresión

---

## setup_gbp

| Campo | Valor |
|---|---|
| **Clase** | offsite |
| **Categoría** | authority_local |
| **WP modo** | HYBRID |
| **Next.js modo** | HYBRID |
| **Complejidad** | medium |
| **Riesgo** | low |
| **Gates** | G1, G2 |

**Pasos WordPress:**
- IA: Descripción, categorías, posts (`content_package`)
- HM: NAP, horarios y accesos (`input`)
- HM: Configurar en Google Business Profile (`external_tool`)

**Pasos Next.js:**
- IA: Descripción, categorías, posts (`content_package`)
- HM: NAP, horarios y accesos (`input`)
- HM: Configurar en Google Business Profile (`external_tool`)

**Señales:** Google Business · GBP · ficha de Google · Google Maps

**Aceptación:**
- NAP idéntico al sitio
- Nunca inventar horarios ni direcciones

---

## audit_duplicate

| Campo | Valor |
|---|---|
| **Clase** | diagnostic |
| **Categoría** | technical |
| **WP modo** | HYBRID |
| **Next.js modo** | HYBRID |
| **Complejidad** | medium |
| **Riesgo** | low |
| **Gates** | G1, G2 |

**Pasos WordPress:**
- IA: Análisis de contenido duplicado + queries GSC (`analysis`)
- HM: Decidir fusión/canonical/redirect (`review`)

**Pasos Next.js:**
- IA: Análisis de contenido duplicado + queries GSC (`analysis`)
- HM: Decidir fusión/canonical/redirect (`review`)

**Señales:** duplicado · canibalización · contenido duplicado
**Señales negativas:** fusionar con URLs

**Aceptación:**
- Produce tareas hijas: merge_content, configure_canonical, fix_redirect, edit_page_text

---

## optimize_images

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | technical |
| **WP modo** | MANUAL |
| **Next.js modo** | AI |
| **Complejidad** | medium |
| **Riesgo** | low |
| **Gates** | G1, G2 |

**Pasos WordPress:**
- HM: Plugin de compresión/WebP (`wp_manual`)

**Pasos Next.js:**
- IA: Comprimir a WebP/AVIF + next/image sizes (`agent`)

**Señales:** optimizar imágenes · comprimir imágenes · WebP · peso de imágenes
**Señales negativas:** alt text · generar imagen

**Aceptación:**
- ≤200 KB por imagen
- Sin cambio visual

---

## configure_robots

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | technical |
| **WP modo** | HYBRID |
| **Next.js modo** | HYBRID |
| **Complejidad** | low |
| **Riesgo** | high |
| **Gates** | G1, G2 |

**Pasos WordPress:**
- IA: Generar robots.txt (`content_package`)
- HM: Pegar en plugin SEO (`wp_manual`)

**Pasos Next.js:**
- IA: Configurar app/robots.ts (`agent`)
- HM: Revisar antes de publicar (`review`)

**Señales:** robots.txt · robots · crawl budget
**Señales negativas:** sitemap

**Aceptación:**
- Sin Disallow: / global
- Sin bloqueo de GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot
- Referencia al sitemap

---

## configure_canonical

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | technical |
| **WP modo** | HYBRID |
| **Next.js modo** | AI |
| **Complejidad** | low |
| **Riesgo** | medium |
| **Gates** | G1, G2, G8 |

**Pasos WordPress:**
- IA: Determinar URL canonical correcta (`content_package`)
- HM: Configurar canonical en Yoast/Rank Math (`wp_manual`)

**Pasos Next.js:**
- IA: Configurar canonical en alternates (`agent`)

**Señales:** canonical · rel canonical · URL canónica
**Señales negativas:** duplicado sin decisión

**Aceptación:**
- Absoluta
- Self-referencing por defecto
- Coherente con sitemap y redirects

---

## link_building

| Campo | Valor |
|---|---|
| **Clase** | offsite |
| **Categoría** | authority_local |
| **WP modo** | HYBRID |
| **Next.js modo** | HYBRID |
| **Complejidad** | high |
| **Riesgo** | low |
| **Gates** | G1, G2 |

**Pasos WordPress:**
- IA: Gaps de backlinks vs competencia (`analysis`)
- HM: Aprobar prospectos (`review`)
- HM: Outreach (`external_tool`)

**Pasos Next.js:**
- IA: Gaps de backlinks vs competencia (`analysis`)
- HM: Aprobar prospectos (`review`)
- HM: Outreach (`external_tool`)

**Señales:** backlinks · link building · autoridad · enlaces externos
**Señales negativas:** enlaces internos

**Aceptación:**
- Solo prospectos que salen de los datos
- Costo DataForSEO registrado

---

## fix_headings

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | technical |
| **WP modo** | AI (requiere elementor_write) → fallback HYBRID |
| **Next.js modo** | AI |
| **Complejidad** | low |
| **Riesgo** | low |
| **Gates** | G1, G2, G8 |

**Pasos WordPress:**
- IA: Editar widgets heading (`elementor_edit` (cap: elementor_write) → fallback: wp_manual)

**Pasos Next.js:**
- IA: Corregir jerarquía de encabezados (`agent`)

**Señales:** H1 · encabezado · heading · jerarquía de títulos
**Señales negativas:** meta title · title tag

**Aceptación:**
- 1 H1 por página
- Jerarquía sin saltos (H1→H2→H3)

---

## fix_broken_links

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | technical |
| **WP modo** | AI (requiere elementor_write) → fallback HYBRID |
| **Next.js modo** | AI |
| **Complejidad** | low |
| **Riesgo** | low |
| **Gates** | G1, G2 |

**Pasos WordPress:**
- IA: Listar enlaces rotos (`analysis`)
- IA: Corregir en widgets (`elementor_edit` (cap: elementor_write) → fallback: wp_manual)

**Pasos Next.js:**
- IA: Listar enlaces rotos (`analysis`)
- IA: Corregir enlaces (`agent`)

**Señales:** enlace roto · broken link · link roto · error 404 interno
**Señales negativas:** redirección · 301

**Aceptación:**
- Todos los enlaces apuntan a URLs con 200

---

## refresh_content

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | content |
| **WP modo** | HYBRID |
| **Next.js modo** | HYBRID |
| **Complejidad** | medium |
| **Riesgo** | medium |
| **Palabras** | 1200–1800 |
| **Gates** | G1, G2, G8 |

**Pasos WordPress:**
- IA: Paquete de actualización (`content_package`)
- HM: Revisar y aplicar (`review`)

**Pasos Next.js:**
- IA: Actualizar artículo (`nextjs_blog_generate`)
- HM: Revisar cambios (`review`)
- IA: Publicar actualización (`content_lane`)

**Señales:** actualizar artículo · refrescar contenido · artículo desactualizado · contenido viejo
**Señales negativas:** crear artículo · nuevo artículo

**Aceptación:**
- Contenido actualizado con datos vigentes
- Sin perder posicionamiento existente

---

## add_faq

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | aeo_geo |
| **WP modo** | HYBRID |
| **Next.js modo** | AI |
| **Complejidad** | medium |
| **Riesgo** | low |
| **Palabras** | 600–900 |
| **Gates** | G1, G2, G8 |

**Pasos WordPress:**
- IA: Generar FAQ y schema (`content_package`)
- HM: Agregar FAQ en la página (`wp_manual`)

**Pasos Next.js:**
- IA: Agregar sección FAQ + FAQPage schema (`agent`)

**Señales:** FAQ · preguntas frecuentes · featured snippet · respuestas directas

**Aceptación:**
- Respuestas solo con información verificada
- FAQPage schema válido

---

## aeo_readiness

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | aeo_geo |
| **WP modo** | HYBRID |
| **Next.js modo** | AI |
| **Complejidad** | medium |
| **Riesgo** | medium |
| **Gates** | G1, G2 |

**Pasos WordPress:**
- IA: Generar llms.txt y configuración (`content_package`)
- HM: Aplicar en WP (`wp_manual`)

**Pasos Next.js:**
- IA: Implementar llms.txt, rutas .md, robots para bots IA (`agent`)

**Señales:** llms.txt · AEO · AI Overviews · ChatGPT · Perplexity · legibilidad IA

**Aceptación:**
- Nunca cloaking ni user-agent sniffing
- llms.txt válido

---

## merge_content

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | content |
| **WP modo** | HYBRID |
| **Next.js modo** | HYBRID |
| **Complejidad** | high |
| **Riesgo** | high |
| **Gates** | G1, G2 |

**Pasos WordPress:**
- IA: Plan de fusión (`analysis`)
- HM: Aprobar plan (`review`)
- HM: Fusionar en WP Admin (`wp_manual`)

**Pasos Next.js:**
- IA: Plan de fusión (`analysis`)
- HM: Aprobar plan (`review`)
- IA: Fusionar contenido + redirect (`agent`)

**Señales:** fusionar · consolidar · merge · canibalización con decisión
**Señales negativas:** duplicado sin decisión

**Aceptación:**
- Contenido fusionado sin pérdida
- Redirects configurados

---

## add_human_evidence

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | content |
| **WP modo** | HYBRID |
| **Next.js modo** | HYBRID |
| **Complejidad** | medium |
| **Riesgo** | high |
| **Gates** | G1, G2 |

**Pasos WordPress:**
- HM: Aportar caso/testimonio/datos reales (`input`)
- IA: Formatear contenido (`content_package`)
- HM: Insertar en la página (`wp_manual`)

**Pasos Next.js:**
- HM: Aportar caso/testimonio/datos reales (`input`)
- IA: Integrar en la página (`agent`)

**Señales:** testimonio · caso de éxito · caso real · reseña · evidencia humana

**Aceptación:**
- Sin input → no arranca
- Material real verificable

---

## security_fix

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | technical |
| **WP modo** | MANUAL |
| **Next.js modo** | HYBRID |
| **Complejidad** | medium |
| **Riesgo** | high |
| **Gates** | G1, G2 |

**Pasos WordPress:**
- HM: Actualizar plugins/tema/fix (`wp_manual`)

**Pasos Next.js:**
- IA: Aplicar fix de seguridad (`agent`)
- HM: Verificar fix (`review`)

**Señales:** seguridad · vulnerabilidad · security · XSS · CORS · headers

**Aceptación:**
- Hallazgo resuelto
- Sin regresiones

---

## other

| Campo | Valor |
|---|---|
| **Clase** | execution |
| **Categoría** | technical |
| **WP modo** | MANUAL |
| **Next.js modo** | MANUAL |
| **Complejidad** | medium |
| **Riesgo** | low |
| **Gates** | G1, G2 |

**Pasos WordPress:**
- HM: Ejecutar manualmente (`wp_manual`)

**Pasos Next.js:**
- HM: Ejecutar manualmente (`terminal`)


**Aceptación:**
- Tarea completada según el objetivo

---

## Aliases deprecados

| Alias | → Canónico | Nota |
|---|---|---|
| `edit_page_widgets` | `edit_page_text` |  |
| `create_landing_from_template` | `create_landing` |  |
| `update_post` | *(requiere contexto)* | update_post → refresh_content si es blog, else other |
| `upload_media` | `add_image` |  |
| `generate_image` | `add_image` |  |
| `verify_tracking` | `verify_analytics` |  |
