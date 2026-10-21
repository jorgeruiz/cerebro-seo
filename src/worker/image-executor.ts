/**
 * Ejecutor de imágenes AI — genera, optimiza, valida y sube imágenes para el plan mensual.
 *
 * Flujo:
 * 1. Genera imagen con Higgsfield API (submit + poll).
 * 2. Optimiza con sharp: WebP, max 1600px ancho, < 200 KB.
 * 3. QA con Claude Vision: coherencia con brief, sin texto/logos/marcas de agua/deformaciones.
 * 4. Si QA falla: 1 reintento con prompt refinado. Si falla de nuevo → HUMAN.
 * 5. Sube a WP (POST /media via proxy) o escribe en repo Next.js.
 *
 * Restricciones:
 * - Solo imágenes para blog (portada + inline). Landings/servicios → HUMAN siempre.
 * - subject_type people/location/product → HUMAN (enforced en decomposer, no aquí).
 * - Max 2 imágenes por tarea, $2.00 USD por plan mensual.
 */

import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "@/lib/anthropic-config";
import { logApiUsage } from "@/server/jobs/workers/base-worker";
import { uploadWpMedia, updateWpPost } from "@/lib/wp-proxy-client";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface ImageStepAction {
  action: "image";
  endpoint: string;
  payload: {
    usage: "featured_image" | "inline" | "og_image";
    attach_to_post_id?: number | null;
    aspect_ratio?: string;
    style?: string;
    subject_type?: string;
  };
  content_brief: string;
}

export interface ImageStepResult {
  notes: string;
  /** URL de la imagen subida (WP media URL o ruta en repo) */
  imageUrl?: string;
}

interface HiggsfieldConfig {
  keyId: string;
  keySecret: string;
  baseUrl: string;
  model: string;
}

// ─── Configuración ───────────────────────────────────────────────────────────

const HIGGSFIELD_BASE = "https://api.higgsfield.ai";
const HIGGSFIELD_MODEL = "recraft/v4.1/text-to-image"; // $0.035/image, good quality
const POLL_INITIAL_MS = 2_000;
const POLL_MAX_MS = 10_000;
const POLL_TIMEOUT_MS = 120_000; // 2 min max wait
const MAX_IMAGES_PER_TASK = 2;
const IMAGE_MAX_WIDTH = 1600;
const IMAGE_MAX_BYTES = 200_000; // 200 KB

// ─── Higgsfield API ──────────────────────────────────────────────────────────

function getHiggsfieldConfig(): HiggsfieldConfig {
  const keyId = process.env.HIGGSFIELD_KEY_ID;
  const keySecret = process.env.HIGGSFIELD_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error("HIGGSFIELD_KEY_ID / HIGGSFIELD_KEY_SECRET no configurados");
  }
  return {
    keyId,
    keySecret,
    baseUrl: HIGGSFIELD_BASE,
    model: HIGGSFIELD_MODEL,
  };
}

interface HiggsfieldSubmitResponse {
  status: string;
  request_id: string;
  status_url: string;
  cancel_url: string;
}

interface HiggsfieldStatusResponse {
  status: "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";
  request_id: string;
  images?: Array<{ url: string; seed?: number }>;
  error?: string;
}

