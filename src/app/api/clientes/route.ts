import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

const createClientSchema = z.object({
  name: z.string().min(1),
  domain: z
    .string()
    .min(1)
    .transform((d) => d.replace(/^https?:\/\//, "").replace(/\/$/, "")),
  plan: z.enum(["BASIC", "PRO", "ENTERPRISE"]),
  brandColor: z.string().optional(),
  gscProperty: z.string().optional(),
  ga4Property: z.string().optional(),
  keywords: z.string().optional(),
  competitors: z.string().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();

  // Solo ADMIN puede crear clientes
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as unknown;
  const parsed = createClientSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const { name, domain, plan, brandColor, gscProperty, ga4Property, keywords, competitors } =
    parsed.data;

  const client = await prisma.client.create({
    data: {
      name,
      domain,
      plan,
      status: "ACTIVE",
      brandColor: brandColor ?? null,
      sites: {
        create: {
          url: `https://${domain}`,
          gscProperty: gscProperty || null,
          ga4Property: ga4Property || null,
        },
      },
      keywords: {
        create: keywords
          ? keywords
              .split(",")
              .map((k) => k.trim())
              .filter(Boolean)
              .slice(0, 50)
              .map((term, i) => ({ term, isPriority: i < 10 }))
          : [],
      },
      competitors: {
        create: competitors
          ? competitors
              .split(",")
              .map((c) => c.trim().replace(/^https?:\/\//, "").replace(/\/$/, ""))
              .filter(Boolean)
              .slice(0, 5)
              .map((domain) => ({ domain }))
          : [],
      },
    },
  });

  return NextResponse.json({ id: client.id }, { status: 201 });
}
