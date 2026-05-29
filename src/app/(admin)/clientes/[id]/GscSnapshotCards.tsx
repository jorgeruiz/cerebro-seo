import { MousePointerClick, Eye, BarChart3, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { GscSnapshot } from "./actions";
import { KpiCard } from "@/components/ui-darkui";

function DeltaBadge({ delta, lowerIsBetter = false }: { delta: number; lowerIsBetter?: boolean }) {
  if (delta === 0) return <Minus className="h-3 w-3 text-muted-foreground" />;
  const isPositive = lowerIsBetter ? delta < 0 : delta > 0;
  const Icon = delta > 0 ? TrendingUp : TrendingDown;
  const color = isPositive ? "text-ds-green" : "text-destructive";
  const sign = delta > 0 ? "+" : "";
  return (
    <span className={`flex items-center gap-0.5 text-[11px] font-mono font-medium ${color}`}>
      <Icon className="h-3 w-3" />
      {sign}{delta}
    </span>
  );
}

interface Props {
  snapshot: GscSnapshot;
}

export function GscSnapshotCards({ snapshot }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <KpiCard
        icon={<MousePointerClick className="h-3 w-3" />}
        label="Clics orgánicos"
        value={snapshot.clicks.toLocaleString("es-MX")}
        delta={<DeltaBadge delta={snapshot.clicksDelta} />}
      />
      <KpiCard
        icon={<Eye className="h-3 w-3" />}
        label="Impresiones"
        value={snapshot.impressions.toLocaleString("es-MX")}
        delta={<DeltaBadge delta={snapshot.impressionsDelta} />}
      />
      <KpiCard
        icon={<BarChart3 className="h-3 w-3" />}
        label="Posición prom."
        value={`#${snapshot.position}`}
        delta={<DeltaBadge delta={snapshot.positionDelta} lowerIsBetter />}
      />
      <KpiCard
        icon={<TrendingUp className="h-3 w-3" />}
        label="CTR"
        value={`${snapshot.ctr}%`}
        delta={<DeltaBadge delta={snapshot.ctrDelta} />}
      />
    </div>
  );
}
