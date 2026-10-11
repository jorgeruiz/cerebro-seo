/**
 * Script de cierre S2d para Quicsa:
 *
 * 1. Retriggerea la tarea AEO que quedó stuck en PLANNING
 * 2. Agrega 2 candidatas nuevas al plan:
 *    - Artículo pilar PAC (AI)
 *    - Landing Mantenimiento Chillers (HYBRID)
 *
 * Uso:
 *   DATABASE_URL="..." REDIS_URL="..." npx tsx scripts/s2d-quicsa-fixes.ts --dry-run
 *   DATABASE_URL="..." REDIS_URL="..." npx tsx scripts/s2d-quicsa-fixes.ts
 */

import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(dryRun ? "🔍 Modo --dry-run\n" : "🚀 Modo real\n");

  // ── 1. Encontrar el plan de Quicsa del mes actual ─────────────────────
  const quicsaClient = await prisma.client.findFirst({
    where: { name: { contains: "Quicsa", mode: "insensitive" } },
    select: { id: true, name: true },
  });

  if (!quicsaClient) {
    console.error("❌ No se encontró cliente Quicsa");
    process.exit(1);
  }

  console.log(`✓ Cliente: ${quicsaClient.name} (${quicsaClient.id})`);

  // Find the plan (could be any month that has tasks)
  const plan = await prisma.monthlyPlan.findFirst({
    where: { clientId: quicsaClient.id },
    orderBy: { month: "desc" },
    include: {
      tasks: {
        orderBy: { order: "asc" },
        include: { steps: { select: { id: true, title: true, type: true, status: true } } },
      },
    },
  });

  if (!plan) {
    console.error("❌ No se encontró plan para Quicsa");
    process.exit(1);
  }

  console.log(`✓ Plan: ${plan.id} (${plan.month}, status: ${plan.status})`);
  console.log(`  Tareas: ${plan.tasks.length}\n`);

  // ── 2. Mostrar estado de todas las tareas ─────────────────────────────
  console.log("| # | Título | Status | Mode | Steps |");
  console.log("|---|--------|--------|------|-------|");
  for (const t of plan.tasks) {
    console.log(`| ${t.order} | ${t.title.slice(0, 40)} | ${t.status} | ${t.mode} | ${t.steps.length} |`);
  }
  console.log("");

  // ── 3. Retriggear tarea AEO stuck en PLANNING ────────────────────────
  const aeoTask = plan.tasks.find(
    (t) => t.status === "PLANNING" && (t.title.toLowerCase().includes("aeo") || t.category === "aeo")
  );

  if (aeoTask) {
    console.log(`🔄 Tarea AEO encontrada: "${aeoTask.title}" (${aeoTask.id}) — PLANNING`);

    if (!dryRun) {
      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) {
        console.error("❌ REDIS_URL no configurada");
        process.exit(1);
      }

      // Re-enqueue decomposition
      const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
      const queue = new Queue("task-decompose", { connection: redis });

      await prisma.planTask.update({
        where: { id: aeoTask.id },
        data: { failureReason: null },
      });

      // Delete any partial steps
      await prisma.planStep.deleteMany({ where: { taskId: aeoTask.id } });

      await queue.add("task:decompose", {
        taskId: aeoTask.id,
        clientId: quicsaClient.id,
        candidateId: "s2d-retry",
      });

      console.log("  ✅ Job task:decompose reencolado en ai-analysis");
      await queue.close();
      await redis.quit();
    } else {
      console.log("  (dry-run: no se reencola)");
    }
  } else {
    const failedAeo = plan.tasks.find(
      (t) => (t.title.toLowerCase().includes("aeo") || t.category === "aeo")
    );
    if (failedAeo) {
      console.log(`ℹ Tarea AEO encontrada pero en status ${failedAeo.status}: "${failedAeo.title}"`);
    } else {
      console.log("ℹ No hay tarea AEO stuck en PLANNING");
    }
  }

  // ── 4. Agregar candidata AI: Artículo pilar PAC ──────────────────────
  const site = await prisma.site.findFirst({
    where: { client: { id: quicsaClient.id } },
    select: { id: true, githubRepo: true, platform: true },
  });

  if (!site) {
    console.error("❌ No se encontró site para Quicsa");
    process.exit(1);
  }

  const maxOrder = Math.max(...plan.tasks.map((t) => t.order), 0);

  const aiCandidate = {
    title: "Artículo pilar: Policloruro de aluminio (PAC) para tratamiento de agua",
    objective: "Crear un artículo pilar de 2,000-3,000 palabras sobre policloruro de aluminio (PAC) y su uso en tratamiento de agua industrial. El artículo debe posicionar para 'policloruro de aluminio', 'PAC tratamiento de agua', 'coagulante PAC agua industrial' y variantes long-tail. Estructura: qué es el PAC (composición química, presentaciones), para qué se usa (clarificación, potabilización, tratamiento de efluentes), ventajas vs sulfato de aluminio, dosificación general, sectores que lo utilizan. NO inventar datos específicos de Quicsa (clientes, precios, capacidades, certificaciones) — esos se agregan en un paso HUMAN posterior. El contenido técnico debe basarse en información pública del sector químico. Tono técnico pero accesible para responsables de plantas de tratamiento.",
    prompt: "",
    acceptanceCriteria: [
      "Artículo publicado en /blog/policloruro-de-aluminio-pac con meta title < 60 chars y meta description < 155 chars",
      "Contiene al menos 2,000 palabras de contenido técnicamente correcto sobre PAC",
      "Incluye schema Article con autor, fecha, y breadcrumbs",
      "Tiene al menos 3 enlaces internos a páginas de productos/servicios de Quicsa",
      "Incluye CTA de contacto/cotización al final",
      "NO contiene datos inventados sobre Quicsa (precios, clientes, capacidades, certificaciones)",
      "Build pasa sin errores",
    ],
    mode: "AI" as const,
    kind: "CONTENT" as const,
    effort: "HIGH" as const,
    priority: 3,
    category: "blog",
    sourceCandidateId: `s2d-ai-pac-${randomUUID().slice(0, 8)}`,
  };

  const hybridCandidate = {
    title: "Landing page: Mantenimiento preventivo y correctivo de chillers industriales",
    objective: "Crear una landing page de servicio para mantenimiento de chillers industriales. Target keywords: 'mantenimiento chillers industriales', 'servicio chillers monterrey', 'reparación chillers'. La página debe comunicar expertise técnico de Quicsa en sistemas de enfriamiento industrial, incluir tipos de chillers que atienden, proceso de diagnóstico, beneficios del mantenimiento preventivo, y formulario de contacto/cotización. HYBRID porque: la IA genera la estructura y contenido base, pero el equipo debe revisar datos técnicos específicos de Quicsa (modelos, capacidades, certificaciones) y agregar fotos reales.",
    prompt: "",
    acceptanceCriteria: [
      "Landing publicada en /servicios/mantenimiento-chillers con H1 que incluya keyword principal",
      "Meta title < 60 chars, meta description < 155 chars con CTA",
      "Incluye al menos 4 secciones: intro, tipos de chillers, proceso de servicio, beneficios/CTA",
      "Schema Service con areaServed y provider (sin priceRange — no hay dato en site-spec)",
      "Formulario de contacto funcional conectado al existente",
      "NO contiene datos inventados de Quicsa (precios, modelos específicos, certificaciones, casos)",
      "Build pasa sin errores",
      "[HUMAN] Verificar datos técnicos: modelos de chillers, capacidades en TR/BTU, certificaciones",
      "[HUMAN] Agregar fotos reales de trabajos de Quicsa en chillers",
    ],
    mode: "HYBRID" as const,
    kind: "CONTENT" as const,
    effort: "HIGH" as const,
    priority: 4,
    category: "landing",
    sourceCandidateId: `s2d-hybrid-chillers-${randomUUID().slice(0, 8)}`,
  };

  const candidates = [aiCandidate, hybridCandidate];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const existing = plan.tasks.find((t) => t.title === c.title);
    if (existing) {
      console.log(`⏭ Ya existe: "${c.title.slice(0, 50)}..." (${existing.status})`);
      continue;
    }

    console.log(`\n➕ Candidata ${c.mode}: "${c.title.slice(0, 60)}..."`);
    console.log(`   Kind: ${c.kind} | Effort: ${c.effort} | Priority: ${c.priority}`);

    if (!dryRun) {
      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) {
        console.error("❌ REDIS_URL no configurada");
        process.exit(1);
      }

      const task = await prisma.planTask.create({
        data: {
          planId: plan.id,
          siteId: site.id,
          order: maxOrder + i + 1,
          title: c.title,
          objective: c.objective,
          prompt: c.prompt,
          acceptanceCriteria: c.acceptanceCriteria,
          mode: c.mode,
          kind: c.kind,
          priority: c.priority,
          effort: c.effort,
          category: c.category,
          sourceCandidateId: c.sourceCandidateId,
          status: "PLANNING",
        },
      });

      console.log(`   ✅ Tarea creada: ${task.id}`);

      // Enqueue decomposition
      const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
      const queue = new Queue("task-decompose", { connection: redis });

      await queue.add("task:decompose", {
        taskId: task.id,
        clientId: quicsaClient.id,
        candidateId: c.sourceCandidateId,
      });

      console.log(`   ✅ Job task:decompose encolado`);
      await queue.close();
      await redis.quit();
    } else {
      console.log(`   (dry-run: no se crea)`);
    }
  }

  console.log("\n✅ Script completado.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
