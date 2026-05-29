import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string | number;
  delta?: React.ReactNode;
  icon?: React.ReactNode;
  variant?: "default" | "highlighted";
  valueColor?: "default" | "green" | "orange" | "red" | "blue";
  className?: string;
}

const valueColorClass = {
  default: "text-foreground",
  green:   "text-ds-green",
  orange:  "text-ds-orange",
  red:     "text-ds-red",
  blue:    "text-ds-blue",
} as const;

export function KpiCard({
  label,
  value,
  delta,
  icon,
  variant = "default",
  valueColor = "default",
  className,
}: KpiCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border px-[18px] py-4",
        variant === "highlighted"
          ? "bg-primary/10 border-ds-gd"
          : "bg-card border-border",
        className,
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 font-mono text-[0.58rem] text-muted-foreground uppercase tracking-[0.08em]">
          {icon && <span className="opacity-70">{icon}</span>}
          {label}
        </div>
        {delta}
      </div>
      <div
        className={cn(
          "font-display font-extrabold text-[1.65rem] leading-none tracking-tight",
          valueColorClass[valueColor],
        )}
      >
        {value}
      </div>
    </div>
  );
}
