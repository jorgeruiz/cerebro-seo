import { Activity, Users, TrendingUp, TrendingDown, MousePointerClick, Minus } from "lucide-react";
import type { Ga4Snapshot } from "./actions";
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
  snapshot: Ga4Snapshot;
}

export function Ga4SnapshotCards({ snapshot }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <KpiCard
        icon={<Activity className="h-3 w-3" />}
        label="Sesiones"
        value={snapshot.sessions.toLocaleString("es-MX")}
        delta={<DeltaBadge delta={snapshot.sessionsDelta} />}
      />
      <KpiCard
        icon={<Users className="h-3 w-3" />}
        label="Usuarios activos"
        value={snapshot.users.toLocaleString("es-MX")}
        delta={<DeltaBadge delta={snapshot.usersDelta} />}
      />
      <KpiCard
        icon={<TrendingUp className="h-3 w-3" />}
        label="Tasa de rebote"
        value={`${snapshot.bounceRate}%`}
        delta={<DeltaBadge delta={snapshot.bounceRateDelta} lowerIsBetter />}
      />
      <KpiCard
        icon={<MousePointerClick className="h-3 w-3" />}
        label="Conversiones"
        value={snapshot.conversions.toLocaleString("es-MX")}
        delta={<DeltaBadge delta={snapshot.conversionsDelta} />}
      />
    </div>
  );
}
