"use client";

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

export interface AuditHistoryPoint {
  date: string;       // formatted label
  overall: number;
  technical: number;
  performance: number;
  content: number;
}

interface Props {
  data: AuditHistoryPoint[];
}

export function AuditScoreChart({ data }: Props) {
  if (data.length < 2) return null;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            fontSize: "11px",
            color: "hsl(var(--foreground))",
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: "10px", paddingTop: "8px" }}
          iconType="circle"
          iconSize={6}
        />
        <Line type="monotone" dataKey="overall" name="Overall" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        <Line type="monotone" dataKey="technical" name="Técnico" stroke="#22c55e" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="4 2" />
        <Line type="monotone" dataKey="performance" name="Performance" stroke="#f59e0b" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="4 2" />
        <Line type="monotone" dataKey="content" name="Contenido" stroke="#3b82f6" strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="4 2" />
      </LineChart>
    </ResponsiveContainer>
  );
}
