/**
 * Backlinks Worker — procesa jobs de análisis de backlinks en DataForSEO.
 *
 * Maneja el job "analysis:backlinks" en la queue "data-collection".
 * Frecuencia: jueves 5 AM (registrado en schedulers.ts).
 *
 * Lógica:
 *   1. Obtiene summary (totalBacklinks, referringDomains) vía API
 *   2. Obtiene lista top 200 ordenados por domain_from_rank desc
 *   3. Reconcilia con BD: upsert activos, marca LOST los que desaparecen
 *   4. Crea BacklinkSnapshot semanal
 *   5. Genera insights algorítmicos determinísticos (sin Claude)
 *
 * Concurrencia: 2 clientes en paralelo.
 */

import { createWorker } from "./base-worker";
import { prisma } from "@/lib/db";
import { DataForSeoProvider } from "@/server/providers/dataforseo";
import { InsightType } from "@prisma/client";

interface BacklinksJobData {
  clientId: string;
}

export const backlinksWorker = createWorker<BacklinksJobData>(
  "data-collection",
  async (job) => {
    if (job.name !== "analysis:backlinks") return;

    const { clientId } = job.data;
    const client = await prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { id: true, name: true, domain: true, services: true },
    });

    if (!client.services.includes("seo")) {
      console.log(`[backlinks] ${client.name} no tiene servicio SEO — skipping`);
      return;
    }

    const provider = new DataForSeoProvider();
    const today = new Date();

    // 1. Summary (total + referring domains)
    const summary = await provider.getBacklinksSummary(client.domain);

    // 2. Lista top 200 por domain_from_rank desc
    const fetched = await provider.getBacklinks(client.domain, { limit: 200 });

    // 3. Reconciliar con BD
    const existingActive = await prisma.backlink.findMany({
      where: { clientId, status: "ACTIVE" },
      select: { id: true, sourceUrl: true, targetUrl: true },
    });

    const existingKeySet = new Set(
      existingActive.map((b) => `${b.sourceUrl}::${b.targetUrl}`)
    );
    const fetchedKeySet = new Set(
      fetched.map((b) => `${b.sourceUrl}::${b.targetUrl}`)
    );

    // 3a. Upsert nuevos / confirmar existentes
    let gainedCount = 0;
    for (const bl of fetched) {
      const key = `${bl.sourceUrl}::${bl.targetUrl}`;
      const isNew = !existingKeySet.has(key);

      await prisma.backlink.upsert({
        where: {
          clientId_sourceUrl_targetUrl: {
            clientId,
            sourceUrl: bl.sourceUrl,
            targetUrl: bl.targetUrl,
          },
        },
        create: {
          clientId,
          sourceDomain: bl.sourceDomain,
          sourceUrl: bl.sourceUrl,
          targetUrl: bl.targetUrl,
          anchorText: bl.anchorText,
          followType: bl.followType,
          domainAuthority: bl.domainAuthority,
          status: "ACTIVE",
          firstSeen: bl.firstSeen,
          lastSeen: today,
          lostAt: null,
        },
        update: {
          status: "ACTIVE",
          lastSeen: today,
          lostAt: null,
          anchorText: bl.anchorText,
          followType: bl.followType,
          domainAuthority: bl.domainAuthority,
        },
      });

      if (isNew) gainedCount++;
    }

    // 3b. Marcar LOST los que ya no aparecen
    const lostBacklinks = existingActive.filter(
      (b) => !fetchedKeySet.has(`${b.sourceUrl}::${b.targetUrl}`)
    );

    if (lostBacklinks.length > 0) {
      await prisma.backlink.updateMany({
        where: { id: { in: lostBacklinks.map((b) => b.id) } },
        data: { status: "LOST", lostAt: today },
      });
    }

    // 4. Calcular métricas de dofollow desde lista fetched
    const dofollowCount = fetched.filter((b) => b.followType === "follow").length;
    const nofollowCount = fetched.length - dofollowCount;

    const drs = fetched
      .map((b) => b.domainAuthority)
      .filter((d): d is number => d !== null);
    const avgDomainRank =
      drs.length > 0 ? drs.reduce((a, b) => a + b, 0) / drs.length : null;

    // 5. Crear BacklinkSnapshot
    await prisma.backlinkSnapshot.create({
      data: {
        clientId,
        totalBacklinks: summary.totalBacklinks,
        uniqueDomains: summary.referringDomains,
        avgDomainRank,
        dofollowCount,
        nofollowCount,
        gainedThisWeek: gainedCount,
        lostThisWeek: lostBacklinks.length,
        capturedAt: today,
      },
    });

    // 6. Generar insights algorítmicos
    const lostDetails = await prisma.backlink.findMany({
      where: { id: { in: lostBacklinks.map((b) => b.id) } },
      select: { sourceDomain: true, domainAuthority: true },
      orderBy: { domainAuthority: "desc" },
      take: 5,
    });

    await generateBacklinkInsights({
      clientId,
      gainedCount,
      lostCount: lostBacklinks.length,
      lostDetails,
    });

    console.log(
      `[backlinks] ${client.name}: ${summary.totalBacklinks} total, ` +
        `+${gainedCount} nuevos, -${lostBacklinks.length} perdidos`
    );
  },
  { concurrency: 2 }
);

