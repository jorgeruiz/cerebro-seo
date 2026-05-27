"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { KeywordRow } from "./page";

// ─── Config ───────────────────────────────────────────────────────────────────

const CHART_COLORS = [
  "#6366f1", // indigo
  "#3b82f6", // blue
  "#ec4899", // pink
  "#10b981", // emerald
  "#f59e0b", // amber
];

const MAX_KEYWORDS = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────


/** Construye el dataset para Recharts: un array de {date, kw1, kw2...} */
function buildChartData(
  rows: KeywordRow[],
  selected: string[]
): Record<string, string | number | null>[] {
  const selectedRows = rows.filter((r) => selected.includes(r.id));
  if (selectedRows.length === 0) return [];

  // Recolectar todas las fechas únicas
  const dateSet = new Set<string>();
  for (const row of selectedRows) {
    for (const h of row.history) {
      dateSet.add(h.date.toISOString().slice(0, 10));
    }
  }

  const dates = Array.from(dateSet).sort();

  return dates.map((dateStr) => {
    const point: Record<string, string | number | null> = { date: dateStr };
    for (const row of selectedRows) {
      const h = row.history.find((h) => h.date.toISOString().slice(0, 10) === dateStr);
      // null = no hay dato; undefined = fuera del top 30 (representado como 31)
      point[row.id] = h ? (h.position ?? 31) : null;
    }
    return point;
  });
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function CustomTooltip({
  active,
  payload,
  label,
  rows,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number | null; color: string }>;
  label?: string;
  rows: KeywordRow[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-2">{label}</p>
      {payload.map((p) => {
        const row = rows.find((r) => r.id === p.dataKey);
        const pos = p.value === 31 ? ">30" : p.value === null ? "—" : `#${p.value}`;
        return (
          <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="text-gray-600 truncate max-w-[150px]">{row?.term ?? p.dataKey}</span>
            <span className="font-semibold text-gray-900 ml-auto">{pos}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  rows: KeywordRow[];
}

export function KeywordEvolutionChart({ rows }: Props) {
  // Por defecto: las primeras 5 keywords priority (o las primeras 5 si no hay priority)
  const defaultSelected = rows
    .filter((r) => r.isPriority)
    .slice(0, MAX_KEYWORDS)
    .map((r) => r.id);

  const [selected, setSelected] = useState<string[]>(
    defaultSelected.length > 0
      ? defaultSelected
      : rows.slice(0, MAX_KEYWORDS).map((r) => r.id)
  );

  function toggleKeyword(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((s) => s !== id);
      if (prev.length >= MAX_KEYWORDS) return prev;
      return [...prev, id];
    });
  }

  const chartData = buildChartData(rows, selected);

  if (chartData.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-8">
        Sin datos de evolución disponibles aún.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Selector de keywords */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-400 shrink-0">Mostrar (max {MAX_KEYWORDS}):</span>
        {rows.map((row, _i) => {
          const isSelected = selected.includes(row.id);
          const colorIndex = selected.indexOf(row.id);
          return (
            <button
              key={row.id}
              onClick={() => toggleKeyword(row.id)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
                isSelected
                  ? "text-white border-transparent"
                  : "bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200"
              } ${!isSelected && selected.length >= MAX_KEYWORDS ? "opacity-40 cursor-not-allowed" : ""}`}
              style={isSelected ? { background: CHART_COLORS[colorIndex % CHART_COLORS.length] } : undefined}
              disabled={!isSelected && selected.length >= MAX_KEYWORDS}
              title={row.term}
            >
              {row.term.length > 20 ? row.term.slice(0, 18) + "…" : row.term}
            </button>
          );
        })}
      </div>

      {/* Gráfica */}
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="date"
            tickFormatter={(v: string) => {
              const d = new Date(v + "T00:00:00Z");
              return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(d);
            }}
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            tickLine={false}
          />
          <YAxis
            reversed  // posición 1 arriba, 30 abajo
            domain={[1, 31]}
            tickFormatter={(v: number) => v === 31 ? ">30" : String(v)}
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            tickLine={false}
            width={32}
          />
          <Tooltip
            content={
              <CustomTooltip rows={rows} />
            }
          />
          <Legend
            formatter={(value) => {
              const row = rows.find((r) => r.id === value);
              return <span className="text-xs text-gray-600">{row?.term ?? value}</span>;
            }}
          />
          {selected.map((id, i) => (
            <Line
              key={id}
              type="monotone"
              dataKey={id}
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <p className="text-xs text-gray-400 text-center">
        Eje Y: posición en Google (1 = top). &ldquo;31&rdquo; = fuera del top 30.
      </p>
    </div>
  );
}
