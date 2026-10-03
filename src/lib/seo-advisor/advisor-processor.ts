import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "@/lib/anthropic-config";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { logApiUsage, calculateClaudeCost } from "@/server/jobs/workers/base-worker";
import { format, endOfMonth } from "date-fns";
import { checkPreconditions } from "./preconditions";
import { collectSignals } from "./signals";
import type { NextStep, AdvisorResult } from "./types";
import { validateNextSteps } from "./validation";

// ---------------------------------------------------------------------------
// System prompt — se cachea en Claude automáticamente (es idéntico siempre).
// ---------------------------------------------------------------------------

const ADVISOR_SYSTEM_PROMPT = `Eres el consultor SEO senior de Click Society. Tu trabajo: analizar señales SEO y generar ACCIONES EJECUTABLES para el sitio web del cliente.

Cada step que generes se envía a un sistema que lo ejecuta automáticamente. Si un step es vago, le falta URL, o no es un cambio en el sitio web, se descarta y se pierde trabajo.

═══ REGLAS CRÍTICAS ═══

1. CADA STEP = 1 ACCIÓN CONCRETA EN 1 URL
   - "Optimizar title y meta description de /servicios" ✓
   - "Escalar score a 75+" ✗ (es un objetivo, no una acción)
   - "3 landings transaccionales" ✗ (son 3 steps separados, uno por landing)

2. NO GENERAR STEPS INTERNOS DE LA PLATAFORMA
   Estos se generan automáticamente — tú NO los produces:
   - "Activar benchmark de competidores"
   - "Configurar tracking de keywords"
   - "Ejecutar audit"
   - Cualquier cosa que sea configuración de Cerebro SEO, no un cambio en el sitio web

3. NO GENERAR OBJETIVOS NI RESÚMENES COMO STEPS
   Si no puedes descomponer un objetivo en acciones con URL y keywords, NO lo generes:
   - "Mejorar E-E-A-T del sitio" ✗ → descomponer en: agregar página /nosotros, agregar autor a blogs, etc.
   - "Score técnico bajo" ✗ → descomponer en: reducir JS en /página-x, agregar lazy loading en /servicios, etc.
   - "Capturar keyword X" ✗ → decidir: ¿existe página? → kind:meta con targetUrl. ¿No existe? → kind:contenido-landing con slug.

4. DESCOMPONER STEPS COMPUESTOS
   "3 blogs listos para publicar" → 3 items separados, cada uno con su targetUrl (slug), keywords y titulo distintos.
   "Landings para Chillers y Calderas" → 2 items separados.

5. ENTRE 8 Y 10 STEPS. Calidad sobre cantidad, pero cubrir contenido + técnico.

6. COMPOSICIÓN OBLIGATORIA DEL PLAN:
   - MÍNIMO 4 steps de contenido (contenido-blog, contenido-landing o combinados).
     Landing pages para keywords transaccionales, blogs para informacionales.
     Si las señales sugieren menos de 4, complementa con keywords de volumen relevante y baja dificultad.
   - ENTRE 4 Y 6 steps técnicos/de optimización (meta, schema, tecnico, contenido-optimizar, interlinking).
     Priorizar: urgencia ALTA + impacto ALTO primero.
     Si no hay urgencias reales, usar oportunidades de alto impacto.

═══ CATEGORÍAS ═══
- "urgente": problema activo dañando tráfico/posicionamiento ahora
- "oportunidad": ganancia rápida en los próximos 30 días
- "mejora": optimización de mediano plazo (1–3 meses)

═══ SECCIÓN DESTINO (seccionDestino — slug exacto) ═══
keywords | audit | backlinks | competencia | oportunidades | terminos-busqueda | trafico-paginas | aeo-research | contenido | ai-search | analisis

- CTR bajo de una QUERY → terminos-busqueda
- CTR bajo de una PÁGINA/URL → trafico-paginas
- Keyword gaps / oportunidades de ranking → oportunidades
- Contenido nuevo (blog/landing) → contenido

═══ ESFUERZO ═══
- "bajo": cambio puntual en 1 URL (meta, schema, on-page), < 1 hora
- "medio": optimización de contenido existente, interlinking, corrección multi-página, 1–4 horas
- "alto": contenido nuevo (landing/blog), rediseño de sección, > 4 horas

═══ IMPACTO ═══
- "alto": keywords prioritarias > 500 imp/mes, o bloquea indexación/rastreo
- "medio": posiciones 4–10, CTR moderado, keyword gaps
- "bajo": mejora incremental, poco tráfico

═══ KIND — ÁRBOL DE DECISIÓN ═══

Pregúntate: ¿qué ACCIÓN se va a hacer en el sitio web?

¿Cambiar title/description/OG de página EXISTENTE? → "meta"
¿Reescribir/mejorar el body text de página EXISTENTE? (agregar FAQ, mejorar copy, agregar E-E-A-T) → "contenido-optimizar"
¿Crear página nueva tipo landing/servicio? → "contenido-landing"
¿Crear blog post nuevo? → "contenido-blog"
¿Agregar/corregir JSON-LD, schema.org, structured data? → "schema"
¿Fix de performance, JS, Core Web Vitals, crawlability, canonical, redirects, robots.txt, sitemap, llms.txt? → "tecnico"
¿Agregar/mejorar enlaces internos entre páginas existentes? → "interlinking"
¿No es un cambio en el sitio web del cliente? → NO GENERAR EL STEP

NUNCA defaultear a "meta" cuando no sepas qué poner. Si la acción no encaja en ningún kind, es probable que sea un objetivo vago que necesita descomponerse.

═══ targetUrl — OBLIGATORIO (excepto interlinking) ═══

- "meta", "schema", "tecnico", "contenido-optimizar": URL EXISTENTE del sitio (debe aparecer en señales o en la lista de páginas principales).
- "contenido-blog": slug sugerido (ej: "/blog/guia-cctv-empresas"). Basado en keyword principal.
- "contenido-landing": slug sugerido (ej: "/servicios/cctv-monterrey"). Corto y descriptivo.
- "interlinking": URL de la página ORIGEN del enlace. En descripcion, mencionar la página destino.

Si NO puedes determinar una URL o slug, NO generes el step.

═══ keywords — OBLIGATORIO (≥1) para todos los kinds accionables ═══
Solo opcional para "tecnico" (incluir si aplica).

═══ ORIGIN — clasificación del step ═══
- "data": este step responde DIRECTAMENTE a un dato numérico de las señales (CTR bajo en URL X, keyword cayó Y posiciones, audit issue Z con N ocurrencias, backlink DA X perdido). La acción es el paso lógico que dictan los números.
- "ai-insight": este step es una recomendación estratégica que conecta múltiples señales, identifica una oportunidad no obvia, o sugiere contenido/estrategia nueva. Claude está aportando criterio, no solo leyendo números.

═══ FORMATO DE RESPUESTA ═══

RESPONDE ÚNICAMENTE con un JSON array válido. Sin texto fuera del JSON. Si no hay señales suficientes, devuelve [].

{
  "titulo": "string < 80 chars, incluye al menos 1 dato numérico",
  "descripcion": "string < 350 chars: qué hacer, en qué URL, por qué importa, qué resultado esperar",
  "categoria": "urgente|oportunidad|mejora",
  "prioridad": 2,
  "seccionDestino": "slug exacto",
  "evidencia": "string < 120 chars con el dato clave",
  "esfuerzo": "bajo|medio|alto",
  "impacto": "alto|medio|bajo",
  "kind": "meta|contenido-blog|contenido-landing|contenido-optimizar|interlinking|schema|tecnico",
  "targetUrl": "/url-existente o /slug-sugerido",
  "keywords": ["keyword1", "keyword2"],
  "origin": "data|ai-insight"
}`;