// ─── Insights algorítmicos ──────────────────────────────────────────────────

async function generateBacklinkInsights({
  clientId,
  gainedCount,
  lostCount,
  lostDetails,
}: {
  clientId: string;
  gainedCount: number;
  lostCount: number;
  lostDetails: { sourceDomain: string; domainAuthority: number | null }[];
}) {
  const week = new Date().toISOString().slice(0, 10);

  // Backlinks ganados
  if (gainedCount >= 5) {
    await prisma.insight.create({
      data: {
        clientId,
        type: InsightType.WIN,
        severity: gainedCount >= 10 ? "HIGH" : "MEDIUM",
        title: `${gainedCount} backlinks nuevos esta semana`,
        description: `Se detectaron ${gainedCount} backlinks nuevos en el crawl semanal de DataForSEO.`,
        suggestedAction:
          "Revisa los dominios referentes nuevos para identificar campañas o menciones que estén funcionando.",
        dataPoints: { gainedCount, week },
      },
    });
  }

  // Backlinks perdidos generales
  if (lostCount >= 3) {
    await prisma.insight.create({
      data: {
        clientId,
        type: InsightType.WARNING,
        severity: lostCount >= 10 ? "HIGH" : "MEDIUM",
        title: `${lostCount} backlinks perdidos esta semana`,
        description: `Se detectaron ${lostCount} backlinks que ya no apuntan al sitio.`,
        suggestedAction:
          "Revisa las URLs perdidas para entender si fue por cambio de contenido del sitio fuente, eliminación intencional, o problema técnico.",
        dataPoints: { lostCount, week },
      },
    });
  }

  // Alta autoridad perdidos (DA >= 50)
  const highAuthorityLost = lostDetails.filter((b) => (b.domainAuthority ?? 0) >= 50);
  if (highAuthorityLost.length >= 1) {
    const domainList = highAuthorityLost
      .slice(0, 3)
      .map((b) => `${b.sourceDomain} (DA ${b.domainAuthority})`)
      .join(", ");

    await prisma.insight.create({
      data: {
        clientId,
        type: InsightType.WARNING,
        severity: "HIGH",
        title: `${highAuthorityLost.length} backlink(s) de alta autoridad perdidos`,
        description: `Perdiste enlaces de dominios con DA ≥ 50: ${domainList}.`,
        suggestedAction:
          "Contacta a los dominios para entender el motivo o intenta recuperar el enlace con outreach.",
        dataPoints: {
          count: highAuthorityLost.length,
          domains: highAuthorityLost.map((b) => b.sourceDomain),
        },
      },
    });
  }
}
