import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PACKAGE_REGISTRY } from "@/lib/plan/packages";

export const dynamic = "force-dynamic";

export default async function PreparacionSitiosPage() {
  const session = await getSession();
  if (!session || session.user.role !== "ADMIN") redirect("/api/auth/signin");

  // All Next.js sites with SEO service
  const sites = await prisma.site.findMany({
    where: {
      platform: "NEXTJS",
      client: { services: { has: "seo" }, status: "ACTIVE" },
    },
    select: {
      id: true,
      url: true,
      githubRepo: true,
      defaultBranch: true,
      client: { select: { name: true } },
      packages: {
        select: { packageId: true, status: true, version: true },
      },
    },
    orderBy: { client: { name: "asc" } },
  });

  const activePackages = PACKAGE_REGISTRY.filter((p) => p.version !== "0");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Preparacion de sitios Next.js</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {sites.length} sitio(s) Next.js activos con SEO. {activePackages.length} paquete(s) activos.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="pb-2 pr-4 font-medium text-muted-foreground">Cliente</th>
              <th className="pb-2 pr-4 font-medium text-muted-foreground">Sitio</th>
              <th className="pb-2 pr-4 font-medium text-muted-foreground">Repo</th>
              {activePackages.map((p) => (
                <th key={p.id} className="pb-2 pr-4 font-medium text-muted-foreground">{p.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sites.map((site) => {
              const pkgMap = new Map(site.packages.map((p) => [p.packageId, p]));
              return (
                <tr key={site.id} className="border-b border-border/30">
                  <td className="py-2 pr-4 text-foreground">{site.client.name}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{site.url}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{site.githubRepo ?? "—"}</td>
                  {activePackages.map((p) => {
                    const installed = pkgMap.get(p.id);
                    const status = installed?.status ?? "PENDING";
                    const color = status === "INSTALLED" ? "text-emerald-500"
                      : status === "FAILED" ? "text-red-500"
                      : status === "INSTALLING" ? "text-blue-500"
                      : "text-amber-500";
                    const label = status === "INSTALLED" ? "OK"
                      : status === "FAILED" ? "FAIL"
                      : status === "INSTALLING" ? "..."
                      : site.githubRepo ? "Pendiente" : "Sin repo";
                    return (
                      <td key={p.id} className={`py-2 pr-4 font-semibold ${color}`}>{label}</td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sites.length === 0 && (
        <p className="text-sm text-muted-foreground">No hay sitios Next.js activos con servicio SEO.</p>
      )}
    </div>
  );
}
