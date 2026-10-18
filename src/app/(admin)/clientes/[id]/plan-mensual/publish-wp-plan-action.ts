"use server";

/**
 * Accion: Publicar Plan WordPress.
 *
 * Cuando el usuario hace clic en "Publicar Plan" en un sitio WordPress:
 *
 * 1. GUARD — bloquea si algun borrador de blog contiene [COMPLETAR pendientes.
 *    El usuario debe editar el borrador en WP Admin antes de publicar.
 *
 * 2. RESOLUCION page_id=0 — para steps SEO con page_id desconocido,
 *    llama GET /pages y busca coincidencia por titulo/slug vs el objective.
 *    Si no hay coincidencia unica: bloquea esa tarea (no bloquea las demas).
 *
 * 3. PUBLICAR BORRADORES — para steps de blog con stagedChange.type="blog",
 *    llama PUT /update/{post_id} con status="publish".
 *    Guarda el link publico en PlanTask.resultUrls.
 *
 * 4. APLICAR META TAGS — para steps SEO con stagedChange.type="seo" y page_id>0,
 *    llama POST /seo/{page_id}.
 *    Actualiza step.stagedChange con applied_at.
 *
 * Reglas:
 * - Un [COMPLETAR en cualquier borrador bloquea TODO el publish (guard duro).
 * - Un page_id=0 no resuelto bloquea solo ese step (las demas tareas se publican).
 * - Errores de red en un step se reportan pero no bloquean el resto.
 */

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getWpPages, updateWpPost, updateWpSeo, applyWpElementorDraft } from "@/lib/wp-proxy-client";
import { parseStagedChange, isBlogChange, isSeoChange, isElementorChange } from "@/lib/wp-staged-change";
import type { WpStagedSeoChange } from "@/lib/wp-staged-change";

// --- Tipos -------------------------------------------------------------------

export type PublishWpPlanResult =
  | { ok: true; published: number; metaApplied: number; elementorApplied: number; skipped: number; failed: number; details: string[] }
  | { ok: false; blocked: true; reason: string; details: string[] }
  | { ok: false; error: string };

// --- Action ------------------------------------------------------------------

