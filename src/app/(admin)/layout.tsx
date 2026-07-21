import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Sidebar } from "@/components/layout/Sidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  // CLIENT role solo accede al portal de clientes, no al admin
  if (session.user.role === "CLIENT") {
    redirect("/portal");
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto pt-12 lg:pt-0">
        {children}
      </main>
    </div>
  );
}
