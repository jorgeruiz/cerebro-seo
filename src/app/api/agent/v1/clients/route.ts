export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAgentAuth } from "@/lib/agent-auth";

async function handler(_req: NextRequest) {
  const clients = await prisma.client.findMany({
    where: { status: { not: "CHURNED" } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      domain: true,
      status: true,
      services: true,
      sites: {
        select: { url: true, platform: true },
        take: 1,
      },
    },
  });

  const data = clients.map((c) => ({
    id: c.id,
    name: c.name,
    website: c.sites[0]?.url ?? c.domain,
    platform: c.sites[0]?.platform?.toLowerCase() ?? "unknown",
    status: c.status.toLowerCase(),
    services: c.services,
  }));

  return NextResponse.json({ clients: data });
}

export const GET = withAgentAuth(handler);
