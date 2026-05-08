# Cerebro SEO — API Providers Reference

> Referencia técnica de todos los servicios externos que consume Cerebro SEO.

**Última actualización:** 2026-05-07 (v2)

---

## 1. DataForSEO (provider primario de datos SEO)

### Setup
- **URL:** https://dataforseo.com
- **Auth:** Basic Auth (login + password en headers de cada request)
- **Modelo de pricing:** Pay-as-you-go — créditos no expiran
- **Estado de la cuenta:** ✅ Cuenta creada, $50 USD depositado, credenciales verificadas con llamada SERP de prueba exitosa el 07-may-2026. La validación de calidad de datos vs GSC (3 clientes × 5 keywords) se completará al implementar `DataForSeoProvider` en Fase 1.

### Endpoints que usaremos

| Endpoint | Uso | Costo aproximado |
|---|---|---|
| SERP API – Google Organic (Live) | Verificación rápida de ranking puntual | $0.002/req |
| SERP API – Google Organic (Standard Queue) | Tracking masivo programado | $0.0006/req |
| Backlinks API – Summary | Overview de backlinks de dominio | ~$0.05/req |
| Backlinks API – Live | Lista de backlinks con detalles | ~$0.10/req |
| DataForSEO Labs – Keyword Suggestions | Investigación de keywords | ~$0.01/req |
| DataForSEO Labs – Domain Rank Overview | Domain Authority equivalente | ~$0.02/req |
| DataForSEO Labs – Competitors | Identificar competidores orgánicos | ~$0.02/req |
| On-Page API – Audit | Auditoría técnica con su crawler | ~$0.001 por página |
| LLM Mentions / LLM Scraper | AI Search Visibility (ChatGPT, Gemini) | Pendiente cotización |

### Estrategia de uso para minimizar costos

1. **Siempre Standard Queue para tracking programado** (5 min de espera vs 2 segundos, 3.3x más barato).
2. **Live mode solo para queries on-demand del usuario** (cuando Félix consulta algo en tiempo real).
3. **Cache agresivo en Redis:**
   - Domain rank: 7 días
   - Backlinks bulk: 24 horas
   - Keyword volume: 30 días
   - Competitor analysis: 7 días
4. **Batch requests cuando sea posible:** 1,000 keywords en un POST cuesta lo mismo que ir uno por uno pero ahorra latencia.
5. **`ApiUsage` table** registra cada request con costo y `clientId` para detectar abusos o presupuesto excedido.

### Variables de entorno
```bash
DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
```

### Documentación
- API docs: https://docs.dataforseo.com/v3/
- Pricing: https://dataforseo.com/pricing-list
- Sandbox: gratis para testing

---

## 2. Google Search Console API

### Setup
- **OAuth 2.0** — heredamos la conexión existente de Cerebro.
- **Scope necesario:** `https://www.googleapis.com/auth/webmasters.readonly`

### Endpoints
- `GET /webmasters/v3/sites` — listar propiedades
- `POST /webmasters/v3/sites/{siteUrl}/searchAnalytics/query` — métricas de queries y páginas

### Datos que obtenemos
- Clics, impresiones, CTR, posición promedio
- Por query, por página, por dispositivo, por país, por fecha
- Histórico de hasta 16 meses

### Limitaciones
- Sampling en propiedades grandes (Google muestrea para queries con pocos resultados)
- Datos con delay de 2-3 días
- Quotas: 1,200 queries/min por propiedad, 25,000/día por proyecto OAuth

### Variables de entorno
```bash
# Misma OAuth credentials que Cerebro
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

---

## 3. Google Analytics 4 (GA4) Data API

### Setup
- **OAuth 2.0** — heredamos de Cerebro.
- **Scope necesario:** `https://www.googleapis.com/auth/analytics.readonly`

### Endpoints
- `analyticsdata.googleapis.com/v1beta/properties/{propertyId}:runReport`
- `analyticsdata.googleapis.com/v1beta/properties/{propertyId}:runRealtimeReport`

### Datos que obtenemos
- Sesiones, usuarios, tasa de rebote, duración de sesión
- Conversiones por evento
- Adquisición por canal (filtramos por orgánico)
- Páginas más visitadas
- Comportamiento por dispositivo/país

### Limitaciones
- 50,000 requests/día por propiedad
- Algunos datos requieren 24-48h para estar disponibles

---

## 4. PageSpeed Insights API

### Setup
- **API Key** simple, gratis.
- **URL:** `https://www.googleapis.com/pagespeedonline/v5/runPagespeed`

### Datos que obtenemos
- Lighthouse scores (Performance, Accessibility, Best Practices, SEO)
- Core Web Vitals (LCP, FID/INP, CLS)
- Field data (datos reales de usuarios via CrUX)
- Lab data
- Sugerencias de mejora

### Limitaciones
- 25,000 requests/día gratis
- Cada request tarda 5-15 segundos

### Variables de entorno
```bash
GOOGLE_PAGESPEED_API_KEY=
```

---

## 5. Anthropic Claude API

### Setup
- API key de Anthropic
- SDK oficial: `@anthropic-ai/sdk` v0.95+

### Casos de uso

