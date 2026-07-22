"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sparkles,
  Search,
  Activity,
  FileSearch,
  Link2,
  BarChart3,
  TrendingUp,
  Zap,
  Lightbulb,
  Brain,
  Calendar,
  FileText,
  Settings,
  Lock,
  ChevronDown,
  ClipboardList,
  Menu,
} from "lucide-react";
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
import { useClipboard } from "@/app/(admin)/clientes/[id]/ClipboardContext";

// ─── Nav structure ──────────────────────────────────────────────────────────

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  requiresSeo: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const FEATURED: NavItem = {
  label: "Análisis Claude",
  href: "analisis",
  icon: Sparkles,
  description: "Análisis integral con IA",
  requiresSeo: true,
};

const GROUPS: NavGroup[] = [
  {
    title: "Diagnóstico",
    items: [
      { label: "Términos de búsqueda", href: "terminos-busqueda", icon: Search,     description: "Queries de GSC",        requiresSeo: false },
      { label: "Tráfico de páginas",   href: "trafico-paginas",   icon: Activity,   description: "Páginas por tráfico",    requiresSeo: false },
      { label: "Site Audit",           href: "audit",             icon: FileSearch,  description: "Salud técnica del sitio", requiresSeo: false },
      { label: "Backlinks",            href: "backlinks",         icon: Link2,       description: "Perfil de enlaces",      requiresSeo: true },
      { label: "Competencia",          href: "competencia",       icon: BarChart3,   description: "Share of Voice",         requiresSeo: true },
    ],
  },
  {
    title: "Oportunidades",
    items: [
      { label: "SEO Opportunities",    href: "oportunidades",     icon: TrendingUp,  description: "Quick wins detectados", requiresSeo: true },
      { label: "Keyword Ideas",        href: "keyword-ideas",     icon: Lightbulb,   description: "Expansión semántica",   requiresSeo: true },
      { label: "AI Search Visibility", href: "ai-search",         icon: Zap,         description: "Presencia en LLMs",     requiresSeo: true },
      { label: "AEO Research",         href: "aeo-research",      icon: Brain,       description: "Prompts y clusters",    requiresSeo: true },
    ],
  },
  {
    title: "Estrategia",
    items: [
      { label: "Plan de Contenido",    href: "contenido",         icon: Lightbulb,   description: "Roadmap editorial",     requiresSeo: true },
      { label: "Eventos / Timeline",   href: "timeline",          icon: Calendar,    description: "Hitos y cambios",       requiresSeo: false },
      { label: "Reporte Mensual",      href: "reporte",           icon: FileText,    description: "Resumen ejecutivo",     requiresSeo: true },
      { label: "Keywords objetivo",    href: "keywords",          icon: TrendingUp,  description: "Tracking de posiciones", requiresSeo: true },
    ],
  },
  {
    title: "Config",
    items: [
      { label: "Configuración",        href: "configuracion",     icon: Settings,    description: "Ajustes del cliente",   requiresSeo: false },
    ],
  },
];

// ─── SidebarNavItem ─────────────────────────────────────────────────────────

