/**
 * Generador de contenido SEO con Claude.
 *
 * Produce artículos de blog y landing pages completas en markdown
 * listos para publicar en Constructor.
 */

import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "@/lib/anthropic-config";

const anthropic = new Anthropic();

// ─── Blog ────────────────────────────────────────────────────────────────────

export interface GeneratedBlogPost {
  titulo: string;
  extracto: string;
  cuerpo: string;
  categoria: string;
  tags: string;
}

export async function generateBlogPost(params: {
  stepTitle: string;
  stepDescription: string;
  clientName: string;
  clientDomain: string;
}): Promise<GeneratedBlogPost> {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: `Eres un redactor SEO experto para la agencia Click Society. Redacta un artículo de blog completo en español para el sitio ${params.clientDomain} (${params.clientName}).

Instrucciones del plan SEO:
- Título sugerido: ${params.stepTitle}
- Contexto: ${params.stepDescription}

Requisitos:
1. El artículo debe tener entre 800-1500 palabras
2. Escrito en markdown limpio (headers ##, listas, negritas)
3. Optimizado para SEO: keyword natural en título, headers, primer párrafo
4. Tono profesional pero accesible
5. Incluir una introducción enganchadora y una conclusión con CTA
6. NO inventar datos estadísticos ni cifras específicas
7. NO incluir el título como H1 (Constructor lo agrega automáticamente)

Responde SOLO con un JSON válido (sin markdown code fence) con esta estructura:
{
  "titulo": "Título del artículo (60-70 chars ideal)",
  "extracto": "Meta description SEO (max 155 chars)",
  "cuerpo": "Contenido completo en markdown...",
  "categoria": "Categoría sugerida (ej: Guías, Tips, Noticias)",
  "tags": "tag1, tag2, tag3"
}`,
    }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  try {
    const parsed = JSON.parse(text) as GeneratedBlogPost;
    return {
      titulo: parsed.titulo || params.stepTitle,
      extracto: (parsed.extracto || "").slice(0, 160),
      cuerpo: parsed.cuerpo || "",
      categoria: parsed.categoria || "General",
      tags: parsed.tags || "",
    };
  } catch {
    // Si Claude no devuelve JSON válido, usar el texto como cuerpo
    console.warn("[content-generator] Failed to parse blog JSON, using raw text");
    return {
      titulo: params.stepTitle,
      extracto: params.stepTitle.slice(0, 160),
      cuerpo: text,
      categoria: "General",
      tags: "",
    };
  }
}

// ─── Landing ─────────────────────────────────────────────────────────────────

export interface GeneratedLanding {
  titulo: string;
  descripcion: string;
  cuerpo: string;
  ctaPrincipal: string;
}

export async function generateLandingPage(params: {
  stepTitle: string;
  stepDescription: string;
  clientName: string;
  clientDomain: string;
}): Promise<GeneratedLanding> {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 3072,
    messages: [{
      role: "user",
      content: `Eres un redactor SEO experto para la agencia Click Society. Redacta el contenido de una landing page en español para el sitio ${params.clientDomain} (${params.clientName}).

Instrucciones del plan SEO:
- Título sugerido: ${params.stepTitle}
- Contexto: ${params.stepDescription}

Requisitos:
1. Contenido en markdown limpio (headers ##, listas, negritas)
2. Estructura: hero text → beneficios → features/servicios → CTA
3. Orientado a conversión: lenguaje persuasivo, beneficios > características
4. Optimizado para SEO: keyword en título, headers, primer párrafo
5. Entre 400-800 palabras
6. NO inventar datos estadísticos
7. NO incluir el título como H1 (Constructor lo agrega automáticamente)

Responde SOLO con un JSON válido (sin markdown code fence) con esta estructura:
{
  "titulo": "Título de la landing (60-70 chars ideal)",
  "descripcion": "Meta description SEO (max 155 chars)",
  "cuerpo": "Contenido completo en markdown...",
  "ctaPrincipal": "Texto del botón CTA principal (ej: Solicitar cotización)"
}`,
    }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  try {
    const parsed = JSON.parse(text) as GeneratedLanding;
    return {
      titulo: parsed.titulo || params.stepTitle,
      descripcion: (parsed.descripcion || params.stepTitle).slice(0, 160),
      cuerpo: parsed.cuerpo || "",
      ctaPrincipal: parsed.ctaPrincipal || "Contactar",
    };
  } catch {
    console.warn("[content-generator] Failed to parse landing JSON, using raw text");
    return {
      titulo: params.stepTitle,
      descripcion: params.stepTitle.slice(0, 160),
      cuerpo: text,
      ctaPrincipal: "Contactar",
    };
  }
}