export async function publishWpPlanAction(planId: string): Promise<PublishWpPlanResult> {
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "No autenticado" };

  // Cargar plan + tareas + steps con stagedChange + site WP
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
              // solo steps con cambios staged
              NOT: { stagedChange: { equals: null } },
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

  // Recopilar todos los steps con stagedChange valido
  const stepsWithChanges = plan.tasks.flatMap((task) =>
    task.steps
      .map((step) => ({ step, task, change: parseStagedChange(step.stagedChange) }))
      .filter((s): s is typeof s & { change: NonNullable<typeof s.change> } => s.change !== null),
  );

  if (stepsWithChanges.length === 0) {
    return { ok: true, published: 0, metaApplied: 0, elementorApplied: 0, skipped: 0, failed: 0, details: ["No hay cambios staged para publicar"] };
  }

  // =========================================================================
  // 1. GUARD: bloquear si hay borradores con [COMPLETAR pendientes
  // =========================================================================
  const guardErrors: string[] = [];
  for (const { step, change } of stepsWithChanges) {
    if (isBlogChange(change) && change.has_placeholders) {
      guardErrors.push(
        `Tarea "${step.title}": ${change.placeholder_count} placeholder(s) pendiente(s).\n` +
        change.placeholder_samples.map((s) => `  ${s}`).join("\n"),
      );
    }
  }
  if (guardErrors.length > 0) {
    return {
      ok: false,
      blocked: true,
      reason: `${guardErrors.length} borrador(es) con placeholders [COMPLETAR sin completar. Edita en WP Admin antes de publicar.`,
      details: guardErrors,
    };
  }

  // =========================================================================
  // 2. RESOLUCION page_id=0 — intenta resolver via GET /pages
  // =========================================================================
  let wpPages: Array<{ id: number; title: string; slug: string; link: string }> | null = null;

  // Recopilar steps SEO con page_id=0
  const seoStepsNeedingResolution = stepsWithChanges.filter(
    ({ change }) => isSeoChange(change) && change.page_id === 0,
  );

  if (seoStepsNeedingResolution.length > 0) {
    const pagesResult = await getWpPages(cerebroClientId);
    if (pagesResult.ok) {
      wpPages = pagesResult.data;
    }
  }

  // Intentar resolver page_id=0 para cada step SEO
  const resolvedSeoChanges = new Map<string, WpStagedSeoChange>(); // step.id -> change con page_id resuelto
  const unresolvedStepTitles: string[] = [];

  for (const { step, change } of seoStepsNeedingResolution) {
    if (!isSeoChange(change)) continue;

    const resolved = wpPages ? tryResolvePageId(change.objective, wpPages) : null;
    if (resolved !== null) {
      const updatedChange: WpStagedSeoChange = { ...change, page_id: resolved };
      resolvedSeoChanges.set(step.id, updatedChange);
      // Persistir la resolucion en DB
      await prisma.planStep.update({
        where: { id: step.id },
        data: { stagedChange: updatedChange },
      }).catch(() => {});
    } else {
      unresolvedStepTitles.push(`"${step.title}" (objective: ${change.objective.slice(0, 60)})`);
    }
  }

  // =========================================================================
  // 3. PUBLICAR BORRADORES DE BLOG + 4. APLICAR META TAGS
  // =========================================================================
  let published = 0;
  let metaApplied = 0;
  let elementorApplied = 0;
  let skipped = 0;
  let failed = 0;
  const details: string[] = [];

  for (const { step, task, change } of stepsWithChanges) {
    // --- Blog: publicar borrador ---
    if (isBlogChange(change)) {
      if (!change.post_id) {
        skipped++;
        details.push(`Omitido "${step.title}": post_id no disponible`);
        continue;
      }

      const publishResult = await updateWpPost(cerebroClientId, change.post_id, { status: "publish" });

      if (!publishResult.ok) {
        failed++;
        details.push(`Error publicando "${step.title}": ${publishResult.error}`);
        continue;
      }

      published++;
      const publicUrl = publishResult.data.link ?? change.draft_url ?? null;
      details.push(`Publicado "${step.title}" — post_id=${change.post_id}${publicUrl ? ` url=${publicUrl}` : ""}`);

      // Agregar URL publica a resultUrls de la tarea
      if (publicUrl) {
        const currentUrls = task.resultUrls as string[];
        if (!currentUrls.includes(publicUrl)) {
          await prisma.planTask.update({
            where: { id: task.id },
            data: { resultUrls: [...currentUrls, publicUrl] },
          }).catch(() => {});
        }
      }

      // Actualizar stagedChange con la URL final
      const publishedChange = { ...change, published_at: new Date().toISOString(), public_url: publicUrl };
      await prisma.planStep.update({
        where: { id: step.id },
        data: { stagedChange: publishedChange },
      }).catch(() => {});
    }

    // --- Elementor: aplicar borrador a pagina original ---
    else if (isElementorChange(change)) {
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

      // Persistir revision_id + applied_at en stagedChange para posible revert
      const appliedChange = {
        ...change,
        revision_id: applyResult.data.revision_id ?? undefined,
        applied_at: new Date().toISOString(),
      };
      await prisma.planStep.update({
        where: { id: step.id },
        data: { stagedChange: appliedChange },
      }).catch(() => {});

      // Agregar URL publica a resultUrls de la tarea
      if (applyResult.data.link) {
        const currentUrls = task.resultUrls as string[];
        if (!currentUrls.includes(applyResult.data.link)) {
          await prisma.planTask.update({
            where: { id: task.id },
            data: { resultUrls: [...currentUrls, applyResult.data.link] },
          }).catch(() => {});
        }
      }
    }

    // --- SEO: aplicar meta tags ---
    else if (isSeoChange(change)) {
      // Usar page_id resuelto si hubo resolucion
      const effectiveChange = resolvedSeoChanges.get(step.id) ?? change;
      const { page_id, meta_title, meta_description, focus_keyword } = effectiveChange;

      if (page_id === 0) {
        skipped++;
        details.push(`Omitido "${step.title}": page_id=0 no se pudo resolver automaticamente`);
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

      // Marcar como aplicado en stagedChange
      const appliedChange = { ...effectiveChange, applied_at: new Date().toISOString() };
      await prisma.planStep.update({
        where: { id: step.id },
        data: { stagedChange: appliedChange },
      }).catch(() => {});
    }
  }

  // Agregar advertencias de steps SEO no resueltos (ya contados en skipped durante el loop principal)
  for (const title of unresolvedStepTitles) {
    details.push(`Omitido ${title}: page_id=0 sin coincidencia en /pages — especificar manualmente`);
  }

  console.log(
    `[publish-wp-plan] planId=${planId} published=${published} meta=${metaApplied} ` +
    `elementor=${elementorApplied} skipped=${skipped} failed=${failed}`,
  );

  return { ok: true, published, metaApplied, elementorApplied, skipped, failed, details };
}

// --- Helpers -----------------------------------------------------------------

/**
 * Intenta resolver page_id=0 buscando una coincidencia en la lista de paginas WP.
 * Usa el texto del objective para comparar con titulos y slugs.
 * Solo devuelve un ID si hay exactamente 1 coincidencia clara.
 */
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

  // Solo resolver si hay una unica coincidencia — evitar falsos positivos
  if (matches.length === 1) return matches[0].id;
  return null;
}
