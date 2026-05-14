/**
 * TEMPORAL — lectura directa a Notion para sembrar clientes en Fase 1.
 * Reemplazar por cerebro-bridge.ts cuando Cerebro web exponga GET /api/internal/seo/clients.
 * Issue de seguimiento: migrar en Fase 2 junto con clientesRouter tRPC.
 */
import { Client as NotionClient } from "@notionhq/client";
import type {
  PageObjectResponse,
  PartialPageObjectResponse,
  PartialDataSourceObjectResponse,
  DataSourceObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";

type QueryResult =
  | PageObjectResponse
  | PartialPageObjectResponse
  | PartialDataSourceObjectResponse
  | DataSourceObjectResponse;

const notion = new NotionClient({ auth: process.env.NOTION_API_KEY });

// Base de datos "Clientes Actuales" en Notion — compartir con integración
// ID de integración: 32b0a146-5e52-81f9-8509-0027c0a09cd7
const DB_ID = "e489c63e-4edf-4820-aa73-1e59f6f99944";

// Mapeo de valores de Notion al slug normalizado que va en Client.services
const SERVICE_SLUG_MAP: Record<string, string> = {
  "SEO":          "seo",
  "Google Ads":   "google_ads",
  "Meta Ads":     "meta_ads",
  "Contenidos":   "contenidos",
};

function toServiceSlug(notionValue: string): string {
  const mapped = SERVICE_SLUG_MAP[notionValue];
  if (!mapped) {
    const auto = notionValue.toLowerCase().replace(/\s+/g, "_");
    console.warn(`[notion-direct] Valor de servicio sin mapeo: "${notionValue}" → slug automático: "${auto}"`);
    return auto;
  }
  return mapped;
}

export interface SeededClient {
  notionPageId: string;
  name: string;
  domain: string;
  gscProperty: string | null;    // ej: "sc-domain:ejemplo.mx" o "https://www.ejemplo.mx/"
  ga4PropertyId: string | null;  // ej: "123456789" (solo el número)
  services: string[];            // slugs normalizados: ["seo", "google_ads", ...]
}

type NotionPropertyValue = PageObjectResponse["properties"][string];

function extractText(prop: NotionPropertyValue | undefined): string {
  if (!prop) return "";
  if (prop.type === "title") return prop.title?.[0]?.plain_text ?? "";
  if (prop.type === "rich_text") return prop.rich_text?.[0]?.plain_text ?? "";
  if (prop.type === "url") return prop.url ?? "";
  if (prop.type === "email") return prop.email ?? "";
  return "";
}

function isFullPage(result: QueryResult): result is PageObjectResponse {
  return result.object === "page" && "properties" in result;
}

export async function getClientsWithSeoActive(): Promise<SeededClient[]> {
  // Nota v5: databases.query → dataSources.query, database_id → data_source_id
  const response = await notion.dataSources.query({
    data_source_id: DB_ID,
    filter: {
      property: "Estado",
      select: { equals: "Activo" },
    },
  });

  return response.results
    .filter(isFullPage)
    .map((page) => {
      const props = page.properties;

      const name = extractText(props["Name"]) || "Sin nombre";

      // Derivar dominio desde la URL de Search Console
      const gscRaw = extractText(props["Search Console URL"]);
      let domain = "";
      if (gscRaw) {
        if (gscRaw.startsWith("sc-domain:")) {
          domain = gscRaw.replace("sc-domain:", "");
        } else {
          try {
            domain = new URL(gscRaw).hostname;
          } catch {
            domain = gscRaw;
          }
        }
      }

      const gscProperty = gscRaw || null;

      const ga4PropertyId = extractText(props["GA4 Property ID"]) || null;

      // Servicios contratados — campo "Servicio" (multi_select) en Notion
      const serviceProp = props["Servicio"];
      const services: string[] =
        serviceProp?.type === "multi_select"
          ? serviceProp.multi_select.map((s) => toServiceSlug(s.name))
          : [];

      return {
        notionPageId: page.id.replace(/-/g, ""),
        name,
        domain,
        gscProperty: gscProperty || null,
        ga4PropertyId: ga4PropertyId || null,
        services,
      };
    });
}
