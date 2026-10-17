# Catálogo de Tareas — Cerebro SEO

> Documento vivo. Define qué puede hacer el sistema (IA, Híbrido, Manual) por tipo de cliente.
> Las reglas fijas están aquí; los datos por sitio vienen de `/capabilities` y `/system-info`
> (WordPress) o de `docs/site-spec.md` + `CLAUDE.md` (Next.js).
>
> Actualizar cuando: cambie la versión del plugin WP, se agregue un endpoint nuevo,
> o cambie el stack de los sitios Next.js.

---

## WordPress — Plugin Cerebro v1.5.0

### Endpoints del plugin
Base: `https://{dominio}/wp-json/clicksociety/v1/`
Auth: header `X-Cerebro-Key: {wpApiKey}` (guardado en Site.wpApiKey)

**Lectura (disponibles en v1.5.0):**
| Endpoint | Qué devuelve |
|---|---|
| `GET /capabilities` | Qué puede hacer el plugin en este sitio (lista de endpoints activos) |
| `GET /pages` | Árbol de páginas del sitio |
| `GET /elementor/{id}` | Árbol simplificado de una página Elementor: textos, imágenes, links, headings con sección/widget/texto actual |
| `GET /templates` | Global widgets y template insertions de Elementor |

**Escritura (disponibles en v1.5.0):**
| Endpoint | Qué hace |
|---|---|
| `POST /publish` | Crea artículo de blog (borrador o publicado) |
| `PUT /update/{id}` | Edita contenido de un post existente |
| `POST /media` | Sube imagen con alt text |
| `POST /seo/{id}` | Actualiza meta Yoast: title, description, focus keyword (posts y páginas) |

**Pendiente (WP3 — no disponible aún):**
- Editar widgets de Elementor directamente
- Crear páginas desde plantilla

**Endpoint faltante — agregar en próxima versión del plugin:**
`GET /system-info` — lista de plugins activos con versión, tema activo, versión de PHP.
Formato esperado:
```json
{
  "plugins": [
    { "slug": "elementor", "name": "Elementor", "version": "3.x.x", "active": true },
    { "slug": "yoast-seo", "name": "Yoast SEO", "version": "22.8", "active": true },
    { "slug": "wp-rocket", "name": "WP Rocket", "version": "3.x.x", "active": true }
  ],
  "theme": { "name": "Hello Elementor", "version": "3.x.x" },
  "elementor_version": "3.x.x",
  "php_version": "8.x"
}
```

### Stack base confirmado (9 sitios Click Society)
- Elementor Pro con contenedores V3 en todos
- Yoast SEO en todos (versiones 22.8 a 28.6)
- Hello Elementor en casi todos (Ayrisa usa Astra)
- Plugins de caché e imágenes: desconocidos hasta que /system-info esté disponible

---

### Tareas WordPress — modo AI
El agente llama directamente al plugin. Criterio: el plugin tiene endpoint de escritura para esa acción.

| Actividad | Endpoint | Notas |
|---|---|---|
| Crear artículo de blog | `POST /publish` | Siempre como borrador para revisión del cliente |
| Meta title + meta description | `POST /seo/{id}` | Posts y páginas via Yoast |
| Focus keyword Yoast | `POST /seo/{id}` | |
| Subir imagen nueva con alt | `POST /media` | El alt debe ser descriptivo y con keyword |
| Actualizar post existente (texto, H1-H2) | `PUT /update/{id}` | Solo posts, no páginas Elementor |

### Tareas WordPress — modo HUMAN (guiado)
El agente no puede ejecutar directamente. Genera instrucciones precisas leyendo
`GET /elementor/{id}` para ubicar cada widget con exactitud.

El prompt de cada paso HUMAN debe incluir:
1. La URL de WP Admin donde hacer el cambio
2. La ruta dentro de Elementor (sección > columna > widget)
3. El texto actual (leído de /elementor/{id})
4. El texto final listo para pegar

| Actividad | Cómo |
|---|---|
| H1, H2, textos en páginas Elementor | WP Admin > página > Editar con Elementor > ubicar widget con datos de /elementor/{id} |
| Imágenes dentro de páginas Elementor | Elementor > Widget Image |
| CTAs, botones | Elementor > Widget Button |
| Landings nuevas | Elementor desde plantilla o blank (WP3: se automatiza) |
| Header, footer, global widgets | Elementor Theme Builder > Header/Footer |
| Performance | Revisar en pagespeed.web.dev > corregir con plugin de caché/imágenes del sitio |
| Plugins (instalar, configurar) | WP Admin > Plugins |
| Tema, CSS personalizado | WP Admin > Apariencia > Personalizar > CSS Adicional |

