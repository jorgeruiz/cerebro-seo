/**
 * Job de descomposición de tareas en PlanSteps.
 *
 * Lee docs del repo vía GitHub API (sin clonar), genera pasos con Claude,
 * y crea PlanSteps en BD. Corre en la cola ai-analysis (proceso web),
 * no en el worker de agentes.
 */

import { prisma } from "@/lib/db";
import { logApiUsage } from "@/server/jobs/workers/base-worker";
import { getWpCapabilities } from "@/lib/wp-proxy-client";
import {
  DECOMPOSER_VERSION,
} from "@/lib/task-templates";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DecompositionJobData {
  taskId: string;
  clientId: string;
  candidateId: string;
}

// ─── Decomposition ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres un planificador de tareas SEO. Tu trabajo: descomponer una tarea en pasos concretos y accionables para el equipo de Click Society.

REGLAS GENERALES:
1. Cada paso AI debe tener un prompt AUTOSUFICIENTE (JSON) con qué ejecutar exactamente.
2. Entre 1 y 5 pasos por tarea. Máximo 5. Un paso = una acción atómica.
3. Los prompts de pasos AI deben mencionar CLAUDE.md y DESIGN.md si existen en el repo.

TIPO DE PASO — AI POR DEFECTO:
- AI: todo lo que se resuelva con integraciones internas (DataForSEO, GSC, GA4 vía API, sitemap, repo) o con el agente en Next.js. Incluye pasos de datos (keyword_research, apply_keywords).
- HUMAN: solo en estos 3 casos, y el paso DEBE incluir "humanReason":
  a) "terminal": incluye un prompt listo para correr en la terminal de Cerebro SEO, dirigido al agente.
  b) "config": configurar keywords o competidores en Cerebro SEO. Si la IA puede proponer la lista, va antes un paso AI que la deja en stagedChange y el HUMAN solo aprueba/edita.
  c) "external_tool": GA4, GSC (verificación, sitemaps, indexación) y Google Business Profile. Instrucciones paso a paso para la persona.
  En WordPress, "wp_manual" reemplaza a "terminal" (WP Admin, Elementor, Yoast).
- PROHIBIDO en HUMAN: pedir entrar a DataForSEO, exportar CSV, hojas de cálculo, Drive, o "investigar" algo que una API interna resuelve.
- Revisión/publicación/merge no son pasos de la tarea (los cubre la UI del plan).
- Un paso HUMAN sin humanReason válido será RECHAZADO.

PASOS DE DATOS (type=AI, ejecutados dentro de Cerebro SEO):
- keyword_research: investigación y selección de keywords.
  Prompt JSON: { "action": "keyword_research", "categories": [{"name": "...", "seeds": ["..."]}], "criteria": { "minVolume": 100, "maxKD": 60, "total": 25, "distribution": {"Categoría A": 10, "Categoría B": 15} } }
  Genera tabla de keywords con volumen, KD, GSC data, URL objetivo y prioridad.
- apply_keywords: upsert keywords aprobadas en BD + encolar tracking.
  Prompt JSON: { "action": "apply_keywords" }
  Solo ejecuta si hay un paso previo keyword_research con stagedChange aprobado.
- Para tareas de "investigar y seleccionar keywords", usa la plantilla: [AI keyword_research] → [HUMAN config: aprobar/editar tabla] → [AI apply_keywords].

HERRAMIENTAS DISPONIBLES EN CEREBRO SEO (solo estas):
- PageSpeed Insights: https://pagespeed.web.dev/ — velocidad y Core Web Vitals (web, gratis)
- Google Search Console: clicks, impresiones, posiciones, páginas top, queries top (API interna)
- Google Analytics 4: sesiones, usuarios, rebote, conversiones (API interna)
- DataForSEO: rankings, backlinks, auditoría técnica, keywords (API interna — NO manual)
- Elementor: editor visual para WordPress
- Yoast SEO / Rank Math: meta tags, schema, sitemap
PROHIBIDO sugerir: Lighthouse CLI, Screaming Frog, Ahrefs, Semrush, WebPageTest, hojas de cálculo, Drive, interfaz web de DataForSEO.

REGLA ANTI-CANIBALIZACIÓN:
- Si el contexto incluye "PÁGINA EXISTENTE:", OPTIMIZAR la página existente — NUNCA crear una nueva.
- Revisa las rutas existentes del sitio antes de proponer páginas nuevas.
- Si la keyword ya tiene una URL posicionada → optimizar, no duplicar.

