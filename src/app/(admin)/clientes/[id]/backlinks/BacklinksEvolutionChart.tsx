"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface SnapshotPoint {
  label: string;
  totalBacklinks: number;
  uniqueDomains: number;
}

interface BacklinksEvolutionChartProps {
  snapshots: SnapshotPoint[];
}

export function BacklinksEvolutionChart({ snapshots }: BacklinksEvolutionChartProps) {
  if (snapshots.length < 2) {
    return (
      <div className="h-48 flex items-center justify-center text-center">
        <p className="text-sm text-muted-foreground max-w-xs">
          Datos insuficientes — la gráfica aparecerá tras el segundo crawl semanal.
        </p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={snapshots} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gradGreen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#7fc15e" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#7fc15e" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradBlue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#5ea8e0" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#5ea8e0" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}
          tickLine={false}
          axisLine={false}
          width={45}
        />
        <Tooltip
          contentStyle={{
            background: "#1a1a16",
            border: "1px solid #2a2a26",
            borderRadius: "6px",
            fontSize: 12,
            fontFamily: "monospace",
          }}
          labelStyle={{ color: "#c9c4b5", marginBottom: 4 }}
          itemStyle={{ color: "#ede8d8" }}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, fontFamily: "monospace", paddingTop: 8 }}
        />
        <Area
          type="monotone"
          dataKey="totalBacklinks"
          name="Total backlinks"
          stroke="#7fc15e"
          strokeWidth={2}
          fill="url(#gradGreen)"
          dot={false}
          activeDot={{ r: 4, fill: "#7fc15e" }}
        />
        <Area
          type="monotone"
          dataKey="uniqueDomains"
          name="Dominios referentes"
          stroke="#5ea8e0"
          strokeWidth={2}
          fill="url(#gradBlue)"
          dot={false}
          activeDot={{ r: 4, fill: "#5ea8e0" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
