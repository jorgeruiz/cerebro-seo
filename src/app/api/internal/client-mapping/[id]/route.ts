export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateNotionClientId } from "@/lib/notion-client-id";

/**
 * GET /api/internal/client-mapping/{id}
 * Authorization: Bearer ${SEO_INTERNAL_SECRET}
 *
 * Resolves a client by internal ID or notionClientId (cerebroClientId).
 * Used by Cerebro WEB connector to validate client exists in Cerebro SEO.
 *
 * The {id} param can be:
 * - A Cerebro SEO internal client ID (cuid)
 * - A Notion client ID (UUID 32 hex or with dashes)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.SEO_INTERNAL_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawId = params.id;

  // Try as internal client ID first
  let client = await prisma.client.findUnique({
    where: { id: rawId },
    select: {
      id: true,
      cerebroClientId: true,
      name: true,
      domain: true,
      status: true,
      services: true,
      sites: {
        take: 1,
        select: { platform: true, url: true, githubRepo: true },
      },
    },
  });

  // Try as notionClientId
  if (!client) {
    const validation = validateNotionClientId(rawId);
    if (validation.valid) {
      client = await prisma.client.findUnique({
        where: { cerebroClientId: validation.normalized },
        select: {
          id: true,
          cerebroClientId: true,
          name: true,
          domain: true,
          status: true,
          services: true,
          sites: {
            take: 1,
            select: { platform: true, url: true, githubRepo: true },
          },
        },
      });
    }
  }

  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const site = client.sites[0] ?? null;

  return NextResponse.json({
    id: client.id,
    notionClientId: client.cerebroClientId,
    name: client.name,
    domain: client.domain,
    status: client.status,
    services: client.services,
    site: site
      ? {
          platform: site.platform,
          url: site.url,
          githubRepo: site.githubRepo,
        }
      : null,
  });
}
