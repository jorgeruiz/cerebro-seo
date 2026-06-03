# Design System — Click Society Dark UI

Usa este documento para aplicar el mismo sistema de diseño del Dashboard Financiero a cualquier aplicación web. Cópialo completo y pásaselo a Claude con la instrucción: **"Aplica este design system al proyecto"**.

---

## Fuentes

```html
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@500;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
```

| Variable     | Fuente          | Uso                                      |
|--------------|-----------------|------------------------------------------|
| `--fd`       | Syne            | Títulos, KPIs, headings grandes          |
| `--fb`       | Inter           | Cuerpo, párrafos, labels normales        |
| `--fm`       | JetBrains Mono  | Etiquetas técnicas, montos, metadatos    |

---

## Tokens de color

```css
:root {
  /* Fondos */
  --bg:      #0a0a08;   /* fondo global */
  --surface: #1a1a16;   /* cards, paneles */
  --s2:      #242420;   /* superficie elevada (hover, accordion) */
  --s3:      #121210;   /* sidebar, inputs */

  /* Bordes y separadores */
  --line:    #2a2a26;

  /* Texto */
  --cream:   #ede8d8;   /* texto primario */
  --dim:     #c9c4b5;   /* texto secundario */
  --muted:   #7a766b;   /* texto apagado, labels, metadatos */

  /* Acento principal */
  --green:   #7fc15e;   /* verde activo, CTA, highlights */
  --gd:      #5e8a4a;   /* verde oscuro (bordes, hover) */
  --gg:      rgba(127,193,94,.10); /* verde translúcido (fondos activos) */

  /* Semánticos */
  --orange:  #e88c4a;   /* advertencia suave, montos llamativos */
  --red:     #e05a4a;   /* error, alerta crítica */
  --yellow:  #e8c44a;   /* advertencia media */
  --blue:    #5ea8e0;   /* informativo */

  /* Misc */
  --r: .75rem;          /* border-radius estándar */
}
```

---

## Reset base

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  background: var(--bg);
  color: var(--cream);
  font-family: var(--fb);
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
```

---

## Layout: Sidebar + Main

Estructura de dos columnas: sidebar fija a la izquierda, contenido principal a la derecha.

```css
body { display: flex; }

/* Sidebar */
.sb {
  width: 240px;
  min-width: 240px;
  height: 100vh;
  position: sticky;
  top: 0;
  background: var(--s3);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  flex-shrink: 0;
}

/* Contenido principal */
.main {
  flex: 1;
  min-width: 0;
  padding: 0 36px 100px;
}

/* Responsive */
@media (max-width: 700px) {
  body { flex-direction: column; }
  .sb { width: 100%; height: auto; position: static; }
  .main { padding: 0 16px 60px; }
}
```

### Componentes de sidebar

```css
/* Logo / branding */
.sb-logo  { padding: 24px 20px 18px; border-bottom: 1px solid var(--line); }
.sb-brand { font-family: var(--fd); font-size: .85rem; font-weight: 700; color: var(--cream); }
.sb-sub   { font-family: var(--fm); font-size: .58rem; color: var(--muted); margin-top: 2px; }

/* Encabezado de grupo en sidebar */
.sb-section {
  padding: 16px 20px 8px;
  font-family: var(--fm);
  font-size: .56rem;
  color: var(--muted);
  letter-spacing: .1em;
  text-transform: uppercase;
}

/* Botón de filtro/selección */
.mb {
  display: block; width: 100%; text-align: left;
  background: none; border: none; cursor: pointer;
  font-family: var(--fm); font-size: .7rem; color: var(--muted);
  padding: 8px 20px;
  border-left: 2px solid transparent;
  transition: all .15s;
}
.mb:hover { color: var(--cream); background: rgba(255,255,255,.03); }
.mb.on    { color: var(--green); border-left-color: var(--green); background: var(--gg); }
.mb-meta  { font-size: .58rem; color: var(--muted); margin-top: 1px; display: block; }
.mb.on .mb-meta { color: var(--gd); }

