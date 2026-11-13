# Sesión F2 — Paquetes de infraestructura (primero: `blog_bootstrap`)

> Correr solo cuando la Fase 1 cumpla su criterio de salida: el set de pruebas con más del 90% correcto y un plan real ejecutado sin pasos inventados.

## Contexto
Spec: `docs/plan-mensual/catalogo-v2-spec.md`, secciones 9.1 y 9.2. Las categorías ya existen en el catálogo desde F1a. Ahora se agregan los **paquetes**: instalaciones idempotentes por sitio. Los blogs de Next.js han fallado porque los bootstraps no se habían corrido; este es el problema que resuelve la sesión.

## Parte 1 — Diagnóstico
- ¿Dónde vive hoy la lógica o el prompt del bootstrap de blog (y de landings y micrositios)? Puede estar en Constructor, en Cerebro SEO o en docs. ¿Qué pasos hace?
- ¿Cómo se detecta hoy que un sitio tiene bootstrap? (heading exacto `## Blog` + `**Estado:** Implementado` en `docs/catalog-schemas.md`; memory classifier).
- Estado actual de los sitios Next.js activos con SEO: tabla sitio → blog / landings / micrositios (instalado, pendiente o desconocido).

## Parte 2 — Implementación
1. **Modelo** `SitePackage(siteId, packageId, version, status, installedAt, verifiedAt, meta Json)`.
2. **Definición de paquetes** en `src/lib/plan/packages/`, con la interfaz `{ id, version, platforms, preflight, detect, install, verify, rollback }`.
3. **Paquete `blog_bootstrap` (Next.js):**
   - `preflight`: repo conectado + memoria FULL (spec/map/state).
   - `detect`: heading exacto + estado en `catalog-schemas.md` **y** la ruta /blog existe.
   - `install`: actionType `install_package` con pasos `agent` (alcance: estructura de blog, MDX, rutas, sitemap, `catalog-schemas.md`) y luego `review`.
   - `verify`: build OK, /blog responde en el preview, `detect` da verdadero.
   - `rollback`: `git revert` de los commits de la tarea.
4. **Agregar `install_package` al catálogo** (`category = infrastructure`). Su input es `packageId`.
5. **Planificador:** el Análisis Claude recibe el estado de los paquetes del sitio. Si falta `blog_bootstrap`, no propone `create_blog`; propone `install_package(blog_bootstrap)`. El gate G4 enlaza su `remedy` a ese paquete.
6. **UI:** sección "Paquetes del sitio" en la vista del cliente (instalado, pendiente, falló) con el botón "Agregar al plan". También un diagnóstico de preparación de todos los sitios Next.js activos con SEO, en una tabla.
7. Si el diagnóstico encontró lógica reutilizable para landings y micrositios, dejar `landing_bootstrap` y `microsite_bootstrap` definidos con la misma interfaz, pero **sin activarlos**. Reportar qué faltaría para activarlos.

## Fuera de alcance
La integración con el CRM y otros paquetes. La interfaz debe permitir agregarlos sin cambiarla.

## Cierre
Actualizar `project_state.md`, `architecture.md` y `project_spec.md`. Reportar commits, tests, la tabla de preparación por sitio y una instalación real probada en un sitio de prueba.