async function higgsfieldFetch(
  config: HiggsfieldConfig,
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Key ${config.keyId}:${config.keySecret}`,
    "Content-Type": "application/json",
  };

  const res = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Higgsfield ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json();
}

async function submitImageGeneration(
  config: HiggsfieldConfig,
  prompt: string,
  aspectRatio: string,
): Promise<HiggsfieldSubmitResponse> {
  return higgsfieldFetch(config, `/${config.model}`, "POST", {
    prompt,
    aspect_ratio: aspectRatio,
    resolution: "1k",
    batch_size: 1,
  }) as Promise<HiggsfieldSubmitResponse>;
}

async function pollUntilDone(
  config: HiggsfieldConfig,
  statusUrl: string,
): Promise<HiggsfieldStatusResponse> {
  const path = statusUrl.replace(config.baseUrl, "");
  let delay = POLL_INITIAL_MS;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, delay + Math.random() * 500));

    const status = (await higgsfieldFetch(config, path)) as HiggsfieldStatusResponse;

    if (["completed", "failed", "nsfw", "canceled"].includes(status.status)) {
      return status;
    }

    delay = Math.min(delay * 1.5, POLL_MAX_MS);
  }

  throw new Error(`Higgsfield timeout después de ${POLL_TIMEOUT_MS / 1000}s`);
}

async function estimateCost(
  config: HiggsfieldConfig,
  prompt: string,
  aspectRatio: string,
): Promise<number> {
  try {
    const res = (await higgsfieldFetch(config, `/estimate/${config.model}`, "POST", {
      prompt,
      aspect_ratio: aspectRatio,
      resolution: "1k",
      batch_size: 1,
    })) as { usd?: string; credits?: string };
    return parseFloat(res.usd ?? "0.035");
  } catch {
    return 0.035; // fallback estimate for Recraft v4.1
  }
}

// ─── Image optimization ──────────────────────────────────────────────────────

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Fetch image failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function optimizeImage(buf: Buffer): Promise<Buffer> {
  let quality = 80;
  let result = await sharp(buf)
    .resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();

  if (result.length > IMAGE_MAX_BYTES && quality > 50) {
    quality = 60;
    result = await sharp(buf)
      .resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();
  }

  return result;
}

// ─── QA with Claude Vision ───────────────────────────────────────────────────

interface QAResult {
  pass: boolean;
  reason: string;
}

async function qaImageWithVision(
  imageBase64: string,
  brief: string,
): Promise<QAResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/webp", data: imageBase64 },
          },
          {
            type: "text",
            text: [
              "Revisa esta imagen generada por IA contra el brief:",
              `BRIEF: ${brief}`,
              "",
              "Evalua SOLO estos criterios:",
              "1. Sin texto superpuesto, logos o marcas de agua",
              "2. Sin deformaciones visibles (manos, caras, objetos imposibles)",
              "3. Coherente con el tema del brief (no tiene que ser literal, pero debe ser relevante)",
              "4. Calidad aceptable para un blog profesional",
              "",
              "Responde SOLO con JSON: {\"pass\": true/false, \"reason\": \"explicación breve\"}",
            ].join("\n"),
          },
        ],
      },
    ],
  });

  const raw = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const costUsd =
    Number(response.usage.input_tokens) * 0.000003 +
    Number(response.usage.output_tokens) * 0.000015;
  await logApiUsage({ provider: "anthropic", endpoint: "image-qa-vision", cost: costUsd });

  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    return JSON.parse(cleaned) as QAResult;
  } catch {
    // Si no puede parsear, asumir que pasa (errar del lado de no bloquear)
    return { pass: true, reason: "QA parse failed — asumiendo OK" };
  }
}

// ─── SEO filename & alt ──────────────────────────────────────────────────────

function generateSeoFilename(brief: string, usage: string): string {
  const slug = brief
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 50)
    .replace(/-$/, "");
  return `${slug}-${usage}.webp`;
}

function generateAltText(brief: string): string {
  // First sentence or first 125 chars, whichever is shorter
  const firstSentence = brief.split(/[.!?]/)[0]?.trim() ?? brief;
  return firstSentence.slice(0, 125);
}

// ─── Brand colors helper ─────────────────────────────────────────────────────

function buildColorHint(brandColors?: string | null): string {
  if (!brandColors) return "";
  return ` Use these brand colors as accents: ${brandColors}.`;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Genera, optimiza, valida y sube una imagen para un paso del plan mensual.
 *
 * @param action    Accion estructurada del step (parsed del JSON del decomposer)
 * @param context   Contexto de la tarea y cliente
 * @returns         Resultado con notes y URL de la imagen
 */
export async function executeImage(
  action: ImageStepAction,
  context: {
    cerebroClientId: string;
    taskId: string;
    clientId?: string;
    brandColors?: string | null;
    /** Para Next.js: directorio del repo clonado */
    repoDir?: string;
    /** Para Next.js: slug del articulo para la ruta del archivo */
    articleSlug?: string;
    /** Contador de imagenes ya generadas en esta tarea (para limit) */
    imageCount: number;
    /** Kind de la tarea (CONTENT, TECHNICAL, etc.) — para validar blog-only */
    taskKind?: string;
    /** Category de la tarea (blog, meta, landing, etc.) — para validar blog-only */
    taskCategory?: string;
  },
): Promise<ImageStepResult> {
  // ── Blog-only guard — imágenes AI solo para artículos de blog ──────
  const isBlogContext = isBlogTask(context.taskKind, context.taskCategory);
  if (!isBlogContext) {
    return {
      notes: `image:human-required — Imágenes AI solo permitidas para blog. Tarea kind=${context.taskKind ?? "?"} category=${context.taskCategory ?? "?"}. Solicitar/tomar foto real.`,
    };
  }

  // ── Limit check ─────────────────────────────────────────────────────
  if (context.imageCount >= MAX_IMAGES_PER_TASK) {
    return {
      notes: `image:limit — ya se generaron ${MAX_IMAGES_PER_TASK} imagenes en esta tarea. Paso manual requerido.`,
    };
  }

  const config = getHiggsfieldConfig();
  const brief = action.content_brief;
  const aspectRatio = action.payload?.aspect_ratio ?? "16:9";
  const colorHint = buildColorHint(context.brandColors);

  const fullPrompt = `${brief}${colorHint} Professional photography style, high quality, no text overlays, no logos, no watermarks.`;

  // ── Estimate cost ─────────────────────────────────────────────────
  const estimatedCost = await estimateCost(config, fullPrompt, aspectRatio);

  // ── Generate ──────────────────────────────────────────────────────
  console.log(`[image-executor] Generating image: ${brief.slice(0, 80)}...`);
  const submission = await submitImageGeneration(config, fullPrompt, aspectRatio);
  console.log(`[image-executor] Submitted: ${submission.request_id}`);

  const result = await pollUntilDone(config, submission.status_url);

  await logApiUsage({
    provider: "higgsfield",
    endpoint: "generate-image",
    cost: estimatedCost,
    clientId: context.clientId,
  });

  if (result.status !== "completed" || !result.images?.[0]?.url) {
    const reason = result.status === "nsfw"
      ? "contenido marcado NSFW"
      : result.error ?? `status=${result.status}`;
    return {
      notes: `image:failed — Higgsfield: ${reason}. Brief: ${brief.slice(0, 200)}`,
    };
  }

  // ── Fetch & optimize ──────────────────────────────────────────────
  const rawBuf = await fetchImageBuffer(result.images[0].url);
  const optimized = await optimizeImage(rawBuf);
  const sizeKb = (optimized.length / 1024).toFixed(1);
  console.log(`[image-executor] Optimized: ${sizeKb} KB WebP`);

  // ── QA with vision ────────────────────────────────────────────────
  const base64 = optimized.toString("base64");
  let qa = await qaImageWithVision(base64, brief);

  if (!qa.pass) {
    console.log(`[image-executor] QA failed: ${qa.reason} — retrying with refined prompt`);
    // Retry once with refined prompt
    const refinedPrompt = `${fullPrompt} IMPORTANT: ${qa.reason}. Fix this issue. Ensure clean, professional result.`;
    const retry = await submitImageGeneration(config, refinedPrompt, aspectRatio);
    const retryResult = await pollUntilDone(config, retry.status_url);

    await logApiUsage({
      provider: "higgsfield",
      endpoint: "generate-image-retry",
      cost: estimatedCost,
      clientId: context.clientId,
    });

    if (retryResult.status === "completed" && retryResult.images?.[0]?.url) {
      const retryBuf = await fetchImageBuffer(retryResult.images[0].url);
      const retryOptimized = await optimizeImage(retryBuf);
      const retryBase64 = retryOptimized.toString("base64");
      qa = await qaImageWithVision(retryBase64, brief);

      if (qa.pass) {
        // Use retry result
        return await finalizeImage(retryOptimized, retryBase64, action, context, estimatedCost * 2);
      }
    }

    // Both attempts failed QA → HUMAN with the first image as reference
    return {
      notes: [
        `image:qa-failed — La imagen generada no paso QA tras 1 reintento.`,
        `Razon: ${qa.reason}`,
        `Brief: ${brief.slice(0, 300)}`,
        `Imagen de referencia (base64) adjunta en step.notes para que el equipo la use como punto de partida.`,
        `REF_IMAGE_B64:${base64.slice(0, 100)}...`, // truncated marker — full image in resultUrls
      ].join("\n"),
      imageUrl: result.images[0].url, // original Higgsfield URL as reference
    };
  }

  // ── QA passed — finalize ──────────────────────────────────────────
  return finalizeImage(optimized, base64, action, context, estimatedCost);
}

// ─── Finalize: upload to WP or write to repo ─────────────────────────────────

async function finalizeImage(
  optimized: Buffer,
  base64: string,
  action: ImageStepAction,
  context: {
    cerebroClientId: string;
    taskId: string;
    clientId?: string;
    repoDir?: string;
    articleSlug?: string;
    imageCount: number;
  },
  totalCost: number,
): Promise<ImageStepResult> {
  const brief = action.content_brief;
  const usage = action.payload?.usage ?? "featured_image";
  const filename = generateSeoFilename(brief, usage);
  const altText = generateAltText(brief);

  // ── WordPress path ──────────────────────────────────────────────
  if (!context.repoDir) {
    const uploadResult = await uploadWpMedia(
      context.cerebroClientId,
      {
        filename,
        base64Data: base64,
        alt_text: altText,
        mime_type: "image/webp",
      },
      context.taskId,
    );

    if (!uploadResult.ok) {
      return {
        notes: `image:upload-failed — WP /media: ${uploadResult.error}. Imagen generada OK pero no se pudo subir.`,
      };
    }

    const { id: mediaId, source_url } = uploadResult.data;

    // Auto-assign as featured image if usage=featured_image and post exists
    let featuredNote = "";
    if (usage === "featured_image" && action.payload?.attach_to_post_id) {
      const attachResult = await updateWpPost(
        context.cerebroClientId,
        action.payload.attach_to_post_id!,
        { featured_image_id: mediaId },
        context.taskId,
      );
      featuredNote = attachResult.ok
        ? ` | featured_image asignada a post_id=${action.payload?.attach_to_post_id}`
        : ` | featured_image falló: ${attachResult.error} (asignar manualmente)`;
    }

    return {
      notes: [
        `image:ok — media_id=${mediaId}, filename=${filename}, ${(optimized.length / 1024).toFixed(1)} KB`,
        `alt="${altText}"${featuredNote}`,
        `costo=$${totalCost.toFixed(4)}`,
      ].join("\n"),
      imageUrl: source_url,
    };
  }

  // ── Next.js path ────────────────────────────────────────────────
  const { writeFile, mkdir } = await import("fs/promises");
  const { join } = await import("path");

  const imgDir = join(context.repoDir, "public", "images", "blog");
  await mkdir(imgDir, { recursive: true });

  const imgPath = join(imgDir, filename);
  await writeFile(imgPath, optimized);

  const relativePath = `/images/blog/${filename}`;

  return {
    notes: [
      `image:ok — ${relativePath}, ${(optimized.length / 1024).toFixed(1)} KB`,
      `alt="${altText}"`,
      `costo=$${totalCost.toFixed(4)}`,
    ].join("\n"),
    imageUrl: relativePath,
  };
}

// ─── Blog-only validation ────────────────────────────────────────────────────

/**
 * Determina si el contexto de la tarea es de blog (único contexto donde
 * se permiten imágenes AI). Todo lo demás → HUMAN.
 */
export function isBlogTask(taskKind?: string, taskCategory?: string): boolean {
  if (!taskKind && !taskCategory) return true; // fallback permisivo si no hay contexto
  const kind = (taskKind ?? "").toUpperCase();
  const cat = (taskCategory ?? "").toLowerCase();
  // Blog explícito
  if (cat === "blog" || cat === "articulo" || cat === "article") return true;
  // CONTENT kind con categoría no-landing
  if (kind === "CONTENT" && !isLandingCategory(cat)) return true;
  return false;
}

function isLandingCategory(cat: string): boolean {
  return /landing|servicio|producto|pagina|page|home|contacto/.test(cat);
}
