"use server";

/**
 * Accion: Publicar Plan WordPress.
 *
 * "Publicar Plan" aplica SOLO cambios no-destructivos que no requieren revisión humana:
 *   - SEO: meta title/description/focus keyword via POST /seo/{page_id}
 *   - Elementor: aplicar borrador duplicado via POST /elementor/apply/{draftId}
 *
 * Los blogs NO se publican aquí. Los borradores de blog se revisan y publican
 * manualmente desde WP Admin. El decomposer agrega un paso HUMAN final
 * "Revisar y publicar borrador" con los links de edición.
 *
 * Flujo:
 * 1. RESOLUCION page_id=0 para steps SEO con página desconocida.
 * 2. APLICAR META TAGS — POST /seo/{page_id}.
 * 3. APLICAR ELEMENTOR — POST /elementor/apply/{draftId}.
 * 4. SKIP blog changes con nota informativa (no es error, es intencional).
 */

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getWpPages, updateWpSeo, applyWpElementorDraft } from "@/lib/wp-proxy-client";
import { parseStagedChange, isBlogChange, isSeoChange, isElementorChange } from "@/lib/wp-staged-change";
import type { WpStagedSeoChange } from "@/lib/wp-staged-change";

// --- Tipos -------------------------------------------------------------------

export type PublishWpPlanResult =
  | { ok: true; metaApplied: number; elementorApplied: number; skipped: number; failed: number; details: string[] }
  | { ok: false; blocked: true; reason: string; details: string[] }
  | { ok: false; error: string };

// --- Action ------------------------------------------------------------------

