export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { dataForSeoProvider } from "@/server/providers/dataforseo";

// ── Domain normalizer ────────────────────────────────────────────────────────

function normalizeDomain(raw: string): string | null {
  let d = raw.trim().toLowerCase();

  // Strip protocol
  d = d.replace(/^https?:\/\//, "");

  // Strip www.
  d = d.replace(/^www\./, "");

  // Strip path, query, hash, trailing slash
  d = d.split("/")[0].split("?")[0].split("#")[0];

  // Validate: must look like a domain
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(d)) {
    return null;
  }

  return d;
}

// ── Anti-zero: convert 0 to null ─────────────────────────────────────────────

function nullIfZero(v: number | null | undefined): number | null {
  if (v === null || v === undefined || v === 0) return null;
  return v;
}

// ── POST /api/internal/diagnostico ───────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Auth — Bearer SEO_INTERNAL_SECRET
  const authHeader = req.headers.get("authorization");
  const secret = process.env.SEO_INTERNAL_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse body
  let body: { domain?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.domain || typeof body.domain !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid 'domain' field" },
      { status: 400 }
    );
  }

  // 3. Normalize domain
  const domain = normalizeDomain(body.domain);
  if (!domain) {
    return NextResponse.json(
      { error: "Invalid domain format" },
      { status: 400 }
    );
  }

  // 4. Fetch in parallel — allSettled so partial failure doesn't kill both
  const [overviewResult, backlinksResult] = await Promise.allSettled([
    dataForSeoProvider.getDomainRankOverview(domain),
    dataForSeoProvider.getBacklinksSummary(domain),
  ]);

  const overview =
    overviewResult.status === "fulfilled" ? overviewResult.value : null;
  const backlinks =
    backlinksResult.status === "fulfilled" ? backlinksResult.value : null;

  // 5. Both failed → 502
  if (!overview && !backlinks) {
    const reasons = [
      overviewResult.status === "rejected"
        ? String(overviewResult.reason)
        : null,
      backlinksResult.status === "rejected"
        ? String(backlinksResult.reason)
        : null,
    ].filter(Boolean);
    console.error("[diagnostico] Both calls failed:", reasons.join(" | "));
    return NextResponse.json(
      { error: "diagnostico_failed" },
      { status: 502 }
    );
  }

  // 6. Build response — anti-zero on all numeric fields
  return NextResponse.json({
    domain,
    rankedKeywords: overview ? nullIfZero(overview.rankedKeywords) : null,
    estimatedTraffic: overview ? nullIfZero(overview.estimatedTraffic) : null,
    domainRank: overview ? nullIfZero(overview.domainRank) : null,
    backlinks: backlinks
      ? {
          total: nullIfZero(backlinks.totalBacklinks),
          referringDomains: nullIfZero(backlinks.referringDomains),
          domainAuthority: nullIfZero(backlinks.domainAuthority),
        }
      : null,
  });
}
