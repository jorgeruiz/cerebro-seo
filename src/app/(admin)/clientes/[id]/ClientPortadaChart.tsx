"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";
import type { DailyGscMetric } from "@/server/providers/google-search-console";

const METRICS = [
  { key: "clicks", label: "Clics", color: "#6366f1", format: (v: number) => v.toLocaleString("es-MX") },
  { key: "impressions", label: "Impresiones", color: "#3b82f6", format: (v: number) => v.toLocaleString("es-MX") },
  { key: "position", label: "Posición prom.", color: "#ec4899", format: (v: number) => `#${v}` },
  { key: "ctr", label: "CTR", color: "#10b981", format: (v: number) => `${v}%` },
];

const RANGES = ["28d", "90d", "12m"] as const;
type Range = (typeof RANGES)[number];

interface Props {
  data: DailyGscMetric[] | null;
}

export function ClientPortadaChart({ data }: Props) {
  const [metric, setMetric] = useState("clicks");
  const [range, setRange] = useState<Range>("90d");

  const activeMetric = METRICS.find((m) => m.key === metric)!;

  if (!data || data.length === 0) {
    return (
      <div className="h-48 flex flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium text-gray-500">Sin datos de tráfico orgánico</p>
        <p className="text-xs text-gray-400 max-w-xs">
          No hay datos GSC disponibles para este período. Si acabas de conectar la propiedad,
          vuelve a cargar la página.
        </p>
      </div>
    );
  }

  const sliced =
    range === "28d" ? data.slice(-28) : range === "90d" ? data.slice(-90) : data;

  const chartData = sliced.map((d) => ({ ...d, date: d.label }));

  return (
    <div>
      {/* Controles */}
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="flex gap-1">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                metric === m.key
                  ? "text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
              )}
              style={metric === m.key ? { backgroundColor: m.color } : {}}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1 bg-gray-50 rounded-lg p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                range === r
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Gráfica */}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              tickLine={false}
              axisLine={false}
              interval={range === "28d" ? 3 : range === "90d" ? 6 : 30}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) =>
                v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
              }
            />
            <Tooltip
              contentStyle={{
                fontSize: 12,
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.05)",
              }}
              formatter={(v) => [
                typeof v === "number" ? activeMetric.format(v) : String(v),
                activeMetric.label,
              ]}
              labelStyle={{ color: "#64748b", marginBottom: 4 }}
            />
            <Line
              type="monotone"
              dataKey={metric}
              stroke={activeMetric.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[10px] text-gray-400 mt-3 text-center">
        Fuente: Google Search Console · Cache 24h
      </p>
    </div>
  );
}
