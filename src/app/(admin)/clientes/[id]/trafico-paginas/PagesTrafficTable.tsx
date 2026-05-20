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
import { getPagesTraffic } from "../actions";
import type { PageTrafficSortBy, PagesTrafficResult, GscRange } from "../actions";

const fmt = new Intl.NumberFormat("es-MX");

interface Props {
  clientId: string;
  initialData: PagesTrafficResult | null;
  hasGsc: boolean;
  hasGa4: boolean;
}

const RANGES: { value: GscRange; label: string }[] = [
  { value: "28d", label: "28d" },
  { value: "90d", label: "90d" },
  { value: "12m", label: "12m" },
];

type ColDef = {
  key: PageTrafficSortBy;
  label: string;
  source: "ga4" | "gsc";
  format: (v: number | null) => string;
};

const GA4_COLS: ColDef[] = [
  { key: "sessions",    label: "Sesiones",    source: "ga4", format: (v) => v === null ? "—" : fmt.format(v) },
  { key: "users",       label: "Usuarios",    source: "ga4", format: (v) => v === null ? "—" : fmt.format(v) },
  { key: "conversions", label: "Conversiones",source: "ga4", format: (v) => v === null ? "—" : fmt.format(v) },
  { key: "bounceRate",  label: "Rebote",      source: "ga4", format: (v) => v === null ? "—" : `${v.toFixed(1)}%` },
];

const GSC_COLS: ColDef[] = [
  { key: "clicks",      label: "Clics",       source: "gsc", format: (v) => v === null ? "—" : fmt.format(v) },
  { key: "impressions", label: "Impresiones", source: "gsc", format: (v) => v === null ? "—" : fmt.format(v) },
  { key: "ctr",         label: "CTR",         source: "gsc", format: (v) => v === null ? "—" : `${v.toFixed(2)}%` },
  { key: "position",    label: "Posición",    source: "gsc", format: (v) => v === null ? "—" : v.toFixed(1) },
];

function truncatePage(url: string, max = 50): string {
  return url.length > max ? `…${url.slice(-(max - 1))}` : url;
}

export function PagesTrafficTable({ clientId, initialData, hasGsc, hasGa4 }: Props) {
  const defaultSortBy: PageTrafficSortBy = hasGa4 ? "sessions" : "clicks";
  const [range, setRange] = useState<GscRange>("28d");
  const [sortBy, setSortBy] = useState<PageTrafficSortBy>(defaultSortBy);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [data, setData] = useState(initialData);
  const [isPending, startTransition] = useTransition();

  async function refetch(overrides: Partial<{
    range: GscRange;
    sortBy: PageTrafficSortBy;
    sortDir: "asc" | "desc";
  }> = {}) {
    startTransition(async () => {
      const result = await getPagesTraffic({
        clientId,
        range: overrides.range ?? range,
        sortBy: overrides.sortBy ?? sortBy,
        sortDir: overrides.sortDir ?? sortDir,
      });
      if (!("error" in result)) setData(result);
    });
  }

  function handleRange(v: GscRange) {
    setRange(v);
    void refetch({ range: v });
  }

  function handleSort(col: PageTrafficSortBy) {
    const newDir = sortBy === col && sortDir === "desc" ? "asc" : "desc";
    setSortBy(col);
    setSortDir(newDir);
    void refetch({ sortBy: col, sortDir: newDir });
  }

  // Columnas activas según fuentes disponibles
  const activeCols = [
    ...(hasGa4 ? GA4_COLS : []),
    ...(hasGsc ? GSC_COLS : []),
  ];

  const pages = data?.pages ?? [];

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
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

        {/* Badges de fuentes activas */}
        <div className="flex gap-1.5">
          {hasGa4 && (
            <span className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded border bg-indigo-50 text-indigo-700 border-indigo-200">
              GA4
            </span>
          )}
          {hasGsc && (
            <span className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200">
              GSC
            </span>
          )}
        </div>

        {isPending && <Loader2 className="h-4 w-4 animate-spin text-indigo-500 ml-auto" />}

        {data && (
          <span className="ml-auto text-xs text-gray-400">
            {data.total > 200
              ? `Top 200 de ${fmt.format(data.total)} páginas`
              : `${fmt.format(data.total)} páginas`}
          </span>
        )}
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-gray-100">
                <TableHead className="text-xs font-semibold text-gray-500 py-3 pl-4 min-w-[200px]">
                  Página
                </TableHead>
                {activeCols.map((col) => (
                  <TableHead
                    key={col.key}
                    className="text-xs font-semibold text-gray-500 py-3 pr-4 text-right cursor-pointer select-none hover:text-gray-900 transition-colors whitespace-nowrap"
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
                    {activeCols.map((col) => (
                      <TableCell key={col.key} className="pr-4 text-right">
                        <div className="h-3.5 bg-gray-100 rounded animate-pulse w-12 ml-auto" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : pages.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={activeCols.length + 1}
                    className="text-center py-12 text-sm text-gray-400"
                  >
                    Sin datos para el período seleccionado
                  </TableCell>
                </TableRow>
              ) : (
                pages.map((row, i) => (
                  <TableRow key={i} className="border-gray-50 hover:bg-gray-50/50">
                    <TableCell
                      className="pl-4 py-2.5 text-sm text-gray-800 font-medium"
                      title={row.page}
                    >
                      <span className="font-mono text-xs">{truncatePage(row.page)}</span>
                    </TableCell>
                    {activeCols.map((col) => {
                      const v = row[col.key] as number | null;
                      const isNull = v === null;
                      return (
                        <TableCell
                          key={col.key}
                          className={`pr-4 text-right text-sm tabular-nums ${isNull ? "text-gray-300" : "text-gray-700"}`}
                        >
                          {col.format(v)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {!isPending && pages.length > 0 && (
          <div className="px-4 py-2.5 border-t border-gray-50">
            <p className="text-[10px] text-gray-400">
              {hasGa4 && "GA4: sesiones orgánicas (Organic Search)."}
              {hasGa4 && hasGsc && " · "}
              {hasGsc && "GSC: clics e impresiones orgánicas."}
              {" · "}Caché {hasGa4 ? "4h" : "24h"}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
