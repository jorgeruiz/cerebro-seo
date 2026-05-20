"use client";

import { useState, useTransition } from "react";
import { ChevronUp, ChevronDown, Loader2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getGscQueries } from "../actions";
import type { GscQueryRow, GscQueriesSortBy, GscQueriesDevice, GscRange } from "../actions";

const fmt = new Intl.NumberFormat("es-MX");

interface Props {
  clientId: string;
  initialData: { queries: GscQueryRow[]; total: number } | null;
}

const RANGES: { value: GscRange; label: string }[] = [
  { value: "28d", label: "28d" },
  { value: "90d", label: "90d" },
  { value: "12m", label: "12m" },
];

const DEVICES: { value: GscQueriesDevice; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
  { value: "tablet", label: "Tablet" },
];

const COUNTRIES = [
  { value: "all", label: "Todos los países" },
  { value: "mex", label: "México" },
  { value: "usa", label: "Estados Unidos" },
  { value: "esp", label: "España" },
  { value: "col", label: "Colombia" },
];

const COLUMNS: { key: GscQueriesSortBy; label: string; align: "left" | "right" }[] = [
  { key: "clicks",      label: "Clics",       align: "right" },
  { key: "impressions", label: "Impresiones",  align: "right" },
  { key: "ctr",         label: "CTR",          align: "right" },
  { key: "position",    label: "Posición",     align: "right" },
];

export function GscQueriesTable({ clientId, initialData }: Props) {
  const [range, setRange] = useState<GscRange>("28d");
  const [device, setDevice] = useState<GscQueriesDevice>("all");
  const [country, setCountry] = useState("all");
  const [sortBy, setSortBy] = useState<GscQueriesSortBy>("clicks");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [data, setData] = useState(initialData);
  const [isPending, startTransition] = useTransition();

  async function refetch(overrides: Partial<{
    range: GscRange;
    device: GscQueriesDevice;
    country: string;
    sortBy: GscQueriesSortBy;
    sortDir: "asc" | "desc";
  }> = {}) {
    const params = {
      clientId,
      range: overrides.range ?? range,
      device: overrides.device ?? device,
      country: overrides.country ?? country,
      sortBy: overrides.sortBy ?? sortBy,
      sortDir: overrides.sortDir ?? sortDir,
    };
    startTransition(async () => {
      const result = await getGscQueries(params);
      if (!("error" in result)) setData(result);
    });
  }

  function handleRange(v: GscRange) {
    setRange(v);
    void refetch({ range: v });
  }

  function handleDevice(v: GscQueriesDevice) {
    setDevice(v);
    void refetch({ device: v });
  }

  function handleCountry(v: string) {
    setCountry(v);
    void refetch({ country: v });
  }

  function handleSort(col: GscQueriesSortBy) {
    const newDir = sortBy === col && sortDir === "desc" ? "asc" : "desc";
    setSortBy(col);
    setSortDir(newDir);
    void refetch({ sortBy: col, sortDir: newDir });
  }

  const queries = data?.queries ?? [];

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Toggle de rango */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => handleRange(r.value)}
              className={[
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                range === r.value
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700",
              ].join(" ")}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Select device */}
        <select
          value={device}
          onChange={(e) => handleDevice(e.target.value as GscQueriesDevice)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {DEVICES.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>

        {/* Select country */}
        <select
          value={country}
          onChange={(e) => handleCountry(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {COUNTRIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>

        {isPending && (
          <Loader2 className="h-4 w-4 animate-spin text-indigo-500 ml-auto" />
        )}

        {data && (
          <span className="ml-auto text-xs text-gray-400">
            {data.total > 200
              ? `Mostrando top 200 de ${fmt.format(data.total)} queries`
              : `${fmt.format(data.total)} queries`}
          </span>
        )}
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-gray-100">
              <TableHead className="text-xs font-semibold text-gray-500 py-3 pl-4">Query</TableHead>
              {COLUMNS.map((col) => (
                <TableHead
                  key={col.key}
                  className="text-xs font-semibold text-gray-500 py-3 pr-4 text-right cursor-pointer select-none hover:text-gray-900 transition-colors"
                  onClick={() => handleSort(col.key)}
                >
                  <span className="flex items-center justify-end gap-1">
                    {col.label}
                    {sortBy === col.key ? (
                      sortDir === "desc"
                        ? <ChevronDown className="h-3 w-3 text-indigo-500" />
                        : <ChevronUp className="h-3 w-3 text-indigo-500" />
                    ) : (
                      <ChevronDown className="h-3 w-3 text-gray-300" />
                    )}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i} className="border-gray-50">
                  <TableCell className="pl-4 py-2.5">
                    <div className="h-3.5 bg-gray-100 rounded animate-pulse w-48" />
                  </TableCell>
                  {COLUMNS.map((col) => (
                    <TableCell key={col.key} className="pr-4 text-right">
                      <div className="h-3.5 bg-gray-100 rounded animate-pulse w-12 ml-auto" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : queries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-sm text-gray-400">
                  Sin queries para los filtros seleccionados
                </TableCell>
              </TableRow>
            ) : (
              queries.map((row, i) => (
                <TableRow key={i} className="border-gray-50 hover:bg-gray-50/50">
                  <TableCell className="pl-4 py-2.5 text-sm text-gray-800 font-medium max-w-xs truncate">
                    {row.query}
                  </TableCell>
                  <TableCell className="pr-4 text-right text-sm text-gray-700 tabular-nums">
                    {fmt.format(row.clicks)}
                  </TableCell>
                  <TableCell className="pr-4 text-right text-sm text-gray-700 tabular-nums">
                    {fmt.format(row.impressions)}
                  </TableCell>
                  <TableCell className="pr-4 text-right text-sm text-gray-700 tabular-nums">
                    {row.ctr.toFixed(2)}%
                  </TableCell>
                  <TableCell className="pr-4 text-right text-sm text-gray-700 tabular-nums">
                    {row.position.toFixed(1)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {!isPending && queries.length > 0 && (
          <div className="px-4 py-2.5 border-t border-gray-50">
            <p className="text-[10px] text-gray-400">
              Fuente: Google Search Console · Caché 24h · Filtrado: {device === "all" ? "todos los dispositivos" : device} · {COUNTRIES.find(c => c.value === country)?.label ?? country}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
