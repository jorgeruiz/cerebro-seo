/**
 * AEO Prober — hace los fetches al dominio del cliente para evaluar
 * si el sitio es legible por crawlers de IA.
 *
 * Costo: $0 — solo fetches al dominio propio.
 * Timeout: 8s por check, try/catch — nunca tumba la auditoría.
 */

import * as cheerio from "cheerio";
import type { AeoProbeResult, AeoCheckStatus } from "@/lib/aeo-readiness";

const PROBE_TIMEOUT = 8_000;

// Bots de IA que importan para citaciones
const CITATION_BOTS = ["GPTBot", "ClaudeBot", "PerplexityBot", "OAI-SearchBot"];
const ALL_AI_BOTS = [
  ...CITATION_BOTS,
  "ChatGPT-User",
  "Google-Extended",
  "CCBot",
  "Bytespider",
  "Applebot-Extended",
  "meta-externalagent",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function safeFetch(
  url: string,
  init?: RequestInit
): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: "follow" });
    clearTimeout(timer);
    return res;
  } catch {
    return null;
  }
}

function normalizeUrl(domain: string): string {
  if (domain.startsWith("http")) return domain.replace(/\/+$/, "");
  return `https://${domain}`.replace(/\/+$/, "");
}

// ─── robots.txt parser (simplified) ───────────────────────────────────────────

interface RobotsParseResult {
  blockedBots: string[];
  hasContentSignal: boolean;
}

function parseRobotsTxt(text: string): RobotsParseResult {
  const lines = text.split("\n").map((l) => l.trim());
  const blockedBots: string[] = [];
  let currentAgent = "";
  let hasContentSignal = false;

  for (const line of lines) {
    if (line.toLowerCase().startsWith("content-signal:")) {
      hasContentSignal = true;
      continue;
    }

    const agentMatch = line.match(/^user-agent:\s*(.+)$/i);
    if (agentMatch) {
      currentAgent = agentMatch[1].trim();
      continue;
    }

    const disallowMatch = line.match(/^disallow:\s*\/\s*$/i);
    if (disallowMatch) {
      // Disallow: / for this agent
      const matchedBot = ALL_AI_BOTS.find(
        (bot) => currentAgent === bot || currentAgent === "*"
      );
      // Only flag specific AI bots, not wildcard "*"
      if (matchedBot && currentAgent !== "*") {
        blockedBots.push(matchedBot);
      }
    }
  }

  return { blockedBots: Array.from(new Set(blockedBots)), hasContentSignal };
}

// ─── llms.txt validator ───────────────────────────────────────────────────────

function validateLlmsTxt(text: string): boolean {
  const hasH1 = /^#\s+.+/m.test(text);
  const hasBlockquote = /^>\s+.+/m.test(text);
  const hasH2WithLinks = /^##\s+.+/m.test(text) && /\[.+\]\(.+\)/m.test(text);
  return hasH1 && hasBlockquote && hasH2WithLinks;
}

// ─── Main prober ──────────────────────────────────────────────────────────────

export async function probeAeo(
  domain: string,
  sampleUrls: string[]
): Promise<AeoProbeResult> {
  const base = normalizeUrl(domain);
  const urlsToCheck = [base, ...sampleUrls.slice(0, 3)];

  // Run all independent checks in parallel
  const [robotsResult, llmsTxtResult, llmsFullResult, sitemapResult, ...urlResults] =
    await Promise.all([
      probeRobots(base),
      probeLlmsTxt(base),
      probeLlmsFullTxt(base),
      probeSitemap(base),
      ...urlsToCheck.map((url) => probeUrlAeo(url)),
    ]);

  // Aggregate URL-level checks
  const mdRouteResult = aggregateCheck(urlResults, "mdRoute");
  const contentNegResult = aggregateCheck(urlResults, "contentNeg");
  const linkHeaderResult = aggregateCheck(urlResults, "linkHeader");
  const linkTagResult = aggregateCheck(urlResults, "linkTag");
  const ssrResult = aggregateSsrCheck(urlResults);

  return {
    robotsAiBlocked: robotsResult.aiBlocked,
    contentSignal: robotsResult.contentSignal,
    llmsTxt: llmsTxtResult,
    llmsFullTxt: llmsFullResult,
    mdRoute: mdRouteResult,
    contentNegotiation: contentNegResult,
    linkHeader: linkHeaderResult,
    linkTag: linkTagResult,
    ssrContent: ssrResult,
    sitemap: sitemapResult,
  };
}

