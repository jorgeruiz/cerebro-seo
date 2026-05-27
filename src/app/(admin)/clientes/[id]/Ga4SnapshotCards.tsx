import { Activity, Users, TrendingUp, TrendingDown, MousePointerClick, Minus } from "lucide-react";
import type { Ga4Snapshot } from "./actions";

interface Props {
  snapshot: Ga4Snapshot;
}

function DeltaBadge({ delta, lowerIsBetter = false }: { delta: number; lowerIsBetter?: boolean }) {
  if (delta === 0) return <Minus className="h-3 w-3 text-muted-foreground" />;
  const isPositive = lowerIsBetter ? delta < 0 : delta > 0;
  const Icon = delta > 0 ? TrendingUp : TrendingDown;
  const color = isPositive ? "text-ds-green" : "text-destructive";
  const sign = delta > 0 ? "+" : "";
  return (
    <span className={`flex items-center gap-0.5 text-[11px] font-medium font-mono ${color}`}>
      <Icon className="h-3 w-3" />
      {sign}{delta}
    </span>
  );
}

export function Ga4SnapshotCards({ snapshot }: Props) {
  const cards = [
    {
      label: "Sesiones",
      icon: Activity,
      color: "text-ds-green",
      value: snapshot.sessions.toLocaleString("es-MX"),
      delta: snapshot.sessionsDelta,
      lowerIsBetter: false,
    },
    {
      label: "Usuarios activos",
      icon: Users,
      color: "text-ds-blue",
      value: snapshot.users.toLocaleString("es-MX"),
      delta: snapshot.usersDelta,
      lowerIsBetter: false,
    },
    {
      label: "Tasa de rebote",
      icon: TrendingUp,
      color: "text-ds-orange",
      value: `${snapshot.bounceRate}%`,
      delta: snapshot.bounceRateDelta,
      lowerIsBetter: true,
    },
    {
      label: "Conversiones",
      icon: MousePointerClick,
      color: "text-ds-yellow",
      value: snapshot.conversions.toLocaleString("es-MX"),
      delta: snapshot.conversionsDelta,
      lowerIsBetter: false,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map(({ label, icon: Icon, color, value, delta, lowerIsBetter }) => (
        <div key={label} className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 ${color}`} />
              <span className="text-xs text-muted-foreground font-mono uppercase tracking-wide">{label}</span>
            </div>
            <DeltaBadge delta={delta} lowerIsBetter={lowerIsBetter} />
          </div>
          <p className="text-2xl font-bold text-foreground font-heading">{value}</p>
          <p className="text-[10px] text-muted-foreground mt-1 font-mono">vs 28d anteriores · Orgánico</p>
        </div>
      ))}
    </div>
  );
}
