"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  children: React.ReactNode;
  className?: string;
}

export function InfoTooltip({ children, className }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className={cn("relative inline-flex items-center shrink-0", className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors focus:outline-none"
        aria-label="Más información"
      >
        <HelpCircle className="h-3 w-3" />
      </button>
      {visible && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-56 rounded-lg border border-border bg-card px-3 py-2 text-[0.72rem] text-foreground leading-relaxed shadow-lg pointer-events-none whitespace-normal"
        >
          {children}
        </span>
      )}
    </span>
  );
}
