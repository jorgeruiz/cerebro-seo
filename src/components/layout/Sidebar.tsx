"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Users, LayoutDashboard, Settings, LogOut, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/clientes",  label: "Clientes",       icon: Users,          adminOnly: false },
  { href: "/dashboard", label: "Dashboard",       icon: LayoutDashboard, adminOnly: false },
  { href: "/settings",  label: "Configuración",   icon: Settings,        adminOnly: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <aside className="flex h-screen w-60 min-w-60 flex-col bg-sidebar border-r border-sidebar-border sticky top-0 overflow-y-auto shrink-0">
      {/* Logo section */}
      <div className="px-5 pt-6 pb-4 border-b border-sidebar-border">
        <div className="font-display font-bold text-[0.85rem] text-foreground tracking-tight">
          Cerebro <span className="text-primary">SEO</span>
        </div>
        <div className="font-mono text-[0.58rem] text-muted-foreground mt-0.5">
          Click Society · Internal
        </div>
      </div>

      {/* Section label */}
      <div className="px-5 pt-4 pb-2 font-mono text-[0.56rem] text-muted-foreground uppercase tracking-[0.1em]">
        Navegación
      </div>

      {/* Nav items */}
      <nav className="flex flex-col">
        {NAV_ITEMS.filter((item) => !item.adminOnly || session?.user?.role === "ADMIN").map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 px-5 py-1.5 font-mono text-[0.68rem] border-l-2 border-transparent transition-colors",
                active
                  ? "text-foreground border-l-primary bg-primary/5"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.03]"
              )}
            >
              <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-primary" : "opacity-50")} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* User footer */}
      <div className="border-t border-sidebar-border p-[14px_20px]">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2 text-left cursor-pointer bg-transparent border-none outline-none hover:text-foreground transition-colors">
            <div className="flex-1 min-w-0">
              <p className="truncate text-foreground font-mono text-[0.7rem] font-medium">
                {session?.user?.name ?? session?.user?.email}
              </p>
              <p className="text-muted-foreground font-mono text-[0.56rem] uppercase tracking-wide mt-0.5">
                {session?.user?.role ?? ""}
              </p>
            </div>
            <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              className="text-destructive cursor-pointer font-mono text-xs"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="h-3.5 w-3.5 mr-2" />
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