/* Link de navegación */
.nb {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 20px;
  font-family: var(--fm); font-size: .68rem; color: var(--muted);
  cursor: pointer; border-left: 2px solid transparent;
  transition: all .15s; text-decoration: none;
}
.nb:hover  { color: var(--cream); background: rgba(255,255,255,.03); }
.nb.active { color: var(--cream); border-left-color: var(--green); }
.nb-dot    { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }

/* Footer de sidebar */
.sb-foot {
  margin-top: auto; padding: 14px 20px;
  border-top: 1px solid var(--line);
  font-family: var(--fm); font-size: .56rem; color: var(--muted); line-height: 1.8;
}
```

---

## Tipografía de página

```css
/* Header de página */
.pg-hdr {
  padding: 32px 0 0;
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 16px; flex-wrap: wrap;
}
.pg-title {
  font-family: var(--fd);
  font-size: clamp(1.8rem, 3vw, 2.8rem);
  font-weight: 800;
  letter-spacing: -.02em;
  line-height: 1.05;
}
.pg-sub  { font-family: var(--fm); font-size: .62rem; color: var(--muted); margin-top: 6px; }
.pg-meta { font-family: var(--fm); font-size: .62rem; color: var(--muted); line-height: 2; }
.pg-meta span { color: var(--dim); }

/* Badge/etiqueta pill */
.badge {
  display: inline-block;
  background: var(--gg); border: 1px solid var(--gd); color: var(--green);
  font-family: var(--fm); font-size: .65rem;
  padding: 3px 12px; border-radius: 20px;
}
```

---

## Secciones

```css
.sec { margin-top: 48px; scroll-margin-top: 24px; }

/* Encabezado de sección con línea decorativa */
.sec-hdr {
  font-family: var(--fm); font-size: .6rem; color: var(--muted);
  letter-spacing: .1em;
  margin-bottom: 20px;
  display: flex; align-items: center; gap: 10px;
}
.sec-hdr::before { content: '//'; color: var(--green); }
.sec-hdr::after  { content: ''; flex: 1; height: 1px; background: var(--line); }
```

Uso en HTML:
```html
<section class="sec" id="mi-seccion">
  <div class="sec-hdr">TÍTULO DE SECCIÓN</div>
  <!-- contenido -->
</section>
```

---

## KPIs / Métricas

```css
.kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
.kpi {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r); padding: 16px 18px;
}
.kpi.hl { background: var(--gg); border-color: var(--gd); } /* destacado */

.kpi-lbl { font-family: var(--fm); font-size: .58rem; color: var(--muted); letter-spacing: .08em; margin-bottom: 6px; }
.kpi-val { font-family: var(--fd); font-size: 1.65rem; font-weight: 800; letter-spacing: -.02em; line-height: 1; }

/* Colores semánticos en valor */
.kpi-val.g { color: var(--green); }
.kpi-val.o { color: var(--orange); }
.kpi-val.r { color: var(--red); }
.kpi-val.b { color: var(--blue); }
```

Uso en HTML:
```html
<div class="kpi-row">
  <div class="kpi hl">
    <div class="kpi-lbl">INGRESOS MES</div>
    <div class="kpi-val g">$84,500</div>
  </div>
  <div class="kpi">
    <div class="kpi-lbl">EGRESOS</div>
    <div class="kpi-val o">$62,300</div>
  </div>
</div>
```

---

## Cards

```css
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 22px; }
.card + .card { margin-top: 16px; }
.card-t { font-family: var(--fd); font-weight: 700; font-size: .9rem; color: var(--cream); margin-bottom: 3px; }
.card-s { font-family: var(--fm); font-size: .58rem; color: var(--muted); margin-bottom: 14px; }

