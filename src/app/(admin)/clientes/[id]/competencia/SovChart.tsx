"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";

interface SovEntry {
  domain: string;
  sov: number;
}

interface Props {
  data: SovEntry[];
}

const COLORS = ["#e05090", "#5ea8e0", "#f5a623", "#7fc15e", "#a78bfa"];

export function SovChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        Sin datos de Share of Voice aún.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 52)}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 4, right: 48, bottom: 4, left: 8 }}
      >
        <XAxis
          type="number"
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="domain"
          width={140}
          tick={{ fontSize: 11, fontFamily: "var(--font-mono)", fill: "var(--foreground)" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.3 }}
          contentStyle={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "12px",
            fontFamily: "var(--font-mono)",
          }}
          formatter={(value) => [`${value}%`, "Share of Voice"]}
        />
        <Bar dataKey="sov" radius={[0, 4, 4, 0]} maxBarSize={28}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
          <LabelList
            dataKey="sov"
            position="right"
            formatter={(v) => `${v}%`}
            style={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "var(--muted-foreground)" }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
