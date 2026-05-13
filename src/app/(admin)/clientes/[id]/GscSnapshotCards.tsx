import { MousePointerClick, Eye, BarChart3, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { GscSnapshot } from "./actions";

interface Props {
  snapshot: GscSnapshot;
}

function DeltaBadge({ delta, lowerIsBetter = false }: { delta: number; lowerIsBetter?: boolean }) {
  if (delta === 0) return <Minus className="h-3 w-3 text-gray-400" />;
  const isPositive = lowerIsBetter ? delta < 0 : delta > 0;
  const Icon = delta > 0 ? TrendingUp : TrendingDown;
  const color = isPositive ? "text-green-600" : "text-red-500";
  const sign = delta > 0 ? "+" : "";
  return (
    <span className={`flex items-center gap-0.5 text-[11px] font-medium ${color}`}>
      <Icon className="h-3 w-3" />
      {sign}{delta}
    </span>
  );
}

export function GscSnapshotCards({ snapshot }: Props) {
  const cards = [
    {
      label: "Clics orgánicos",
      icon: MousePointerClick,
      color: "text-indigo-500",
      value: snapshot.clicks.toLocaleString("es-MX"),
      delta: snapshot.clicksDelta,
      lowerIsBetter: false,
    },
    {
      label: "Impresiones",
      icon: Eye,
      color: "text-blue-500",
      value: snapshot.impressions.toLocaleString("es-MX"),
      delta: snapshot.impressionsDelta,
      lowerIsBetter: false,
    },
    {
      label: "Posición prom.",
      icon: BarChart3,
      color: "text-pink-500",
      value: `#${snapshot.position}`,
      delta: snapshot.positionDelta,
      lowerIsBetter: true, // posición menor = mejor
    },
    {
      label: "CTR",
      icon: TrendingUp,
      color: "text-green-500",
      value: `${snapshot.ctr}%`,
      delta: snapshot.ctrDelta,
      lowerIsBetter: false,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map(({ label, icon: Icon, color, value, delta, lowerIsBetter }) => (
        <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 ${color}`} />
              <span className="text-xs text-gray-500">{label}</span>
            </div>
            <DeltaBadge delta={delta} lowerIsBetter={lowerIsBetter} />
          </div>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          <p className="text-[10px] text-gray-400 mt-1">vs 28d anteriores</p>
        </div>
      ))}
    </div>
  );
}