// ─── Individual probes ────────────────────────────────────────────────────────

async function probeRobots(base: string) {
  const res = await safeFetch(`${base}/robots.txt`);

  if (!res || !res.ok) {
    return {
      aiBlocked: { status: "warn" as AeoCheckStatus, blockedBots: [], detail: "No se pudo acceder a robots.txt" },
      contentSignal: { status: "skipped" as AeoCheckStatus, detail: "robots.txt no accesible" },
    };
  }

  const text = await res.text();
  const parsed = parseRobotsTxt(text);

  const citationBlocked = parsed.blockedBots.filter((b) => CITATION_BOTS.includes(b));

  const aiBlocked: AeoProbeResult["robotsAiBlocked"] = citationBlocked.length > 0
    ? { status: "fail", blockedBots: parsed.blockedBots, detail: `Bots bloqueados: ${parsed.blockedBots.join(", ")}` }
    : parsed.blockedBots.length > 0
      ? { status: "warn", blockedBots: parsed.blockedBots, detail: `Bots bloqueados (no críticos): ${parsed.blockedBots.join(", ")}` }
      : { status: "pass", blockedBots: [], detail: "Ningún bot de IA bloqueado" };

  const contentSignal: AeoProbeResult["contentSignal"] = parsed.hasContentSignal
    ? { status: "pass", detail: "Content-Signal detectado en robots.txt" }
    : { status: "warn", detail: "Sin línea Content-Signal en robots.txt" };

  return { aiBlocked, contentSignal };
}

async function probeLlmsTxt(base: string): Promise<AeoProbeResult["llmsTxt"]> {
  const res = await safeFetch(`${base}/llms.txt`);
  if (!res || !res.ok) {
    return { status: "fail", detail: "/llms.txt no encontrado o no accesible" };
  }

  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/")) {
    return { status: "fail", detail: `/llms.txt Content-Type no es texto: ${ct}` };
  }

  const text = await res.text();
  if (!validateLlmsTxt(text)) {
    return { status: "warn", detail: "/llms.txt existe pero no cumple la estructura mínima (H1 + blockquote + H2 con links)" };
  }

  return { status: "pass", detail: "/llms.txt válido con estructura correcta" };
}

async function probeLlmsFullTxt(base: string): Promise<AeoProbeResult["llmsFullTxt"]> {
  const res = await safeFetch(`${base}/llms-full.txt`);
  if (!res || !res.ok) {
    return { status: "fail", detail: "/llms-full.txt no encontrado" };
  }
  return { status: "pass", detail: "/llms-full.txt accesible" };
}

async function probeSitemap(base: string): Promise<AeoProbeResult["sitemap"]> {
  const res = await safeFetch(`${base}/sitemap.xml`, { method: "HEAD" });
  if (!res || !res.ok) {
    return { status: "fail", detail: "/sitemap.xml no encontrado o no accesible" };
  }
  return { status: "pass", detail: "/sitemap.xml accesible" };
}

// ─── Per-URL checks ───────────────────────────────────────────────────────────

interface UrlAeoResult {
  url: string;
  mdRoute: { found: boolean };
  contentNeg: { respondsMd: boolean; hasVaryAccept: boolean };
  linkHeader: { found: boolean };
  linkTag: { found: boolean };
  ssr: { wordCount: number; scriptCount: number };
}