function SidebarNavItem({
  item,
  clientId,
  hasSeo,
  pathname,
  featured = false,
}: {
  item: NavItem;
  clientId: string;
  hasSeo: boolean;
  pathname: string;
  featured?: boolean;
}) {
  const fullHref = `/clientes/${clientId}/${item.href}`;
  const active = pathname === fullHref || pathname.startsWith(fullHref + "/");
  const locked = item.requiresSeo && !hasSeo;
  const Icon = item.icon;

  if (locked) {
    return (
      <Tooltip>
        <TooltipTrigger
          className={cn(
            "flex items-center gap-2.5 px-3 py-1.5 w-full text-left cursor-not-allowed opacity-40",
            featured ? "py-2.5" : ""
          )}
        >
          <Icon className="h-3.5 w-3.5 shrink-0 opacity-50" />
          <span className="font-mono text-[0.76rem] text-muted-foreground truncate flex-1">{item.label}</span>
          <Lock className="h-3 w-3 text-muted-foreground/50 shrink-0" />
        </TooltipTrigger>
        <TooltipContent side="right">
          Sin servicio SEO contratado
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link
      href={fullHref}
      className={cn(
        "flex items-center gap-2.5 px-3 py-1.5 rounded-md transition-colors group",
        featured ? "py-2.5" : "",
        active
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-white/[0.03]"
      )}
    >
      <Icon className={cn(
        "h-3.5 w-3.5 shrink-0",
        active ? "text-primary" : "opacity-60 group-hover:opacity-80",
        featured && active && "text-primary"
      )} />
      <div className="flex-1 min-w-0">
        <span className={cn(
          "font-mono text-[0.76rem] truncate block",
          featured && "font-medium"
        )}>
          {item.label}
        </span>
        <span className="font-mono text-[0.62rem] text-muted-foreground/60 truncate block leading-tight">
          {item.description}
        </span>
      </div>
    </Link>
  );
}

// ─── CollapsibleGroup ───────────────────────────────────────────────────────

function CollapsibleGroup({
  title,
  items,
  clientId,
  hasSeo,
  pathname,
}: {
  title: string;
  items: NavItem[];
  clientId: string;
  hasSeo: boolean;
  pathname: string;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 font-mono text-[0.62rem] text-muted-foreground/70 uppercase tracking-[0.1em] hover:text-muted-foreground transition-colors"
      >
        <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", !open && "-rotate-90")} />
        {title}
      </button>
      <div
        className={cn(
          "space-y-0.5 mt-0.5 overflow-hidden transition-all duration-200 ease-out",
          open ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        {items.map((item) => (
          <SidebarNavItem
            key={item.href}
            item={item}
            clientId={clientId}
            hasSeo={hasSeo}
            pathname={pathname}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Nav Content (shared between desktop and mobile) ────────────────────────

function ClientSidebarContent({
  clientId,
  clientName,
  hasSeo,
}: {
  clientId: string;
  clientName: string;
  hasSeo: boolean;
}) {
  const pathname = usePathname();
  const { count: clipboardCount } = useClipboard();

  return (
    <div className="flex flex-col h-full">
      {/* Client name header */}
      <div className="px-4 pt-4 pb-3 border-b border-sidebar-border">
        <Link
          href={`/clientes/${clientId}`}
          className="block group"
        >
          <p className="font-display font-bold text-[0.82rem] text-foreground tracking-tight truncate group-hover:text-primary transition-colors">
            {clientName}
          </p>
          <p className="font-mono text-[0.6rem] text-muted-foreground/60 mt-0.5">
            Módulos del cliente
          </p>
        </Link>
      </div>

      {/* Scrollable nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-3">
        {/* Featured item */}
        <div className="pb-2 border-b border-sidebar-border/50">
          <SidebarNavItem
            item={FEATURED}
            clientId={clientId}
            hasSeo={hasSeo}
            pathname={pathname}
            featured
          />
        </div>

        {/* Groups */}
        {GROUPS.map((group) => (
          <CollapsibleGroup
            key={group.title}
            title={group.title}
            items={group.items}
            clientId={clientId}
            hasSeo={hasSeo}
            pathname={pathname}
          />
        ))}
      </nav>

      {/* Footer quick access */}
      <div className="border-t border-sidebar-border px-3 py-2.5 space-y-1">
        <Link
          href={`/clientes/${clientId}/configuracion`}
          className="flex items-center gap-2 px-2 py-1 rounded-md font-mono text-[0.7rem] text-muted-foreground hover:text-foreground hover:bg-white/[0.03] transition-colors"
        >
          <Settings className="h-3 w-3 opacity-50" />
          Configuración
        </Link>
        <Link
          href={`/clientes/${clientId}/portapapeles`}
          className="flex items-center gap-2 px-2 py-1 rounded-md font-mono text-[0.7rem] text-muted-foreground hover:text-foreground hover:bg-white/[0.03] transition-colors"
        >
          <ClipboardList className="h-3 w-3 opacity-50" />
          Portapapeles
          {clipboardCount > 0 && (
            <span className="ml-auto text-[0.6rem] font-mono bg-primary/20 text-primary rounded-full px-1.5 py-0.5 leading-none">
              {clipboardCount}
            </span>
          )}
        </Link>
      </div>
    </div>
  );
}

// ─── Desktop Sidebar ────────────────────────────────────────────────────────

export function ClientSidebar({
  clientId,
  clientName,
  hasSeo,
}: {
  clientId: string;
  clientName: string;
  hasSeo: boolean;
}) {
  return (
    <>
      {/* Desktop: static sidebar */}
      <aside className="hidden lg:flex h-full w-56 min-w-56 shrink-0 flex-col bg-sidebar border-r border-sidebar-border overflow-y-auto">
        <ClientSidebarContent
          clientId={clientId}
          clientName={clientName}
          hasSeo={hasSeo}
        />
      </aside>

      {/* Mobile: sheet trigger + drawer */}
      <div className="lg:hidden fixed bottom-4 right-4 z-40">
        <Sheet>
          <SheetTrigger className="h-10 w-10 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 active:scale-90 transition-all duration-200">
            <Menu className="h-5 w-5" />
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0 bg-sidebar">
            <SheetTitle className="sr-only">Navegación del cliente</SheetTitle>
            <ClientSidebarContent
              clientId={clientId}
              clientName={clientName}
              hasSeo={hasSeo}
            />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