### Catálogo dinámico
**El catálogo se construye por sitio llamando `GET /capabilities`.**
Cuando el plugin gane capacidades (Elementor escritura en WP3), las tareas pasan
automáticamente a AI sin cambiar el código — Claude lee /capabilities y decide.

---

## Next.js — Stack Click Society

### Stack confirmado
- App Router (Next.js 14+)
- Blog en MDX: `content/blog/` (formato publish-blog-article)
- Deploy en Vercel (preview automático por rama del plan)
- Detalles de cada sitio en: `docs/site-spec.md`, `CLAUDE.md`, `DESIGN.md` del repo

### Capacidades del agente en terminal
El agente (Claude Agent SDK + terminal de Cerebro SEO) puede:
- Leer múltiples archivos y razonar sobre su contenido antes de modificar
- Editar/crear archivos: TypeScript, TSX, MDX, JSON, MD
- Ejecutar comandos y reaccionar a su output:
  - `npm run build` — verificar compilación sin errores
  - `npm run lint` — calidad de código
  - `npx sharp` — convertir/optimizar imágenes
  - `npx svgo` — optimizar SVGs
  - `git status`, `git diff`, `git log`
- Mantener coherencia entre múltiples archivos en un paso
- Verificar automáticamente el resultado (build pass = tarea verificada)

### Criterio AI / HYBRID / HUMAN para Next.js

| Modo | Criterio | Verificación automática |
|---|---|---|
| **AI** | Resultado verificable con build + guard (no placeholders) | Sí — build pasa, guard no encuentra huecos |
| **HYBRID** | Requiere inspección visual o datos del cliente antes/después | No — requiere ojo humano |
| **HUMAN** | Requiere decisión humana o datos que solo el cliente tiene | No aplica |

### Tareas Next.js — modo AI
| Actividad | Archivos típicos |
|---|---|
| Artículo de blog nuevo | `content/blog/slug.mdx` (frontmatter + cuerpo) |
| Optimizar H1/título de artículo existente | Frontmatter MDX |
| Meta title + meta description de página | `metadata` en `page.tsx` o layout |
| Schema JSON-LD (Article, LocalBusiness, FAQ) | Componente schema en `page.tsx` |
| Interlinking — agregar enlaces internos | Artículos MDX existentes |
| Alt de imágenes en componentes | `<Image alt="...">` en TSX |
| Breadcrumbs schema | Componente de layout |
| Open Graph tags | `metadata.openGraph` en `page.tsx` |

### Tareas Next.js — modo HYBRID
| Actividad | Qué requiere verificación visual |
|---|---|
| Optimización de imágenes (peso, formato WebP) | Lighthouse LCP antes/después |
| Lazy loading de componentes pesados | Lighthouse LCP antes/después |
| Code splitting, reducción de bundle | Lighthouse TBT antes/después |
| Cambios de layout, tipografía, espaciado | Inspección visual — riesgo de regresión |
| Carga de fonts (subset, display:swap) | Lighthouse FCP antes/después |

### Tareas Next.js — modo HUMAN
| Actividad | Por qué manual |
|---|---|
| Fotos reales del cliente, casos de éxito | No inventar datos factuales |
| Precios, especificaciones técnicas | Requiere confirmación del cliente |
| Testimonios, nombres de clientes | Requieren fuente real |
| GSC, GA4, GBP, Google Ads | Acceso a cuenta externa |
| Decisiones de diseño visual | Criterio humano, no automatizable |
| Certificaciones, premios, credenciales | Datos verificables solo por el cliente |

---

## Gate de memoria (precondición de ejecución)

### Next.js
El worker verifica antes de ejecutar un paso AI:
- **CODE**: requiere `docs/site-spec.md`, `docs/site-map.md`, `docs/site-state.md`
- **CONTENT**: requiere los anteriores + `docs/catalog-schemas.md`
- Si faltan: tarea → WAITING_HUMAN con instrucción de qué archivo crear

### WordPress
El decomposer verifica antes de generar pasos:
- Llama `GET /capabilities` para confirmar endpoints disponibles (usa wpApiKey del Site)
- Para pasos HUMAN de Elementor: llama `GET /elementor/{id}` para localizar widgets exactos
- Si /capabilities no responde o no hay wpApiKey: usa catálogo estático v1.5 como fallback
- Cuando /system-info esté disponible: lo incluye para adaptar instrucciones al stack real

---

## Historial de versiones del plugin WP

| Versión | Capacidades |
|---|---|
| v1.5.0 | POST /publish, PUT /update, POST /media, POST /seo — blog y meta AI |
| WP3 (pendiente) | Editar widgets Elementor, crear páginas desde plantilla |