SERVICIOS VERIFICADOS (site-spec):
- Antes de proponer contenido sobre un servicio/producto, verificar que aparece en site-spec.md o en la lista de servicios del cliente.
- Si no existe: Confirmar con el cliente si ofrece ese servicio. Marcar como mode=HUMAN.
- ¿El cliente ofrece este servicio? → Si no está en site-spec, preguntar antes de crear contenido.

REGLA ANTI-INVENCIÓN (CRÍTICA):
- PROHIBIDO inventar: casos de éxito, certificaciones, precios, capacidades, testimonios, estadísticas del cliente.
- Si un paso AI necesita datos reales del cliente → paso HUMAN en su lugar.
- Usa LITERALMENTE el título y objetivo de la tarea. No reinterpretes términos técnicos.

─── PARA SITIOS PLATFORM=NEXTJS ────────────────────────────────────────────────

TERMINAL (solo Next.js): puede leer/editar/crear archivos, npm run build/lint, git, npx sharp/svgo.
No puede: instalar paquetes globales, correr Docker, URLs externas, abrir un navegador.

FRONTMATTER MDX (CRÍTICO — Next.js): nunca incluyas borrador: true, draft: true, published: false ni ningún campo que marque el artículo como inédito. En Next.js el preview del plan ES la revisión; el merge a main ES la publicación. Campos válidos: title, description, date, coverImage (WebP), tags, author. Si añades borrador o draft, la tarea es inválida.

No generes pasos de verificación de compilación ("Verificar que compila", "npm run build", "revisar errores de TypeScript"). El worker compila y reporta errores automáticamente después de cada paso AI. Un paso manual de build duplica trabajo y ralentiza el plan.

IMÁGENES AI (Next.js y WordPress-blog):
- subject_type: "conceptual" o "illustration". Personas reales / instalaciones / productos del cliente → HUMAN.
- aspect_ratio: 16:9 portadas, 4:3 inline, 1:1 thumbnails. Portadas de blog (16:9): formato WebP obligatorio — añadir "format": "webp" al payload.

COMPLEJIDAD (Next.js):
- "low" (1-2 archivos existentes), "medium" (crear 1 archivo), "high" (múltiples archivos nuevos).
- "high" con > 2 entregables → dividir en pasos "medium".

─── PARA SITIOS PLATFORM=WORDPRESS ─────────────────────────────────────────────

REGLAS ABSOLUTAS WORDPRESS (incumplirlas invalida el paso):
A. NUNCA generes pasos que pidan al equipo usar API keys, credentials, comandos de terminal,
   scripts PHP, FTP, o acceso a la base de datos. El equipo solo puede usar:
   WordPress Admin, Elementor (editor visual), Yoast SEO (panel inferior del editor).
B. La canibalización ya fue verificada automáticamente. Si el contexto incluye
   "PÁGINA EXISTENTE:", la tarea DEBE optimizar esa página — NUNCA crear una nueva.
C. Si un paso AI requiere un endpoint que NO aparece en WP CAPABILITIES → conviértelo
   en HUMAN con instrucciones manuales equivalentes. Nunca lo dejes inválido.
D. TODO paso type=AI en WordPress DEBE tener un prompt JSON con "action" reconocida:
   content_package, publish, seo, image, keyword_research, apply_keywords.
   Si la tarea necesita algo que no tiene acción (verificar backlinks, revisar 404s,
   configurar redirects) → paso HUMAN con instrucciones claras para WP Admin.
   NUNCA generes un paso AI con prompt de texto libre en WordPress.

PASO OBLIGATORIO "content_package":
Toda tarea CONTENT en WordPress DEBE comenzar con este paso AI como paso 1:
{
  "action": "content_package",
  "kind": "blog" | "landing" | "optimization",
  "keyword": "<keyword principal de la tarea>",
  "page_title": "<título SEO de la página o artículo>",
  "target_page_id": 0
}
Este paso genera el paquete completo (H1, H2/H3, textos, tablas, FAQ, CTA, metas, schema, enlaces internos, brief de imagen).
NO requiere plugin WP. Siempre es type=AI, complexity=high.

PLANTILLAS OBLIGATORIAS POR TIPO:

