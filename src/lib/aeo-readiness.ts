/**
 * AEO Readiness — scoring puro, sin dependencias de Prisma.
 *
 * Recibe el resultado crudo del prober y genera un reporte
 * con score 0-100 y checks individuales.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type AeoCheckId =
  | "robots_ai_blocked"
  | "content_signal"
  | "llms_txt"
  | "llms_full_txt"
  | "md_route"
  | "content_negotiation"
  | "link_header"
  | "link_tag"
  | "ssr_content"
  | "sitemap";

export type AeoCheckStatus = "pass" | "fail" | "warn" | "skipped";

export interface AeoCheck {
  id: AeoCheckId;
  status: AeoCheckStatus;
  title: string;
  detail: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  fix: string;
}

export interface AeoReadinessReport {
  score: number;
  checks: AeoCheck[];
}

export interface AeoProbeResult {
  robotsAiBlocked: { status: AeoCheckStatus; blockedBots: string[]; detail: string };
  contentSignal: { status: AeoCheckStatus; detail: string };
  llmsTxt: { status: AeoCheckStatus; detail: string };
  llmsFullTxt: { status: AeoCheckStatus; detail: string };
  mdRoute: { status: AeoCheckStatus; detail: string };
  contentNegotiation: { status: AeoCheckStatus; detail: string };
  linkHeader: { status: AeoCheckStatus; detail: string };
  linkTag: { status: AeoCheckStatus; detail: string };
  ssrContent: { status: AeoCheckStatus; wordCount: number; scriptCount: number; detail: string };
  sitemap: { status: AeoCheckStatus; detail: string };
}

// ─── Check weights ────────────────────────────────────────────────────────────

const CHECK_WEIGHTS: Record<AeoCheckId, number> = {
  robots_ai_blocked: 2,
  ssr_content: 2,
  content_signal: 1,
  llms_txt: 1,
  llms_full_txt: 1,
  md_route: 1,
  content_negotiation: 1,
  link_header: 1,
  link_tag: 1,
  sitemap: 1,
};

// ─── Builder ──────────────────────────────────────────────────────────────────

export function buildAeoReport(input: AeoProbeResult): AeoReadinessReport {
  const checks: AeoCheck[] = [
    {
      id: "robots_ai_blocked",
      status: input.robotsAiBlocked.status,
      title: "robots.txt no bloquea crawlers de IA",
      detail: input.robotsAiBlocked.detail,
      severity: input.robotsAiBlocked.blockedBots.length > 0 ? "critical" : "info",
      fix: "Elimina las directivas Disallow para GPTBot, ClaudeBot, PerplexityBot y OAI-SearchBot en robots.txt. Bloquearlos impide que tu contenido aparezca en respuestas de IA.",
    },
    {
      id: "content_signal",
      status: input.contentSignal.status,
      title: "Content-Signal en robots.txt",
      detail: input.contentSignal.detail,
      severity: "low",
      fix: "Agrega la línea 'Content-Signal: https://contentsignals.org' a robots.txt para señalizar preferencias de uso de contenido por IA.",
    },
    {
      id: "llms_txt",
      status: input.llmsTxt.status,
      title: "Archivo /llms.txt presente",
      detail: input.llmsTxt.detail,
      severity: "low",
      fix: "Crea /llms.txt con un H1 (nombre del sitio), un blockquote (descripción), y secciones H2 con links a recursos clave. Ver llmstxt.org para el formato.",
    },
    {
      id: "llms_full_txt",
      status: input.llmsFullTxt.status,
      title: "Archivo /llms-full.txt presente",
      detail: input.llmsFullTxt.detail,
      severity: "low",
      fix: "Crea /llms-full.txt con el contenido completo del sitio en markdown. Útil cuando un usuario pega la URL directamente en ChatGPT o Claude.",
    },
    {
      id: "md_route",
      status: input.mdRoute.status,
      title: "Rutas .md disponibles",
      detail: input.mdRoute.detail,
      severity: "medium",
      fix: "Agrega rutas alternativas .md que sirvan el mismo contenido en Markdown. Ejemplo: /about.md sirve el contenido de /about en texto plano.",
    },
    {
      id: "content_negotiation",
      status: input.contentNegotiation.status,
      title: "Content negotiation (Accept: text/markdown)",
      detail: input.contentNegotiation.detail,
      severity: "medium",
      fix: "Configura el servidor para responder con text/markdown cuando el header Accept lo solicite, y agrega Vary: Accept al response. No servir contenido diferente — mismo contenido, distinto formato.",
    },
    {
      id: "link_header",
      status: input.linkHeader.status,
      title: "Header Link alternate markdown",
      detail: input.linkHeader.detail,
      severity: "low",
      fix: "Agrega el header HTTP: Link: </page.md>; rel=\"alternate\"; type=\"text/markdown\" para indicar la existencia de la versión markdown.",
    },
    {
      id: "link_tag",
      status: input.linkTag.status,
      title: "Tag <link> alternate markdown en HTML",
      detail: input.linkTag.detail,
      severity: "low",
      fix: "Agrega <link rel=\"alternate\" type=\"text/markdown\" href=\"/page.md\"> en el <head> de cada página.",
    },
    {
      id: "ssr_content",
      status: input.ssrContent.status,
      title: "Contenido visible sin JavaScript (SSR)",
      detail: input.ssrContent.detail,
      severity: input.ssrContent.status === "fail" ? "high" : "info",
      fix: "Asegúrate de que el contenido principal se renderice del lado del servidor (SSR/SSG). Los crawlers de IA no ejecutan JavaScript — si tu contenido depende de JS, será invisible para ellos.",
    },
    {
      id: "sitemap",
      status: input.sitemap.status,
      title: "Sitemap.xml accesible",
      detail: input.sitemap.detail,
      severity: "low",
      fix: "Asegúrate de que /sitemap.xml esté accesible y contenga las URLs principales del sitio.",
    },
  ];

  // Score: pass = full weight, warn = half weight, fail/skipped = 0
  let earned = 0;
  let total = 0;

  for (const check of checks) {
    const weight = CHECK_WEIGHTS[check.id];
    if (check.status === "skipped") continue;
    total += weight;
    if (check.status === "pass") earned += weight;
    else if (check.status === "warn") earned += weight * 0.5;
  }

  const score = total > 0 ? Math.round((earned / total) * 100) : 0;

  return { score, checks };
}
