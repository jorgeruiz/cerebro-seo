import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PACKAGE_REGISTRY } from "@/lib/plan/packages";
import { PackageCard } from "./PackageCard";

export const dynamic = "force-dynamic";

export default async function PaquetesPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect("/api/auth/signin");

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      sites: {
        select: { id: true, url: true, platform: true, githubRepo: true, defaultBranch: true },
      },
    },
  });

  if (!client) redirect("/clientes");

  const site = client.sites[0];
  if (!site) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold">Paquetes del sitio</h1>
        <p className="text-sm text-muted-foreground mt-2">Este cliente no tiene sitios configurados.</p>
      </div>
    );
  }

  // Query packages separately — avoids crash if SitePackage table doesn't exist
  let sitePackages: Array<{ id: string; packageId: string; status: string; version: string; installedAt: Date | null; verifiedAt: Date | null }> = [];
  try {
    sitePackages = await prisma.sitePackage.findMany({
      where: { siteId: site.id },
      select: { id: true, packageId: true, status: true, version: true, installedAt: true, verifiedAt: true },
    });
  } catch {
    // SitePackage table may not exist yet
  }

  const applicablePackages = site.platform
    ? PACKAGE_REGISTRY.filter((p) => p.platforms.includes(site.platform!))
    : [];

  const installedMap = new Map(sitePackages.map((p) => [p.packageId, p]));

  const packageStatuses = await Promise.all(
    applicablePackages.map(async (pkg) => {
      const installed = installedMap.get(pkg.id);
      if (installed) {
        return {
          pkg,
          status: installed.status,
          installedAt: installed.installedAt,
          verifiedAt: installed.verifiedAt,
          detectDetails: null,
        };
      }
      if (site.githubRepo && pkg.version !== "0") {
        try {
          const ctx = { siteId: site.id, githubRepo: site.githubRepo, defaultBranch: site.defaultBranch ?? "main" };
          const detection = await pkg.detect(ctx);
          if (detection.installed) {
            try {
              await prisma.sitePackage.upsert({
                where: { siteId_packageId: { siteId: site.id, packageId: pkg.id } },
                update: { status: "INSTALLED", version: detection.version ?? pkg.version },
                create: { siteId: site.id, packageId: pkg.id, status: "INSTALLED", version: detection.version ?? pkg.version },
              });
            } catch { /* table may not exist */ }
            return { pkg, status: "INSTALLED" as const, installedAt: null, verifiedAt: null, detectDetails: "Auto-detectado" };
          }
          return { pkg, status: "PENDING" as const, installedAt: null, verifiedAt: null, detectDetails: detection.details ?? null };
        } catch {
          return { pkg, status: "PENDING" as const, installedAt: null, verifiedAt: null, detectDetails: "Error en deteccion" };
        }
      }
      return {
        pkg,
        status: pkg.version === "0" ? ("NOT_ACTIVE" as const) : ("PENDING" as const),
        installedAt: null,
        verifiedAt: null,
        detectDetails: pkg.version === "0" ? "Paquete no activo (v0)" : null,
      };
    })
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Paquetes del sitio</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {site.url} &middot; {site.platform ?? "plataforma desconocida"} &middot; {site.githubRepo ?? "sin repo"}
        </p>
      </div>

      <div className="grid gap-4">
        {packageStatuses.map((ps) => (
          <PackageCard
            key={ps.pkg.id}
            packageDef={ps.pkg}
            status={ps.status}
            installedAt={ps.installedAt}
            verifiedAt={ps.verifiedAt}
            detectDetails={ps.detectDetails}
            clientId={params.id}
            siteId={site.id}
          />
        ))}
      </div>

      {applicablePackages.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {site.platform === "WORDPRESS"
            ? "Los paquetes de infraestructura son solo para sitios Next.js."
            : "No hay paquetes disponibles para esta plataforma."}
        </p>
      )}
    </div>
  );
}