// ---------------------------------------------------------------------------
// Helpers de contexto con caching Redis
// ---------------------------------------------------------------------------

async function buildProfileBlock(clientId: string): Promise<string> {
  const cacheKey = `advisor:profile:${clientId}:${format(new Date(), "yyyy-MM")}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    include: {
      cycles: {
        where: { status: { in: ["ACTIVE", "PLANNING"] } },
        orderBy: { yearMonth: "desc" },
        take: 1,
      },
      keywords: { where: { isPriority: true, deletedAt: null }, take: 10 },
      competitors: { where: { deletedAt: null }, take: 5 },
    },
  });

  const cycle = client.cycles[0];

  const text = [
    `# Cliente: ${client.name}`,
    `Dominio: ${client.domain}`,
    `Ciclo actual: ${cycle?.yearMonth ?? "sin ciclo activo"} (${cycle?.status ?? "-"})`,
    "",
    "## Objetivo del mes",
    cycle?.focus ? `Foco: ${cycle.focus}` : "No definido.",
    ...(cycle?.goals ?? []).map((g) => `- ${g}`),
    cycle?.strategySummary ? `Resumen: ${cycle.strategySummary}` : "",
    "",
    "## Keywords prioritarias (tracking diario)",
    client.keywords.length > 0
      ? client.keywords
          .map((k) => `- "${k.term}"${k.targetUrl ? ` → ${k.targetUrl}` : ""}`)
          .join("\n")
      : "Ninguna configurada.",
    "",
    "## Competidores monitoreados",
    client.competitors.length > 0
      ? client.competitors
          .map((c) => `- ${c.domain}${c.domainAuthority ? ` (DA ${c.domainAuthority})` : ""}`)
          .join("\n")
      : "Ninguno configurado.",
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  // TTL: hasta fin de mes + 2 días de margen
  const ttl = Math.floor((endOfMonth(new Date()).getTime() - Date.now()) / 1000) + 172_800;
  await redis.setex(cacheKey, Math.max(ttl, 3600), text);
  return text;
}

