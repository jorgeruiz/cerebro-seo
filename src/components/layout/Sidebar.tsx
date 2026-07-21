"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  Users,
  LayoutDashboard,
  Settings,
  LogOut,
  ChevronDown,
  FlaskConical,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useSidebarCollapse } from "@/hooks/useSidebarCollapse";

const NAV_ITEMS = [
  { href: "/clientes",  label: "Clientes",       icon: Users,           adminOnly: false },
  { href: "/dashboard", label: "Dashboard",       icon: LayoutDashboard, adminOnly: false },
  { href: "/research",  label: "Research",        icon: FlaskConical,    adminOnly: false },
  { href: "/settings",  label: "Configuración",   icon: Settings,        adminOnly: true },
];

// ─── Sidebar content (shared between desktop and mobile) ──────────────────

function SidebarContent({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <>
      {/* Logo section */}
      <div className={cn("border-b border-sidebar-border", collapsed ? "px-2 pt-4 pb-3" : "px-5 pt-6 pb-4")}>
        {collapsed ? (
          <div className="font-display font-bold text-[0.85rem] text-primary text-center">S</div>
        ) : (
          <>
            <div className="font-display font-bold text-[0.85rem] text-foreground tracking-tight">
              Cerebro <span className="text-primary">SEO</span>
            </div>
            <div className="font-mono text-[0.68rem] text-muted-foreground mt-0.5">
              Click Society · Internal
            </div>
          </>
        )}
      </div>

      {/* Section label */}
      {!collapsed && (
        <div className="px-5 pt-4 pb-2 font-mono text-[0.66rem] text-muted-foreground uppercase tracking-[0.1em]">
          Navegación
        </div>
      )}
      {collapsed && <div className="pt-3" />}

      {/* Nav items */}
      <nav className="flex flex-col">
        {NAV_ITEMS.filter((item) => !item.adminOnly || session?.user?.role === "ADMIN").map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);

          if (collapsed) {
            return (
              <Tooltip key={href}>
                <TooltipTrigger render={<Link href={href} className={cn(
                  "flex items-center justify-center border-l-2 border-transparent transition-colors py-2",
                  active
                    ? "text-foreground border-l-primary bg-primary/5"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/[0.03]"
                )} />}>
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-primary" : "opacity-50")} />
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            );
          }

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 px-5 py-1.5 font-mono text-[0.78rem] border-l-2 border-transparent transition-colors",
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
      <div className={cn("border-t border-sidebar-border", collapsed ? "p-1.5" : "p-[14px_20px]")}>
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "flex w-full items-center gap-2 text-left cursor-pointer bg-transparent border-none outline-none hover:text-foreground transition-colors",
              collapsed && "justify-center"
            )}
          >
            {collapsed ? (
              <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-[0.6rem] font-mono text-primary font-medium">
                {(session?.user?.name?.[0] ?? session?.user?.email?.[0] ?? "U").toUpperCase()}
              </div>
            ) : (
              <>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-foreground font-mono text-[0.8rem] font-medium">
                    {session?.user?.name ?? session?.user?.email}
                  </p>
                  <p className="text-muted-foreground font-mono text-[0.66rem] uppercase tracking-wide mt-0.5">
                    {session?.user?.role ?? ""}
                  </p>
                </div>
                <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
              </>
            )}
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
    </>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────

export function Sidebar() {
  const { collapsed, toggle, ready } = useSidebarCollapse();

  return (
    <>
      {/* Desktop: static sidebar */}
      <aside
        className={cn(
          "hidden lg:flex h-screen flex-col bg-sidebar border-r border-sidebar-border sticky top-0 overflow-y-auto shrink-0 transition-[width,min-width] duration-200 ease-in-out",
          collapsed ? "w-[52px] min-w-[52px]" : "w-60 min-w-60"
        )}
      >
        <SidebarContent collapsed={collapsed} />

        {/* Collapse toggle — desktop only */}
        {ready && (
          <div className={cn("border-t border-sidebar-border", collapsed ? "p-1.5" : "px-3 py-2")}>
            <button
              onClick={toggle}
              className={cn(
                "flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors rounded-md",
                collapsed
                  ? "w-full justify-center p-2"
                  : "w-full px-2 py-1.5 font-mono text-[0.72rem]"
              )}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-3.5 w-3.5" />
              ) : (
                <>
                  <PanelLeftClose className="h-3.5 w-3.5" />
                  <span>Colapsar</span>
                </>
              )}
            </button>
          </div>
        )}
      </aside>

      {/* Mobile: top bar + sheet drawer */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 h-12 bg-sidebar/95 backdrop-blur border-b border-sidebar-border flex items-center px-4 gap-3">
        <Sheet>
          <SheetTrigger className="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 transition-colors">
            <Menu className="h-4 w-4" />
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0 bg-sidebar">
            <SheetTitle className="sr-only">Navegación</SheetTitle>
            <div className="flex flex-col h-full">
              <SidebarContent collapsed={false} />
            </div>
          </SheetContent>
        </Sheet>
        <div className="font-display font-bold text-[0.8rem] text-foreground tracking-tight">
          Cerebro <span className="text-primary">SEO</span>
        </div>
      </div>
    </>
  );
}