| Caso | Modelo | Costo aproximado |
|---|---|---|
| Insights proactivos diarios (InsightsAgent) | `claude-sonnet-4-6` | ~$0.022/ejecución (con prompt caching) |
| Generación de reporte mensual (ReportAgent) | `claude-sonnet-4-6` | ~$0.13/reporte |
| Validación de hipótesis (CycleCloseAgent) | `claude-sonnet-4-6` | ~$0.034/cliente |
| Resumen ejecutivo de auditoría | `claude-haiku-4-5` | ~$0.001/resumen |
| Categorización rápida (issues, intent de keywords) | `claude-haiku-4-5` | ~$0.005/operación |
| Análisis estratégico inter-mensual (desde Cerebro chat) | `claude-opus-4-7` | Solo bajo demanda explícita |

### Estrategia
- **Sonnet 4.6** para análisis donde la calidad y el razonamiento causal importan.
- **Haiku 4.5** para síntesis de datos ya estructurados y clasificaciones masivas.
- **Opus 4.7** solo para análisis estratégicos solicitados explícitamente desde Cerebro. Nunca en jobs automáticos.
- **Prompt caching de 3 bloques** implementado en InsightsAgent: 75-80% de tokens desde caché → reducción de ~80% en costo vs sin caching.
- **Claude nunca recibe datos crudos:** siempre resúmenes pre-procesados algorítmicamente. Un audit de 500 páginas llega a Claude como ~200 tokens.

### Costo mensual estimado para 10 clientes

| Agente | USD/mes |
|---|---|
| InsightsAgent (diario × 10 clientes × 30 días) | $8-10 |
| ReportAgent (mensual × 10 clientes) | $1.30 |
| CycleCloseAgent (mensual × 10 clientes) | $0.34 |
| Haiku (audits, síntesis) | <$0.10 |
| **Total Claude** | **~$9-12 USD/mes** |

### Variables de entorno
```bash
ANTHROPIC_API_KEY=
```

---

## 6. Notion API (sync con Cerebro)

### Setup
- **Integration token** de Notion (heredado de Cerebro).
- Cerebro SEO tiene **solo lectura** sobre las bases relevantes; las escrituras pasan por Cerebro.

### Bases que leemos
| Base | Para qué |
|---|---|
| Clientes Actuales | Lista de clientes y datos básicos |
| Estrategia Mensual | Estrategia activa del mes |
| Tareas | Tareas activas a mostrar en panel cliente |
| Bitácora de Actividades | Eventos para timeline |

### Reglas aprendidas (de Cerebro)
- `notion-fetch` con UUID directo funciona bien
- Filtros por relación: stripear dashes del UUID
- Filtrar por campo `"Estado"`, no `"Status"`
- Tareas activas: nunca filtrar por fecha, siempre por estado

### Variables de entorno
```bash
NOTION_API_KEY=
```

---

## 7. Stack de proveedores opcional / a evaluar

### 7.1 AI Search Visibility (a definir en Fase 4)

Opciones a evaluar para tracking de presencia en respuestas de LLMs:

| Provider | Tipo | Notas |
|---|---|---|
| DataForSEO LLM APIs | API directa | Ya estaríamos integrados; soporta ChatGPT y Gemini |
| Profound | SaaS especializado | Más completo pero subscripción mensual |
| Otterly.AI | SaaS | Pricing competitivo |
| Peec AI | SaaS | Enfoque europeo |
| Stack propio | Self-built | Queries directas a APIs de OpenAI, Perplexity, etc. |

**Recomendación inicial:** empezar con DataForSEO LLM APIs por simplicidad de integración.

### 7.2 Storage de PDFs (reportes mensuales)

| Opción | Pros | Contras |
|---|---|---|
| Cloudflare R2 | Más barato que S3, sin egress fees | Setup adicional |
| Filesystem local del VPS | Cero costo | Backup manual, no escalable |
| Supabase Storage | Generoso free tier | Otra dependencia |

**Recomendación:** Cloudflare R2. Confirmar al implementar ReportAgent en Fase 4.

---

## 8. Resumen de costos para 10 clientes

| Proveedor | Costo mensual estimado |
|---|---|
| DataForSEO | $20–35 |
| Google Search Console | $0 |
| Google Analytics 4 | $0 |
| PageSpeed Insights | $0 |
| Claude API | $9–12 |
| Notion API | $0 (incluido en plan Notion) |
| Cloudflare R2 (PDFs) | $0–2 |
| **Total** | **$29–49 USD/mes** |

**Costo amortizado por cliente:** ~$3-5 USD/mes. Margen amplio vs revenue por cliente.

Estimación parcialmente validada con llamada SERP real a DataForSEO (07-may-2026). La validación completa con datos de 3 clientes reales se completará al implementar `DataForSeoProvider` en Fase 1.

---

## 9. Alertas de costo

Implementar en monitoreo de `ApiUsage`:
- Alerta diaria si gasto del día > $5 (umbral inusual)
- Alerta mensual cuando un cliente acumula > $15 (probablemente algo está mal)
- Alerta global si proyección mensual excede $100
- Dashboard de costos visible solo para ADMIN
