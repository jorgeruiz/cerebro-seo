/**
 * Diagnostic: test resolveWpPostId for a client's URLs.
 *
 * Usage:
 *   npx tsx scripts/diag-wp-resolve.ts --client=<name> --url=/montacargas-hombre-parado/
 *   npx tsx scripts/diag-wp-resolve.ts --client=<name> --url=/          # home
 *   npx tsx scripts/diag-wp-resolve.ts --client=<name> --all            # all task targetUrls
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const clientArg = process.argv.find((a) => a.startsWith("--client="));
  const urlArg = process.argv.find((a) => a.startsWith("--url="));
  const all = process.argv.includes("--all");

  if (!clientArg) {
    console.log("Usage: npx tsx scripts/diag-wp-resolve.ts --client=<name> --url=<path>");
    process.exit(1);
  }

  const clientSlug = clientArg.replace("--client=", "").toLowerCase();
  const client = await prisma.client.findFirst({
    where: { name: { contains: clientSlug, mode: "insensitive" } },
    select: { id: true, name: true, cerebroClientId: true },
  });
  if (!client?.cerebroClientId) {
    console.log(`Client "${clientSlug}" not found or no cerebroClientId`);
    process.exit(1);
  }

  console.log(`\nClient: ${client.name} (${client.cerebroClientId})\n`);

  const { resolveWpPostId } = await import("../src/lib/wp-proxy-client");

  const urls: string[] = [];
  if (urlArg) {
    urls.push(urlArg.replace("--url=", ""));
  }
  if (all) {
    const tasks = await prisma.planTask.findMany({
      where: { site: { client: { id: client.id } }, actionType: "update_meta" },
      select: { title: true, objective: true, sourceRef: true },
    });
    for (const t of tasks) {
      const ref = t.sourceRef as { targetUrl?: string } | null;
      if (ref?.targetUrl) urls.push(ref.targetUrl);
      // Extract from objective
      const match = t.objective.match(/\/[a-z0-9][a-z0-9\-_/]*/i);
      if (match && !urls.includes(match[0])) urls.push(match[0]);
    }
  }

  if (urls.length === 0) urls.push("/"); // default: test home

  for (const url of urls) {
    console.log(`--- Resolving: ${url}`);
    const result = await resolveWpPostId(client.cerebroClientId, url);
    if (result) {
      console.log(`  Result: id=${result.id} type=${result.type}`);
      if (result.attempts) {
        for (const a of result.attempts) console.log(`    ${a}`);
      }
    } else {
      console.log(`  Result: null (no resolution possible)`);
    }
    console.log();
  }

  await prisma.$disconnect();
}

main().catch(console.error);
