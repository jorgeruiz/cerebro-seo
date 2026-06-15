import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function SectionHeader({ children, className }: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.1em] mb-5",
        className,
      )}
    >
      <span className="text-primary">{"//"}</span>
      <span>{children}</span>
      <span className="flex-1 h-px bg-border" />
    </div>
  );
}
