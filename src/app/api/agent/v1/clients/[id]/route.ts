export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAgentAuth } from "@/lib/agent-auth";

async function handler(
  _req: NextRequest,
  { params }: { params: Record<string, string> }
) {
  const client = await prisma.client.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      domain: true,
      status: true,
      plan: true,
      services: true,
      verifiedServices: true,
      excludedServices: true,
      brandColor: true,
      planConfig: true,
      createdAt: true,
      sites: {
        select: {
          id: true,
          url: true,
          platform: true,
          framework: true,
          gscProperty: true,
          ga4Property: true,
          githubRepo: true,
        },
      },
    },
  });

  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  // Extract brand/goals from planConfig if available
  const config = client.planConfig as Record<string, unknown> | null;

  return NextResponse.json({
    id: client.id,
    name: client.name,
    website: client.sites[0]?.url ?? client.domain,
    status: client.status.toLowerCase(),
    plan: client.plan.toLowerCase(),
    services: client.services,
    verifiedServices: client.verifiedServices,
    excludedServices: client.excludedServices,
    brandColor: client.brandColor,
    objectives: config?.objectives ?? null,
    tone: config?.tone ?? null,
    notes: config?.notes ?? null,
    sites: client.sites.map((s) => ({
      id: s.id,
      url: s.url,
      platform: s.platform?.toLowerCase() ?? "unknown",
      framework: s.framework,
      hasGsc: !!s.gscProperty,
      hasGa4: !!s.ga4Property,
      hasGithub: !!s.githubRepo,
    })),
    createdAt: client.createdAt.toISOString(),
  });
}

export const GET = withAgentAuth(handler);
