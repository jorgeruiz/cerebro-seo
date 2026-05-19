import { z } from "zod";
import { router, adminProcedure, protectedProcedure } from "../index";
import { prisma } from "@/lib/db";
import { ClientStatus, CycleStatus } from "@prisma/client";

export const clientesRouter = router({
  // Crear cliente — solo ADMIN
  crear: adminProcedure
    .input(
      z.object({
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
      })
    )
    .mutation(async ({ input }) => {
      const { name, domain, plan, brandColor, gscProperty, ga4Property, keywords, competitors } =
        input;

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
                  .map((d) => ({ domain: d }))
              : [],
          },
        },
      });

      return { id: client.id };
    }),

  // Listar clientes — todos los usuarios autenticados ven todos los clientes activos
  listar: protectedProcedure
    .input(
      z
        .object({ filter: z.enum(["seo", "all"]).default("seo") })
        .optional()
    )
    .query(async ({ input }) => {
      const filterSeo = input?.filter !== "all";

      // Todos los usuarios autenticados ven todos los clientes activos.
      // ClientUser granular dormido — reservado para Fase 2.
      const baseWhere = { status: ClientStatus.ACTIVE };

      const where = filterSeo
        ? { ...baseWhere, services: { has: "seo" } }
        : baseWhere;

      return prisma.client.findMany({
        where,
        orderBy: { name: "asc" },
        include: {
          cycles: {
            where: {
              status: { in: [CycleStatus.ACTIVE, CycleStatus.PLANNING, CycleStatus.CLOSING] },
            },
            orderBy: { yearMonth: "desc" },
            take: 1,
            include: {
              tasks: { where: { status: { not: "DONE" } }, select: { id: true } },
            },
          },
          insights: {
            where: { severity: "critical", dismissed: false },
            select: { id: true },
          },
        },
      });
    }),
});