export async function publishWpPlanAction(planId: string): Promise<PublishWpPlanResult> {
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "No autenticado" };

  const plan = await prisma.monthlyPlan.findUnique({
    where: { id: planId },
    include: {
      client: {
        include: {
          sites: {
            where: { platform: { in: ["WORDPRESS", "MIGRACION"] } },
            include: { client: { select: { cerebroClientId: true } } },
            take: 1,
          },
        },
      },
      tasks: {
        where: { status: { in: ["DONE", "WAITING_HUMAN", "RUNNING"] } },
        include: {
          steps: {
            where: {
              status: "DONE",
              NOT: { stagedChange: { equals: undefined } },
            },
            orderBy: { order: "asc" },
          },
        },
      },
    },
  });

  if (!plan) return { ok: false, error: "Plan no encontrado" };

  if (plan.status === "PUBLISHED") {
    return { ok: false, error: "Plan ya publicado" };
  }

  const wpSite = plan.client.sites[0];
  if (!wpSite) return { ok: false, error: "El cliente no tiene un sitio WordPress configurado" };

  const cerebroClientId = wpSite.client?.cerebroClientId;
  if (!cerebroClientId) return { ok: false, error: "El sitio no tiene cerebroClientId" };

  // Recopilar steps con stagedChange válido
  const stepsWithChanges = plan.tasks.flatMap((task) =>
    task.steps
      .map((step) => ({ step, task, change: parseStagedChange(step.stagedChange) }))
      .filter((s): s is typeof s & { change: NonNullable<typeof s.change> } => s.change !== null),
  );

  if (stepsWithChanges.length === 0) {
    return { ok: true, metaApplied: 0, elementorApplied: 0, skipped: 0, failed: 0, details: ["No hay cambios staged para publicar"] };
  }

  // =========================================================================
  // 1. RESOLUCION page_id=0 para steps SEO
  // =========================================================================
  let wpPages: Array<{ id: number; title: string; slug: string; link: string }> | null = null;

  const seoStepsNeedingResolution = stepsWithChanges.filter(
    ({ change }) => isSeoChange(change) && change.page_id === 0,
  );

  if (seoStepsNeedingResolution.length > 0) {
    const pagesResult = await getWpPages(cerebroClientId);
    if (pagesResult.ok) {
      wpPages = pagesResult.data;
    }
  }

  const resolvedSeoChanges = new Map<string, WpStagedSeoChange>();
  const unresolvedStepTitles: string[] = [];

  for (const { step, change } of seoStepsNeedingResolution) {
    if (!isSeoChange(change)) continue;

    const resolved = wpPages ? tryResolvePageId(change.objective, wpPages) : null;
    if (resolved !== null) {
      const updatedChange: WpStagedSeoChange = { ...change, page_id: resolved };
      resolvedSeoChanges.set(step.id, updatedChange);
      await prisma.planStep.update({
        where: { id: step.id },
        data: { stagedChange: updatedChange as unknown as Parameters<typeof prisma.planStep.update>[0]["data"]["stagedChange"] },
      }).catch(() => {});
    } else {
      unresolvedStepTitles.push(`"${step.title}" (objective: ${change.objective.slice(0, 60)})`);
    }
  }

  // =========================================================================
  // 2. APLICAR META TAGS + 3. APLICAR ELEMENTOR (NO blogs)
  // =========================================================================
  let metaApplied = 0;
  let elementorApplied = 0;
  let skipped = 0;
  let failed = 0;
  const details: string[] = [];

  for (const { step, task, change } of stepsWithChanges) {
    // --- Blog: SKIP — los blogs se publican manualmente desde WP Admin ---
    if (isBlogChange(change)) {
      skipped++;
      const url = change.draft_url ?? "(sin URL)";
      details.push(`Blog "${step.title}" se queda como borrador — revisar en WP Admin: ${url}`);
      continue;
    }

    // --- Elementor: aplicar borrador a página original ---
    if (isElementorChange(change)) {
      if (!change.draft_id) {
        skipped++;
        details.push(`Omitido "${step.title}": draft_id no disponible`);
        continue;
      }

      const applyResult = await applyWpElementorDraft(
        cerebroClientId,
        change.draft_id,
        { original_id: change.page_id },
        task.id,
      );

      if (!applyResult.ok) {
        failed++;
        details.push(`Error aplicando Elementor "${step.title}": ${applyResult.error}`);
        continue;
      }

      elementorApplied++;
      details.push(
        `Elementor aplicado "${step.title}" — pagina=${change.page_id} url=${applyResult.data.link}`,
      );

      const appliedChange = {
        ...change,
        revision_id: applyResult.data.revision_id ?? undefined,
        applied_at: new Date().toISOString(),
      };
      await prisma.planStep.update({
        where: { id: step.id },
        data: { stagedChange: appliedChange as unknown as Parameters<typeof prisma.planStep.update>[0]["data"]["stagedChange"] },
      }).catch(() => {});

      if (applyResult.data.link) {
        const currentUrls = task.resultUrls as string[];
        if (!currentUrls.includes(applyResult.data.link)) {
          await prisma.planTask.update({
            where: { id: task.id },
            data: { resultUrls: [...currentUrls, applyResult.data.link] },
          }).catch(() => {});
        }
      }
      continue;
    }

    // --- SEO: aplicar meta tags ---
    if (isSeoChange(change)) {
      const effectiveChange = resolvedSeoChanges.get(step.id) ?? change;
      const { page_id, meta_title, meta_description, focus_keyword } = effectiveChange;

      if (page_id === 0) {
        skipped++;
        details.push(`Omitido "${step.title}": page_id=0 no se pudo resolver`);
        continue;
      }

      if (!meta_title || !meta_description) {
        skipped++;
        details.push(`Omitido "${step.title}": meta_title o meta_description vacios`);
        continue;
      }

      const seoResult = await updateWpSeo(cerebroClientId, page_id, {
        meta_title,
        meta_description,
        ...(focus_keyword ? { focus_keyword } : {}),
      });

      if (!seoResult.ok) {
        failed++;
        details.push(`Error aplicando meta "${step.title}": ${seoResult.error}`);
        continue;
      }

      metaApplied++;
      details.push(`Meta aplicado "${step.title}" — page_id=${page_id} title="${meta_title}"`);

      const appliedChange = { ...effectiveChange, applied_at: new Date().toISOString() };
      await prisma.planStep.update({
        where: { id: step.id },
        data: { stagedChange: appliedChange as unknown as Parameters<typeof prisma.planStep.update>[0]["data"]["stagedChange"] },
      }).catch(() => {});
    }
  }

  for (const title of unresolvedStepTitles) {
    details.push(`Omitido ${title}: page_id=0 sin coincidencia en /pages`);
  }

  console.log(
    `[publish-wp-plan] planId=${planId} meta=${metaApplied} ` +
    `elementor=${elementorApplied} skipped=${skipped} failed=${failed}`,
  );

  return { ok: true, metaApplied, elementorApplied, skipped, failed, details };
}

// --- Helpers -----------------------------------------------------------------

function tryResolvePageId(
  objective: string,
  pages: Array<{ id: number; title: string; slug: string }>,
): number | null {
  const objectiveLower = objective.toLowerCase();

  const matches = pages.filter((page) => {
    const titleLower = page.title.toLowerCase();
    const slugLower = page.slug.toLowerCase();
    return objectiveLower.includes(titleLower) || (slugLower.length > 0 && objectiveLower.includes(slugLower));
  });

  if (matches.length === 1) return matches[0].id;
  return null;
}