BLOG (kind=CONTENT con artículo/post/redactar):
1. [AI] Paquete de contenido → action: content_package, kind: "blog"
2. [AI] Crear borrador en WordPress → action: "publish"
3. [AI] Imagen de portada → action: "image" (SOLO si tema es conceptual/ilustración — si necesita fotos reales del cliente, omitir y agregar instrucción en paso 4)
4. [HUMAN] Revisar y publicar borrador
   prompt: "Ve a WordPress Admin > Entradas > Borradores. El artículo '[título]' fue creado como borrador (URL de vista previa disponible en el paso anterior).
   Checklist antes de publicar:
   1. Verifica que no haya [COMPLETAR] sin reemplazar
   2. Revisa el formato, imágenes y que los H2/H3 sean correctos
   3. En Yoast SEO (panel inferior), confirma el meta title y meta description
   4. Si hay imagen de portada, verifica que esté asignada en 'Imagen destacada'
   5. Haz clic en 'Publicar' cuando todo esté revisado"

LANDING (kind=CONTENT con nueva página de servicio/producto/categoría):
1. [AI] Paquete de contenido → action: content_package, kind: "landing"
2. [HUMAN] Crear landing en Elementor con el paquete
   prompt: "El Paso 1 generó el paquete completo de contenido (disponible en el detalle del paso).
   Ve a WordPress Admin > Páginas > Añadir nueva > Editar con Elementor.
   Usa el paquete del Paso 1 como estructura:
   1. Sección Hero: usa el H1 del paquete como encabezado principal
   2. Crea secciones siguiendo los H2/H3 del paquete
   3. Agrega tablas y listas del paquete en las secciones correspondientes
   4. Sección FAQ: agrega las preguntas y respuestas del paquete
   5. Sección CTA: [usa el texto CTA del paquete]
   6. En Yoast SEO (panel inferior): pega el meta title y meta description del paquete
   7. Solicita al cliente foto real para la sección hero (brief: [brief de imagen del paquete])
   8. Guarda como borrador"
3. [HUMAN] Revisar, agregar fotos reales y publicar
   prompt: "Revisión final antes de publicar:
   1. Confirma que todas las secciones del paquete estén implementadas
   2. Reemplaza cualquier [COMPLETAR] con información real del cliente
   3. Verifica que las imágenes sean de calidad y tengan alt text descriptivo
   4. En Yoast SEO: verifica el meta title y meta description
   5. Verifica que la URL/slug sea correcta (ej: /[keyword-principal])
   6. Haz clic en 'Publicar'"

OPTIMIZACIÓN (PÁGINA EXISTENTE detectada, o título dice 'optimizar'/'mejorar'):
1. [AI] Paquete de cambios antes→después → action: content_package, kind: "optimization"
2. [HUMAN] Aplicar cambios en Elementor
   prompt: "El Paso 1 generó los cambios específicos antes→después (disponible en el detalle del paso).
   Ve a Dashboard > Páginas > [nombre página] > Editar con Elementor.
   Para cada cambio del paquete:
   1. Localiza el widget exacto por sección y tipo
   2. Reemplaza el texto anterior con el texto nuevo indicado
   3. Verifica que el cambio se vea bien visualmente
   4. Guarda los cambios
   Nota: los meta tags se aplicarán automáticamente al publicar el plan."

OTROS PASOS AI VÁLIDOS (solo si endpoint aparece en WP CAPABILITIES):
{
  "action": "publish",
  "endpoint": "POST /publish",
  "payload": { "title": "...", "slug": "...", "focus_keyword": "...", "categories": [...] },
  "content_brief": "Brief de 200+ palabras con estructura, keyword, tono, CTAs, qué no inventar."
}
{
  "action": "seo",
  "endpoint": "POST /seo/{page_id}",
  "payload": { "page_id": 0, "meta_title": "50-60 chars", "meta_description": "140-160 chars", "focus_keyword": "..." }
}
{
  "action": "image",
  "endpoint": "",
  "payload": { "usage": "featured_image", "attach_to_post_id": null, "aspect_ratio": "16:9", "subject_type": "conceptual" },
  "content_brief": "Descripción visual: tema, composición, paleta, qué NO incluir (logos, texto, personas)."
}

DEGRADAR en lugar de fallar:
Si el endpoint requerido no está en WP CAPABILITIES → convierte el paso AI en HUMAN equivalente.
Nunca generes un paso con acción inválida. Prefiere HUMAN claro a AI roto.