async function buildSignalsBlock(clientId: string): Promise<string> {
  const cacheKey = `advisor:signals:${clientId}:${format(new Date(), "yyyy-MM-dd")}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const { text } = await collectSignals(clientId);
  await redis.setex(cacheKey, 25 * 3600, text);
  return text;
}

// ---------------------------------------------------------------------------
// Función principal
// ---------------------------------------------------------------------------

export async function runAdvisorProcessor(params: {
  clientId: string;
  triggeredBy?: string;
  scheduled?: boolean; // true = skip si ya corrió hoy
}): Promise<AdvisorResult> {
  const { clientId, triggeredBy, scheduled = false } = params;

  // 1. Idempotencia diaria — solo para runs programados
  const ranKey = `advisor:ran:${clientId}:${format(new Date(), "yyyy-MM-dd")}`;
  if (scheduled && (await redis.exists(ranKey))) {
    const existing = await prisma.nextStepPlan.findFirst({
      where: { clientId },
      orderBy: { generatedAt: "desc" },
    });
    if (existing) {
      return {
        steps: existing.steps as unknown as NextStep[],
        planId: existing.id,
        tokensUsed: {
          input: existing.inputTokens,
          output: existing.outputTokens,
          cached: 0,
        },
        cost: Number(existing.cost),
      };
    }
  }

  // 2. Preconditions determinísticas
  const preconditions = await checkPreconditions(clientId);
  const { setupSteps } = preconditions;

  // 3. Sin datos suficientes — solo setup steps, sin Claude
  if (!preconditions.isDataSufficient) {
    const plan = await prisma.nextStepPlan.create({
      data: {
        clientId,
        steps: setupSteps as unknown as import("@prisma/client").Prisma.InputJsonValue,
        model: "deterministic",
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        triggeredBy: triggeredBy ?? null,
      },
    });

    if (scheduled) await redis.setex(ranKey, 25 * 3600, "1");

    return {
      steps: setupSteps,
      planId: plan.id,
      tokensUsed: { input: 0, output: 0, cached: 0 },
      cost: 0,
    };
  }

  // 4. Construir contexto con caching estratégico
  const [profileBlock, signalsBlock] = await Promise.all([
    buildProfileBlock(clientId),
    buildSignalsBlock(clientId),
  ]);

  // 5. Llamar a Claude con validación Zod (1 reintento si falla validación)
  const anthropic = new Anthropic();

  const userBlocks: Anthropic.Messages.ContentBlockParam[] = [
    {
      type: "text",
      text: profileBlock,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: signalsBlock,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: "Genera los próximos pasos estratégicos más importantes para este cliente basándote en las señales detectadas. Recuerda: NO incluyas pasos de tipo setup — esos se gestionan automáticamente por separado.",
    },
  ];

  let strategicSteps: NextStep[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;
  let validationFailed = false;
  let prevRawText: string | undefined;
  let prevValidationError: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    const messages: Anthropic.Messages.MessageParam[] =
      attempt === 0
        ? [{ role: "user", content: userBlocks }]
        : [
            { role: "user", content: userBlocks },
            {
              role: "assistant",
              content: prevRawText!,
            },
            {
              role: "user",
              content: `El JSON anterior falló la validación: ${prevValidationError!}\n\nCorrige los errores y devuelve SOLO el JSON array válido.`,
            },
          ];

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2500,
      system: ADVISOR_SYSTEM_PROMPT,
      messages,
    });

    const rawText =
      response.content[0]?.type === "text" ? response.content[0].text.trim() : "[]";

    const usage = response.usage;
    const cached =
      (usage as unknown as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
    totalInputTokens += usage.input_tokens;
    totalOutputTokens += usage.output_tokens;
    totalCachedTokens += cached;

    // Extraer JSON array
    let parsed: unknown[] = [];
    try {
      const match = rawText.match(/\[[\s\S]*\]/);
      parsed = match ? (JSON.parse(match[0]) as unknown[]) : [];
    } catch {
      console.error(
        `[advisor-processor] attempt=${attempt} JSON parse fail:`,
        rawText.slice(0, 200)
      );
      prevRawText = rawText;
      prevValidationError = "Invalid JSON";
      continue;
    }

    // Validar con Zod
    const validation = validateNextSteps(parsed);
    if (validation.success) {
      // Post-process: enforce quality rules on steps
      const ACTIONABLE_KINDS = ["meta", "schema", "tecnico", "contenido-blog", "contenido-landing", "contenido-optimizar", "interlinking"];

      // Internal/platform task patterns — these should never be generated
      const INTERNAL_PATTERNS = [
        /\b(activar|configurar|ejecutar|habilitar)\s+(benchmark|tracking|monitor|audit|crawl)/i,
        /\b(configura|activa)\s+keywords?\b/i,
        /\b(agregar?|añadir)\s+competidor/i,
        /\bconecta(r)?\s+(google\s+search\s+console|gsc|ga4|analytics)/i,
      ];

      // Objective/vague patterns — goals, not actions
      const VAGUE_PATTERNS = [
        /\bescalar\s+score\b/i,
        /\bmejorar\s+(el\s+)?score\s+(general|global|técnico)/i,
        /\bscore\s+.*\ba\s+\d+/i,  // "score ... a 75+"
        /\bseñales?\s+E-E-A-T\b/i,
        /\bscore\s+técnico\s+\d+\/100:\s/i,
      ];

      strategicSteps = (validation.data as NextStep[])
        .map((step) => {
          const fullText = `${step.titulo} ${step.descripcion}`;

          // Drop internal platform tasks
          if (INTERNAL_PATTERNS.some((p) => p.test(fullText))) {
            console.warn(`[advisor-processor] dropping internal/platform step: "${step.titulo}"`);
            return null;
          }

          // Drop vague objectives
          if (VAGUE_PATTERNS.some((p) => p.test(fullText)) && !step.targetUrl) {
            console.warn(`[advisor-processor] dropping vague objective without targetUrl: "${step.titulo}"`);
            return null;
          }

          // Drop kind:"otro" — these are never actionable automatically
          if (step.kind === "otro" || !step.kind) {
            console.warn(`[advisor-processor] dropping kind=otro/null step: "${step.titulo}"`);
            return null;
          }

          if (!ACTIONABLE_KINDS.includes(step.kind)) return step;

          // Try to extract URL from text fields if missing
          if (!step.targetUrl) {
            const textToSearch = `${step.evidencia} ${step.descripcion} ${step.titulo} ${step.seccionDestino ?? ''}`;
            const urlMatch = textToSearch.match(/(?:https?:\/\/[^\s,)"]+|\/[a-z0-9][a-z0-9\-\/._]*(?:\/|(?=[\s,)"']|$)))/i);
            if (urlMatch) {
              step = { ...step, targetUrl: urlMatch[0].replace(/[,.)]+$/, "") };
            }
          }

          // Ensure keywords is a non-empty array for actionable kinds (tecnico is optional)
          if (step.kind !== "tecnico" && (!step.keywords || step.keywords.length === 0)) {
            console.warn(`[advisor-processor] step kind=${step.kind} has no keywords, dropping: "${step.titulo}"`);
            return null;
          }

          // Final check: actionable step MUST have targetUrl
          if (!step.targetUrl) {
            console.warn(`[advisor-processor] step kind=${step.kind} has no targetUrl, dropping: "${step.titulo}"`);
            return null;
          }

          return step;
        })
        .filter((s): s is NextStep => s !== null);

      // Enforce: min 4 content pieces
      const CONTENT_KINDS = ["contenido-blog", "contenido-landing"];
      const contentCount = strategicSteps.filter((s) => CONTENT_KINDS.includes(s.kind ?? "")).length;
      if (contentCount < 4) {
        console.warn(`[advisor-processor] only ${contentCount}/4 content steps — plan may be incomplete`);
      }

      validationFailed = false;
      break;
    }

    console.warn(
      `[advisor-processor] attempt=${attempt} Zod validation failed:`,
      validation.error.slice(0, 300)
    );
    prevRawText = rawText;
    prevValidationError = validation.error;
    validationFailed = true;
  }

  // Si ambos intentos fallaron → guardar como INVALID
  const cost = calculateClaudeCost(
    "sonnet-4-6",
    totalInputTokens,
    totalOutputTokens,
    totalCachedTokens
  );

  if (validationFailed) {
    console.error("[advisor-processor] Both attempts failed validation — saving as INVALID");

    const plan = await prisma.nextStepPlan.create({
      data: {
        clientId,
        steps: setupSteps as unknown as import("@prisma/client").Prisma.InputJsonValue,
        status: "invalid",
        model: CLAUDE_MODEL,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cost,
        triggeredBy: triggeredBy ?? null,
      },
    });

    await prisma.jobLog.create({
      data: {
        jobName: "advisor:generate",
        clientId,
        status: "failed",
        error: `Zod validation failed after 2 attempts: ${(prevValidationError ?? "unknown").slice(0, 500)}`,
        attempts: 2,
      },
    });

    await logApiUsage({
      provider: "claude",
      endpoint: "messages/seo-advisor",
      cost,
      clientId,
    });

    if (scheduled) await redis.setex(ranKey, 25 * 3600, "1");

    return {
      steps: setupSteps,
      planId: plan.id,
      tokensUsed: { input: totalInputTokens, output: totalOutputTokens, cached: totalCachedTokens },
      cost,
    };
  }

  // 7. Merge setup + estratégicos, ordenar por prioridad
  const allSteps: NextStep[] = [...setupSteps, ...strategicSteps].sort(
    (a, b) => a.prioridad - b.prioridad
  );

  // 8. Persistir en BD
  const plan = await prisma.nextStepPlan.create({
    data: {
      clientId,
      steps: allSteps as unknown as import("@prisma/client").Prisma.InputJsonValue,
      status: "valid",
      model: CLAUDE_MODEL,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cost,
      triggeredBy: triggeredBy ?? null,
    },
  });

  // 9. Registrar costo
  await logApiUsage({
    provider: "claude",
    endpoint: "messages/seo-advisor",
    cost,
    clientId,
  });

  // 10. Marcar como corrido hoy (idempotencia scheduled)
  if (scheduled) await redis.setex(ranKey, 25 * 3600, "1");

  return {
    steps: allSteps,
    planId: plan.id,
    tokensUsed: {
      input: totalInputTokens,
      output: totalOutputTokens,
      cached: totalCachedTokens,
    },
    cost,
  };
}

// ---------------------------------------------------------------------------
// Plan mensual estable — se genera una vez por mes, se devuelve idéntico
// hasta el mes siguiente. Max 10 steps accionables, sin setup.
// ---------------------------------------------------------------------------

const MONTHLY_PLAN_MAX_STEPS = 10;
const MONTHLY_PLAN_TRIGGER = "monthly-plan";

/**
 * Devuelve el plan mensual para un cliente. Si no existe, lo genera
 * (lazy) a partir del advisor y lo persiste. Las llamadas subsecuentes
 * en el mismo mes devuelven exactamente el mismo plan.
 */
export async function getOrCreateMonthlyPlan(params: {
  clientId: string;
  yearMonth: string; // "YYYY-MM"
}): Promise<AdvisorResult> {
  const { clientId, yearMonth } = params;

  // 1. Buscar plan mensual existente
  const [year, month] = yearMonth.split("-").map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  const existing = await prisma.nextStepPlan.findFirst({
    where: {
      clientId,
      triggeredBy: MONTHLY_PLAN_TRIGGER,
      generatedAt: { gte: monthStart, lte: monthEnd },
      status: "valid",
    },
    orderBy: { generatedAt: "desc" },
  });

  if (existing) {
    return {
      steps: existing.steps as unknown as NextStep[],
      planId: existing.id,
      tokensUsed: {
        input: existing.inputTokens,
        output: existing.outputTokens,
        cached: 0,
      },
      cost: Number(existing.cost),
    };
  }

  // 2. Generar plan nuevo via advisor (forzar, no scheduled)
  const result = await runAdvisorProcessor({
    clientId,
    triggeredBy: MONTHLY_PLAN_TRIGGER,
    scheduled: false,
  });

  // 3. Filtrar: solo steps accionables (no setup, no kind:otro)
  //    Ordenar por prioridad + impacto, cap a 6
  const IMPACT_WEIGHT: Record<string, number> = { alto: 3, medio: 2, bajo: 1 };
  const actionableSteps = result.steps
    .filter((s) => s.categoria !== "setup" && s.kind && s.kind !== "otro")
    .sort((a, b) => {
      // Primary: prioridad (lower = more urgent)
      if (a.prioridad !== b.prioridad) return a.prioridad - b.prioridad;
      // Secondary: impacto (higher = better)
      const aImp = IMPACT_WEIGHT[a.impacto ?? "bajo"] ?? 1;
      const bImp = IMPACT_WEIGHT[b.impacto ?? "bajo"] ?? 1;
      return bImp - aImp;
    })
    .slice(0, MONTHLY_PLAN_MAX_STEPS);

  // 4. Guardar como plan mensual (separado del plan diario)
  const monthlyPlan = await prisma.nextStepPlan.create({
    data: {
      clientId,
      steps: actionableSteps as unknown as import("@prisma/client").Prisma.InputJsonValue,
      status: "valid",
      model: result.tokensUsed.input > 0 ? CLAUDE_MODEL : "deterministic",
      inputTokens: result.tokensUsed.input,
      outputTokens: result.tokensUsed.output,
      cost: result.cost,
      triggeredBy: MONTHLY_PLAN_TRIGGER,
    },
  });

  return {
    steps: actionableSteps,
    planId: monthlyPlan.id,
    tokensUsed: result.tokensUsed,
    cost: result.cost,
  };
}

