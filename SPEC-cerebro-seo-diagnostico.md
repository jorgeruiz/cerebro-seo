# Spec — Endpoint de diagnóstico público (repo: Cerebro SEO)

## Objetivo
Exponer un endpoint interno que reciba un dominio arbitrario (dominio "frío", no cliente registrado) y devuelva un diagnóstico SEO ligero. Lo consume la landing de `click-society-web` a través de su propio backend (server-to-server), nunca desde el browser.

## Contexto ya existente (NO reimplementar)
En `src/server/providers/dataforseo.ts` existe el singleton `dataForSeoProvider` con estos métodos ya funcionales:
- `getDomainRankOverview(domain)` → `{ domain, domainRank, rankedKeywords, estimatedTraffic }` (~$0.02, endpoint DataForSEO Labs `domain_rank_overview`)
- `getBacklinksSummary(domain)` → `{ total, referringDomains, domainAuthority }` (~$0.02)

Ambos degradan gracefully sin Redis ni Prisma. Credenciales `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` validadas en `src/env.ts`.

Patrón de auth interno ya establecido: `Bearer ${process.env.SEO_INTERNAL_SECRET}`.

## Construir

### 1. Endpoint: `src/app/api/internal/diagnostico/route.ts`
- Método: `POST`
- Auth: header `Authorization: Bearer <SEO_INTERNAL_SECRET>`. Si falta o no coincide → `401`.
- Request body: `{ "domain": string }`
- Normalizar el dominio antes de usarlo: quitar protocolo, `www.`, path, query y trailing slash. Rechazar con `400` si tras normalizar no parece un dominio válido (regex simple `^[a-z0-9.-]+\.[a-z]{2,}$`).
- Ejecutar en paralelo (`Promise.allSettled`, no `all` — un fallo parcial no debe tumbar todo):
  - `dataForSeoProvider.getDomainRankOverview(domain)`
  - `dataForSeoProvider.getBacklinksSummary(domain)`
- Respuesta `200`:
```json
{
  "domain": "ejemplo.com",
  "rankedKeywords": 42,
  "estimatedTraffic": 310,
  "domainRank": 180,
  "backlinks": { "total": 55, "referringDomains": 12, "domainAuthority": 18 }
}
```
- Reglas anti-cero: si un valor viene `null`, `undefined` o `0` sospechoso, devolverlo como `null` (NO como `0`). El consumidor decide cómo mostrarlo. No inventar valores.
- Manejo de error: si ambas llamadas fallan → `502` con `{ error: "diagnostico_failed" }`. Si una falla, devolver la otra y poner `null` en la que falló.

### 2. (Opcional, solo si se quiere "top keywords" y posición promedio)
Agregar método `getRankedKeywords(domain, limit = 10)` a `DataForSeoProvider` usando el endpoint DataForSEO Labs `/dataforseo_labs/google/ranked_keywords/live` (~$0.05). Devuelve `{ topKeywords: [{ keyword, position, searchVolume }], avgPosition }`.
- **Recomendación:** dejar esto FUERA del MVP. El diagnóstico simple (overview + backlinks) ya da el panorama sin el costo extra ni el riesgo de respuestas vacías. Incluirlo solo si Jorge lo pide explícitamente después.

## Fuera de alcance (lo maneja click-society-web)
- El componente AEO/GEO (scrape + inferencia con Haiku) NO va aquí. Va en el backend de la landing, porque necesita orquestar scrape + Anthropic y no depende de DataForSEO.
- Rate limiting: se aplica en el backend de la landing (capa pública), no aquí. Este endpoint confía en el Bearer.

## Variables de entorno
Confirmar que `SEO_INTERNAL_SECRET` existe en el `.env` de Cerebro SEO y compartirlo (mismo valor) con `click-society-web`.