/* Contenedor de gráfica */
.ch-wrap { position: relative; }
.ch-wrap.h180 { height: 180px; }
.ch-wrap.h240 { height: 240px; }
.ch-wrap.h300 { height: 300px; }
```

---

## Grids de 2 columnas

```css
.cols-2  { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.cols-32 { display: grid; grid-template-columns: 1.6fr 1fr; gap: 20px; } /* izq más ancha */

@media (max-width: 900px) {
  .cols-2, .cols-32 { grid-template-columns: 1fr; }
}
```

---

## Accordion (categoría → detalle)

```css
.grupo-list  { display: flex; flex-direction: column; gap: 5px; }
.grupo-item  { background: var(--s2); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.grupo-hdr   { display: flex; align-items: center; gap: 9px; padding: 9px 12px; cursor: pointer; user-select: none; transition: background .12s; }
.grupo-hdr:hover { background: rgba(255,255,255,.03); }
.grupo-dot   { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; } /* color inline */
.grupo-nombre { flex: 1; font-size: .8rem; color: var(--dim); }
.grupo-total  { font-family: var(--fm); font-size: .75rem; color: var(--cream); font-weight: 600; }
.grupo-pct    { font-family: var(--fm); font-size: .58rem; color: var(--muted); margin-left: 5px; min-width: 36px; text-align: right; }
.chev         { flex-shrink: 0; transition: transform .2s; color: var(--muted); }

/* Barra de progreso debajo del header */
.grupo-bar-outer { height: 2px; background: var(--line); margin: 0 12px; border-radius: 1px; }
.grupo-bar-inner { height: 100%; border-radius: 1px; } /* width y background inline */

/* Lista de comercios colapsable */
.grupo-merchants      { display: none; padding: 4px 12px 10px; }
.grupo-merchants.open { display: block; }
.merchant-row         { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--line); font-size: .76rem; }
.merchant-row:last-child { border-bottom: none; }
.merchant-nombre      { color: var(--dim); flex: 1; min-width: 0; }
.merchant-bar-wrap    { width: 80px; height: 3px; background: var(--line); border-radius: 1px; flex-shrink: 0; }
.merchant-bar-fill    { height: 100%; border-radius: 1px; }
.merchant-monto       { font-family: var(--fm); font-size: .72rem; color: var(--cream); font-weight: 600; min-width: 64px; text-align: right; }
```

JavaScript mínimo para el toggle:
```js
document.querySelectorAll('.grupo-hdr').forEach(hdr => {
  hdr.addEventListener('click', () => {
    const merchants = hdr.closest('.grupo-item').querySelector('.grupo-merchants');
    const chev = hdr.querySelector('.chev');
    merchants.classList.toggle('open');
    if (chev) chev.style.transform = merchants.classList.contains('open') ? 'rotate(180deg)' : '';
  });
});
```

---

## Alertas / Conclusiones con borde lateral

```css
/* Genérico con variante por tipo */
.concl-list { display: flex; flex-direction: column; gap: 14px; }
.concl {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r); padding: 20px 22px;
}
.concl.positivo { border-left: 3px solid var(--green); }
.concl.warn     { border-left: 3px solid var(--yellow); }
.concl.info     { border-left: 3px solid var(--blue); }

.concl-t { font-family: var(--fd); font-size: .9rem; font-weight: 700; color: var(--cream); margin-bottom: 4px; }
.concl-m { font-family: var(--fm); font-size: .68rem; margin-bottom: 8px; }
.concl.positivo .concl-m { color: var(--green); }
.concl.warn     .concl-m { color: var(--yellow); }
.concl.info     .concl-m { color: var(--blue); }
.concl-d { font-size: .82rem; color: var(--dim); line-height: 1.7; }

/* Resumen box (fondo verde tenue) */
.resumen-box {
  background: var(--gg); border: 1px solid var(--gd);
  border-radius: var(--r); padding: 20px 22px; margin-bottom: 20px;
}
.resumen-box p { font-size: .85rem; color: var(--dim); line-height: 1.75; }
```

---

## Tabla

```css
.tbl { width: 100%; border-collapse: collapse; font-size: .78rem; }
.tbl th {
  font-family: var(--fm); font-size: .56rem; color: var(--muted);
  letter-spacing: .08em; text-align: left;
  padding: 8px 10px; border-bottom: 1px solid var(--line);
}
.tbl td { padding: 7px 10px; border-bottom: 1px solid var(--line); color: var(--dim); }
.tbl td.mono  { font-family: var(--fm); font-size: .7rem; }
.tbl td.monto { font-family: var(--fm); font-size: .74rem; color: var(--cream); font-weight: 600; text-align: right; white-space: nowrap; }
.tbl tr:last-child td { border-bottom: none; }
.tbl tbody tr:hover td { background: var(--s2); }
```

---

## Inputs y botones

```css
/* Select */
.asel {
  background: var(--s3); border: 1px solid var(--line); color: var(--dim);
  border-radius: 4px; padding: 3px 6px;
  font-family: var(--fm); font-size: .6rem; width: 100%;
}