async function probeUrlAeo(url: string): Promise<UrlAeoResult> {
  const normalUrl = normalizeUrl(url);

  // Run checks in parallel
  const [mdRes, cnRes, htmlRes] = await Promise.all([
    safeFetch(`${normalUrl}.md`),
    safeFetch(normalUrl, {
      headers: { Accept: "text/markdown, text/html;q=0.9" },
    }),
    safeFetch(normalUrl),
  ]);

  // .md route check
  const mdFound =
    mdRes !== null &&
    mdRes.ok &&
    (mdRes.headers.get("content-type")?.includes("text/markdown") ||
     mdRes.headers.get("content-type")?.includes("text/plain") || false);

  // Content negotiation check
  const cnContentType = cnRes?.headers.get("content-type") ?? "";
  const respondsMd = cnContentType.includes("text/markdown");
  const hasVaryAccept = (cnRes?.headers.get("vary") ?? "").toLowerCase().includes("accept");

  // Link header check
  const linkHeaderValue = htmlRes?.headers.get("link") ?? "";
  const linkHeaderFound = /rel="alternate"/.test(linkHeaderValue) &&
    /type="text\/markdown"/.test(linkHeaderValue);

  // HTML analysis for link tag + SSR check
  let linkTagFound = false;
  let wordCount = 0;
  let scriptCount = 0;

  if (htmlRes?.ok) {
    try {
      const html = await htmlRes.text();
      const $ = cheerio.load(html);

      // <link rel="alternate" type="text/markdown">
      linkTagFound = $('link[rel="alternate"][type="text/markdown"]').length > 0;

      // SSR content check: word count of body minus non-content elements
      $("script, style, nav, footer, header").remove();
      const bodyText = $("body").text().replace(/\s+/g, " ").trim();
      wordCount = bodyText ? bodyText.split(/\s+/).length : 0;

      // Script count (from original HTML, reload)
      const $fresh = cheerio.load(html);
      scriptCount = $fresh('script[src]').length;
    } catch {
      // Cheerio parse failure — treat as skipped
    }
  }

  return {
    url: normalUrl,
    mdRoute: { found: mdFound },
    contentNeg: { respondsMd, hasVaryAccept },
    linkHeader: { found: linkHeaderFound },
    linkTag: { found: linkTagFound },
    ssr: { wordCount, scriptCount },
  };
}

// ─── Aggregation helpers ──────────────────────────────────────────────────────

type SimpleCheckKey = "mdRoute" | "contentNeg" | "linkHeader" | "linkTag";

function aggregateCheck(
  results: UrlAeoResult[],
  key: SimpleCheckKey
): { status: AeoCheckStatus; detail: string } {
  if (results.length === 0) return { status: "skipped", detail: "Sin URLs para analizar" };

  const passing = results.filter((r) => {
    if (key === "mdRoute") return r.mdRoute.found;
    if (key === "contentNeg") return r.contentNeg.respondsMd && r.contentNeg.hasVaryAccept;
    if (key === "linkHeader") return r.linkHeader.found;
    if (key === "linkTag") return r.linkTag.found;
    return false;
  });

  if (passing.length === results.length) {
    return { status: "pass", detail: `Detectado en ${passing.length}/${results.length} URLs analizadas` };
  }
  if (passing.length > 0) {
    return { status: "warn", detail: `Solo ${passing.length}/${results.length} URLs lo implementan` };
  }
  return { status: "fail", detail: `No detectado en ninguna de las ${results.length} URLs analizadas` };
}

function aggregateSsrCheck(
  results: UrlAeoResult[]
): AeoProbeResult["ssrContent"] {
  if (results.length === 0) {
    return { status: "skipped", wordCount: 0, scriptCount: 0, detail: "Sin URLs para analizar" };
  }

  // Use homepage (first result) as primary signal
  const home = results[0];
  const wc = home.ssr.wordCount;
  const sc = home.ssr.scriptCount;

  if (wc < 200 && sc > 3) {
    return {
      status: "fail",
      wordCount: wc,
      scriptCount: sc,
      detail: `Homepage: solo ${wc} palabras en HTML estático con ${sc} scripts externos. El contenido probablemente se renderiza con JavaScript y es invisible para crawlers de IA.`,
    };
  }

  if (wc < 200) {
    return {
      status: "warn",
      wordCount: wc,
      scriptCount: sc,
      detail: `Homepage: ${wc} palabras en HTML estático. Poco contenido visible sin JavaScript.`,
    };
  }

  return {
    status: "pass",
    wordCount: wc,
    scriptCount: sc,
    detail: `Homepage: ${wc} palabras visibles en HTML estático sin JavaScript.`,
  };
}