RESPONDE ÚNICAMENTE con un JSON array:
[
  {
    "title": "Título corto del paso (max 120 chars)",
    "type": "AI|HUMAN",
    "complexity": "low|medium|high",
    "prompt": "Para AI: JSON estructurado exacto. Para HUMAN: instrucciones completas paso a paso.",
    "acceptanceCriteria": ["Criterio verificable 1", "Criterio 2"],
    "humanReason": null | "terminal" | "config" | "external_tool" | "wp_manual"
  }
]

humanReason es OBLIGATORIO para pasos HUMAN y PROHIBIDO para pasos AI.
Sin texto fuera del JSON. El primer elemento del array siempre es el primer paso (orden ascendente).`;

// Exported for testing
export const TASK_DECOMPOSER_SYSTEM_PROMPT = SYSTEM_PROMPT;

export async function decomposeTask(data: DecompositionJobData): Promise<void> {
  const { taskId, clientId } = data;

  const task = await prisma.planTask.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      site: { include: { client: { select: { cerebroClientId: true, name: true } } } },
    },
  });

  const platform = task.site?.platform ?? "OTRO";

  // Platform policy: block decomposition if not executable
  const { getPlatformPolicy } = await import("@/lib/platform-policy");
  const platformPolicy = getPlatformPolicy(platform);
  if (!platformPolicy.executable) {
    await prisma.planTask.update({
      where: { id: taskId },
      data: {
        status: "WAITING_HUMAN",
        failureReason: platformPolicy.ineligibilityReason ?? `Plataforma "${platform}" no soporta descomposición automática.`,
      },
    });
    console.log(`[task-decomposer] ${task.title} → BLOCKED (platform=${platform})`);
    return;
  }
  const cerebroClientId = task.site?.client?.cerebroClientId ?? null;

  // ── WP: capabilities + site profile + anti-cannibalization ──────────────────
  let wpCapabilitiesContext = "";

  if (platform === "WORDPRESS" && cerebroClientId) {
    // Capabilities
    const capsResult = await getWpCapabilities(cerebroClientId, taskId);
    if (capsResult.ok && (capsResult.data.endpoints ?? []).length > 0) {
      const src = capsResult.fromCache ? "caché 24h" : "en vivo";
      wpCapabilitiesContext =
        `\nWP CAPABILITIES (${src}):\nEndpoints activos: ${capsResult.data.endpoints.join(", ")}\n` +
        `Recuerda: solo generar pasos type=AI para endpoints que aparezcan en esta lista.\n`;
    } else {
      const reason = capsResult.ok ? "ningún endpoint registrado" : capsResult.error;
      wpCapabilitiesContext = `\nWP CAPABILITIES: no disponibles (${reason}). Todos los pasos AI deben degradarse a HUMAN.\n`;
    }

  }

  // ═══════════════════════════════════════════════════════════════════════════
  // F1c: CATALOG-BASED DECOMPOSER — classifier + template steps + evidence
  // ═══════════════════════════════════════════════════════════════════════════

  try {
  const { classifyTask } = await import("@/lib/plan/classify-task");
  const { getCatalogEntry } = await import("@/lib/plan/task-catalog");
  const { resolveStepsWithCapabilities } = await import("@/lib/plan/capabilities");
  const { resolveTaskEvidence, REQUIRED_EVIDENCE, validateNoVagueReferences } = await import("@/lib/plan/task-data-resolver");

  // Step 1: Classify the task (LLM with closed enum + deterministic validation)
  const wpCaps = wpCapabilitiesContext ? extractCapsList(wpCapabilitiesContext) : null;

  const classification = await classifyTask({
    title: task.title,
    objective: task.objective,
    platform,
    wpCapabilities: wpCaps,
    existingActionType: task.actionType,
  });

  // Save classification results
  await prisma.planTask.update({
    where: { id: taskId },
    data: {
      actionType: classification.actionType,
      category: classification.category,
      classificationConfidence: classification.confidence,
      classificationMeta: {
        candidates: classification.candidates,
        conflicts: classification.conflicts,
        missingInputs: classification.missingInputs,
        reasoning: classification.reasoning,
      } as unknown as Parameters<typeof prisma.planTask.update>[0]["data"]["classificationMeta"],
      targetKeyword: classification.targetKeyword ?? task.targetKeyword ?? null,
    },
  });

  // Log cost
  if (classification.costUsd > 0) {
    await logApiUsage({
      provider: "anthropic",
      endpoint: "task-classify",
      cost: classification.costUsd,
      clientId,
    });
  }

  // Handle classification outcomes
  if (classification.status === "NEEDS_DEFINITION") {
    await prisma.planTask.update({
      where: { id: taskId },
      data: { status: "NEEDS_DEFINITION", mode: "HUMAN", modeReason: "No clasificable automáticamente" },
    });
    console.log(`[task-decomposer] "${task.title}" → NEEDS_DEFINITION (${classification.reasoning})`);
    return;
  }

  if (classification.status === "NEEDS_INPUT") {
    await prisma.planTask.update({
      where: { id: taskId },
      data: {
        status: "NEEDS_INPUT",
        blockedReason: `Faltan datos: ${classification.missingInputs.join(", ")}`,
        remedy: "Completar los datos faltantes y reintentar",
      },
    });
    console.log(`[task-decomposer] "${task.title}" → NEEDS_INPUT (${classification.missingInputs.join(", ")})`);
    return;
  }

  // Step 1b: Evaluate gates
  const { evaluateGates } = await import("@/lib/plan/plan-gates");
  const catalogEntryForGates = getCatalogEntry(classification.actionType);
  if (catalogEntryForGates) {
    const gateResult = await evaluateGates(catalogEntryForGates.gates, {
      clientId,
      siteId: task.siteId,
      platform,
      targetUrl: classification.targetUrl,
      targetKeyword: classification.targetKeyword ?? task.targetKeyword,
      actionType: classification.actionType,
      wpCapabilities: wpCaps,
      taskCategory: classification.category,
    });

    if (!gateResult.allPassed) {
      await prisma.planTask.update({
        where: { id: taskId },
        data: {
          status: "BLOCKED",
          blockedReason: gateResult.blockedReason,
          remedy: gateResult.remedy,
        },
      });
      console.log(`[task-decomposer] "${task.title}" → BLOCKED: ${gateResult.blockedReason}`);
      return;
    }
  }

  // Step 2: Get catalog entry and resolve steps
  const catalogEntry = getCatalogEntry(classification.actionType);
  if (!catalogEntry) {
    // Shouldn't happen if classification is valid, but handle gracefully
    await prisma.planTask.update({
      where: { id: taskId },
      data: { status: "NEEDS_DEFINITION", mode: "HUMAN" },
    });
    return;
  }

  const platformKey = (platform === "NEXTJS" || platform === "WORDPRESS") ? platform as "NEXTJS" | "WORDPRESS" : "WORDPRESS";
  const catalogSteps = catalogEntry.steps[platformKey] ?? catalogEntry.steps.WORDPRESS;
  const resolvedSteps = resolveStepsWithCapabilities(
    catalogSteps as unknown as Array<{ type: "AI" | "HM"; requiredCapability?: string; fallback?: { type: "AI" | "HM"; [key: string]: unknown }; [key: string]: unknown }>,
    wpCaps
  );

  // Step 3: Resolve evidence from data sources
  const evidence = await resolveTaskEvidence(
    classification.actionType,
    clientId,
    task.siteId,
    classification.targetUrl,
    classification.targetKeyword ?? task.targetKeyword,
  );

  // Step 3b: If evidence is required but empty → NEEDS_INPUT
  const reqEvidence = REQUIRED_EVIDENCE[classification.actionType];
  if (reqEvidence && !evidence.sufficient) {
    await prisma.planTask.update({
      where: { id: taskId },
      data: {
        status: "NEEDS_INPUT",
        blockedReason: `Datos requeridos: ${reqEvidence.description}`,
        remedy: reqEvidence.source,
      },
    });
    console.log(`[task-decomposer] "${task.title}" → NEEDS_INPUT: ${reqEvidence.description}`);
    return;
  }

  // Step 4: Derive mode from resolved steps
  const hasAI = resolvedSteps.some((s) => s.type === "AI");
  const hasHM = resolvedSteps.some((s) => s.type === "HM");
  const finalMode = hasAI && hasHM ? "HYBRID" : hasAI ? "AI" : "HUMAN";

  // Step 5: Create PlanSteps from catalog template
  for (let i = 0; i < resolvedSteps.length; i++) {
    const step = resolvedSteps[i] as {
      kind: string; title: string; type: "AI" | "HM";
      humanReason?: string; requiredCapability?: string;
      [key: string]: unknown;
    };

    // Build step prompt with evidence
    let prompt: string | null = null;
    if (step.type === "AI") {
      const evidenceText = evidence.rows.length > 0
        ? `\nDATOS DISPONIBLES:\n${evidence.rows.map((r) => `- ${r.label}: ${r.value}${r.proposed ? ` → ${r.proposed}` : ""} (${r.source}, ${r.date})`).join("\n")}\n`
        : "";

      prompt = JSON.stringify({
        action: step.kind,
        targetUrl: classification.targetUrl,
        targetKeyword: classification.targetKeyword ?? task.targetKeyword,
        context: `${task.objective}${evidenceText}`,
      });
    } else {
      // HM step: include instructions + evidence summary
      const evidenceTable = evidence.rows.length > 0
        ? `\n\nDatos concretos (${evidence.rows.length}):\n${evidence.rows.map((r) => `• ${r.label}: ${r.value}${r.proposed ? ` → ${r.proposed}` : ""}`).join("\n")}`
        : "";
      prompt = `${task.objective}\n\nCompleta este paso y marca como hecho.${evidenceTable}`;
    }

    // Validate no vague references in prompt text
    const vagueCheck = validateNoVagueReferences(prompt ?? "", evidence.rows.length);
    if (!vagueCheck.valid) {
      console.warn(`[task-decomposer] Vague references in step ${i + 1}: ${vagueCheck.vagueMatches.join(", ")}`);
    }

    // Store evidence rows in stagedChange for UI rendering
    const stepEvidence = evidence.rows.length > 0
      ? { type: "evidence" as const, rows: evidence.rows }
      : null;

    await prisma.planStep.create({
      data: {
        taskId,
        order: i + 1,
        title: step.title,
        type: step.type === "AI" ? "AI" : "HUMAN",
        prompt,
        acceptanceCriteria: catalogEntry.acceptance,
        status: "PENDING",
        stagedChange: stepEvidence as unknown as Parameters<typeof prisma.planStep.create>[0]["data"]["stagedChange"],
        notes: [
          step.type === "AI" ? `complexity:${catalogEntry.complexity}` : null,
          step.humanReason ? `humanReason:${step.humanReason}` : null,
        ].filter(Boolean).join(" ") || null,
      },
    });
  }

  // Step 6: Update task
  await prisma.planTask.update({
    where: { id: taskId },
    data: {
      status: "READY",
      mode: finalMode,
      modeReason: `${resolvedSteps.length} pasos (${resolvedSteps.filter((s) => s.type === "AI").length} AI, ${resolvedSteps.filter((s) => s.type === "HM").length} HM)`,
      generatorVersion: DECOMPOSER_VERSION,
      prompt: resolvedSteps.map((s, i) => `${i + 1}. [${(s as unknown as { type: string }).type === "AI" ? "IA" : "HM"}] ${(s as unknown as { title: string }).title}`).join("\n"),
    },
  });

  console.log(
    `[task-decomposer] ✓ "${task.title}" — ${classification.actionType}/${platformKey} → ${resolvedSteps.length} steps (${finalMode}) ` +
    `[confidence: ${classification.confidence.toFixed(2)}, evidence: ${evidence.rows.length} rows]`
  );

  // Check if all tasks in plan are ready → ACTIVE
  const planTasks = await prisma.planTask.findMany({
    where: { planId: task.planId },
    select: { status: true },
  });
  if (planTasks.length > 0 && planTasks.every((t) => t.status !== "PLANNING")) {
    const planRecord = await prisma.monthlyPlan.findUnique({ where: { id: task.planId }, select: { status: true } });
    if (planRecord?.status === "PLANNING") {
      await prisma.monthlyPlan.update({ where: { id: task.planId }, data: { status: "ACTIVE" } });
      console.log(`[task-decomposer] Plan ${task.planId} → ACTIVE`);
    }
  }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[task-decomposer] ✗ Task "${task.title}" failed:`, errMsg);

    await prisma.planTask.update({
      where: { id: taskId },
      data: { status: "FAILED", failureReason: errMsg },
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract capabilities list from the WP capabilities context string. */
function extractCapsList(wpCapabilitiesContext: string): string[] | null {
  const match = wpCapabilitiesContext.match(/Endpoints activos:\s*(.+)/);
  if (!match) return null;
  return match[1].split(",").map((s) => s.trim()).filter(Boolean);
}