/* Input de texto */
.ainp {
  background: var(--s3); border: 1px solid var(--line); color: var(--dim);
  border-radius: 4px; padding: 3px 8px;
  font-family: var(--fm); font-size: .6rem; width: 100%;
}

.asel:focus, .ainp:focus { outline: none; border-color: var(--gd); }

/* Input de búsqueda (más grande) */
.search-inp {
  background: var(--s3); border: 1px solid var(--line); color: var(--cream);
  border-radius: 5px; padding: 7px 12px;
  font-family: var(--fm); font-size: .68rem;
}
.search-inp:focus { outline: none; border-color: var(--gd); }

/* Botón primario */
.btn-p {
  background: var(--cream); color: var(--bg);
  border: none; border-radius: 6px;
  padding: 9px 18px;
  font-family: var(--fm); font-size: .7rem; font-weight: 600;
  cursor: pointer; transition: background .15s;
}
.btn-p:hover { background: var(--green); }
```

---

## Configuración recomendada de Chart.js

```js
Chart.defaults.color = '#7a766b';           // --muted
Chart.defaults.borderColor = '#2a2a26';     // --line
Chart.defaults.font.family = "'JetBrains Mono', monospace";
Chart.defaults.font.size = 11;

// Opciones base reutilizables
const BASE_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#1a1a16',
      borderColor: '#2a2a26',
      borderWidth: 1,
      titleColor: '#ede8d8',
      bodyColor: '#c9c4b5',
      titleFont: { family: "'Syne', sans-serif", weight: '700' },
      bodyFont:  { family: "'JetBrains Mono', monospace", size: 11 },
      callbacks: {
        label: ctx => ` $${ctx.parsed.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`
      }
    }
  }
};
```

---

## IntersectionObserver para nav activa en sidebar

```js
const sections = document.querySelectorAll('.sec');
const navLinks = document.querySelectorAll('.nb');

const obs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
    }
  });
}, { rootMargin: '-30% 0px -60% 0px' });

sections.forEach(s => obs.observe(s));
```

---

## Paleta de colores para gráficas (categorías)

```js
// Colores por grupo semántico — usar en datasets de Chart.js
const COLORES = {
  // Negocio
  "Pauta · Google":      "#7fc15e",
  "Pauta · Facebook":    "#5ea8e0",
  "Pauta · TikTok":      "#e088c8",
  "IA · Tools":          "#a080e0",
  "Nómina":              "#e88c4a",
  "Hosting":             "#5ec8a0",
  "Marketing Tools":     "#78b8e0",
  "Productividad":       "#a8c890",
  "Freelancers":         "#c8a870",
  "Contador":            "#b0a8e0",
  // Personal
  "Comida · Delivery":   "#e05a4a",
  "Comida · Restaurante":"#e07848",
  "Comida · Fast Food":  "#e09050",
  "Compras · Amazon":    "#e8c44a",
  "Transporte":          "#78d0b8",
  "Salud":               "#78c8e0",
  "Suscripciones":       "#8890e0",
  "Telefonia":           "#b0c870",
  "Supermercado":        "#98c868",
};
```

---

## Estructura HTML mínima

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Mi App</title>
  <!-- Fuentes -->
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@500;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
  <!-- (opcional) Chart.js -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    /* pegar aquí los :root tokens + reset + clases que necesites */
  </style>
</head>
<body>

<aside class="sb">
  <div class="sb-logo">
    <div class="sb-brand">Mi App</div>
    <div class="sb-sub">subtítulo</div>
  </div>
  <!-- navegación, filtros... -->
</aside>

<div class="main">
  <div class="pg-hdr">
    <div>
      <h1 class="pg-title">Título Principal</h1>
      <p class="pg-sub">subtítulo de página</p>
    </div>
  </div>

  <section class="sec" id="seccion-1">
    <div class="sec-hdr">NOMBRE SECCIÓN</div>
    <!-- KPIs, cards, tablas... -->
  </section>
</div>

</body>
</html>
```
