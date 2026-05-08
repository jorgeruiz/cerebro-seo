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
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/settings", label: "Configuración", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const initials = session?.user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() ?? "CS";

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-gray-100 bg-white">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 px-5 border-b border-gray-100">
        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-[#6366f1] via-[#3b82f6] to-[#ec4899]" />
        <span className="text-[15px] font-semibold text-gray-900 tracking-tight">
          Cerebro <span className="text-[#6366f1]">SEO</span>
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User menu */}
      <div className="border-t border-gray-100 p-3">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-gray-50 transition-colors cursor-pointer bg-transparent border-none outline-none">
              <Avatar className="h-7 w-7">
                <AvatarImage src={session?.user?.image ?? undefined} />
                <AvatarFallback className="bg-gradient-to-br from-[#6366f1] to-[#ec4899] text-white text-[10px] font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 text-left min-w-0">
                <p className="truncate text-xs font-medium text-gray-900">
                  {session?.user?.name ?? session?.user?.email}
                </p>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">
                  {session?.user?.role ?? ""}
                </p>
              </div>
              <ChevronDown className="h-3 w-3 text-gray-400 shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              className="text-red-600 cursor-pointer"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
