"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  children: React.ReactNode;
  className?: string;
}

export function SectionIntro({ children, className }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn(className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 font-mono text-[0.68rem] text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors uppercase tracking-[0.08em]"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform duration-150",
            open && "rotate-90"
          )}
        />
        ¿Cómo funciona esta sección?
      </button>
      {open && (
        <div className="mt-2 ml-[18px] border-l-2 border-ds-blue/30 pl-3 text-[0.78rem] text-muted-foreground leading-relaxed max-w-2xl">
          {children}
        </div>
      )}
    </div>
  );
}
