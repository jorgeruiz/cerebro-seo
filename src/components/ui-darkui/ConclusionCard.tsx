import { cn } from "@/lib/utils";

export type ConclusionVariant = "success" | "warning" | "error" | "info";

interface ConclusionCardProps {
  variant: ConclusionVariant;
  title: string;
  children: React.ReactNode;
  className?: string;
}

const variantClasses: Record<ConclusionVariant, { border: string; title: string }> = {
  success: { border: "border-l-ds-green",  title: "text-ds-green"  },
  warning: { border: "border-l-ds-yellow", title: "text-ds-yellow" },
  error:   { border: "border-l-ds-red",    title: "text-ds-red"    },
  info:    { border: "border-l-ds-blue",   title: "text-ds-blue"   },
};

export function ConclusionCard({
  variant,
  title,
  children,
  className,
}: ConclusionCardProps) {
  const styles = variantClasses[variant];
  return (
    <div
      className={cn(
        "bg-ds-s2 border border-border border-l-[3px] rounded-r-md px-[18px] py-3.5",
        styles.border,
        className,
      )}
    >
      <div className={cn("font-display font-bold text-[0.78rem] mb-1", styles.title)}>
        {title}
      </div>
      <div className="text-[0.78rem] text-ds-dim leading-relaxed">
        {children}
      </div>
    </div>
  );
}
