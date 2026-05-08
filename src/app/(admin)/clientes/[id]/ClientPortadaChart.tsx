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

// Datos de placeholder hasta conectar GSC real en Fase 2
const MOCK_DATA = Array.from({ length: 30 }, (_, i) => {
  const date = new Date();
  date.setDate(date.getDate() - (29 - i));
  return {
    date: date.toLocaleDateString("es-MX", { day: "2-digit", month: "short" }),
    clicks: Math.floor(Math.random() * 400 + 200 + i * 8),
    impressions: Math.floor(Math.random() * 3000 + 1500 + i * 20),
    position: parseFloat((Math.random() * 5 + 12 - i * 0.1).toFixed(1)),
    ctr: parseFloat((Math.random() * 2 + 3).toFixed(1)),
  };
});

const METRICS = [
  { key: "clicks", label: "Clics", color: "#6366f1", format: (v: number) => v.toLocaleString() },
  { key: "impressions", label: "Impresiones", color: "#3b82f6", format: (v: number) => v.toLocaleString() },
  { key: "position", label: "Posición prom.", color: "#ec4899", format: (v: number) => `#${v}` },
  { key: "ctr", label: "CTR", color: "#10b981", format: (v: number) => `${v}%` },
];

const RANGES = ["7d", "28d", "90d"] as const;
type Range = (typeof RANGES)[number];

export function ClientPortadaChart() {
  const [metric, setMetric] = useState("clicks");
  const [range, setRange] = useState<Range>("28d");

  const activeMetric = METRICS.find((m) => m.key === metric)!;

  const data =
    range === "7d" ? MOCK_DATA.slice(-7) : range === "28d" ? MOCK_DATA.slice(-28) : MOCK_DATA;

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
          <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              tickLine={false}
              axisLine={false}
              interval={range === "7d" ? 0 : range === "28d" ? 3 : 6}
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
              formatter={(v) => [typeof v === "number" ? activeMetric.format(v) : String(v), activeMetric.label]}
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
        Datos de ejemplo — se conectará a Google Search Console en la Fase 2
      </p>
    </div>
  );
}
