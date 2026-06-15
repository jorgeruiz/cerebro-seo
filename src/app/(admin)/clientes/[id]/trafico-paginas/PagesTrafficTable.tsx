"use client";

import { useState, useTransition } from "react";
import { ChevronUp, ChevronDown, Loader2 } from "lucide-react";
import { InfoTooltip } from "@/components/ui-darkui";
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
  tooltip: string;
};

const GA4_COLS: ColDef[] = [
  { key: "sessions",    label: "Sesiones",    source: "ga4", format: (v) => v === null ? "—" : fmt.format(v), tooltip: "Sesiones de usuarios en esta página según GA4." },
  { key: "users",       label: "Usuarios",    source: "ga4", format: (v) => v === null ? "—" : fmt.format(v), tooltip: "Usuarios únicos que visitaron esta página en GA4." },
  { key: "conversions", label: "Conversiones",source: "ga4", format: (v) => v === null ? "—" : fmt.format(v), tooltip: "Conversiones (eventos clave) atribuidas a esta página en GA4." },
  { key: "bounceRate",  label: "Rebote",      source: "ga4", format: (v) => v === null ? "—" : `${v.toFixed(1)}%`, tooltip: "Tasa de rebote: % de sesiones donde el usuario no interactuó y salió. Menor es mejor." },
];

const GSC_COLS: ColDef[] = [
  { key: "clicks",      label: "Clics",       source: "gsc", format: (v) => v === null ? "—" : fmt.format(v), tooltip: "Clics orgánicos desde Google Search Console para esta URL." },
  { key: "impressions", label: "Impresiones", source: "gsc", format: (v) => v === null ? "—" : fmt.format(v), tooltip: "Veces que esta URL apareció en resultados de Google." },
  { key: "ctr",         label: "CTR",         source: "gsc", format: (v) => v === null ? "—" : `${v.toFixed(2)}%`, tooltip: "Click-Through Rate: % de impresiones que generaron clic. CTR bajo en buena posición = oportunidad de mejorar title/meta." },
  { key: "position",    label: "Posición",    source: "gsc", format: (v) => v === null ? "—" : v.toFixed(1), tooltip: "Posición promedio de esta URL en Google. Posiciones 4–10 son oportunidades de mejora rápida." },
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
        <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => handleRange(r.value)}
              className={[
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                range === r.value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Badges de fuentes activas */}
        <div className="flex gap-1.5">
          {hasGa4 && (
            <span className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded border bg-primary/10 text-primary border-primary/30">
              GA4
            </span>
          )}
          {hasGsc && (
            <span className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded border bg-ds-blue/10 text-ds-blue border-ds-blue/40">
              GSC
            </span>
          )}
        </div>

        {isPending && <Loader2 className="h-4 w-4 animate-spin text-primary ml-auto" />}

        {data && (
          <span className="ml-auto text-xs text-muted-foreground font-mono">
            {data.total > 200
              ? `Top 200 de ${fmt.format(data.total)} páginas`
              : `${fmt.format(data.total)} páginas`}
          </span>
        )}
      </div>

      {/* Tabla */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border">
                <TableHead className="text-xs font-mono text-muted-foreground py-3 pl-4 min-w-[200px]">
                  Página
                </TableHead>
                {activeCols.map((col) => (
                  <TableHead
                    key={col.key}
                    className="text-xs font-mono text-muted-foreground py-3 pr-4 text-right cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
                    onClick={() => handleSort(col.key)}
                  >
                    <span className="flex items-center justify-end gap-1">
                      <InfoTooltip>{col.tooltip}</InfoTooltip>
                      {col.label}
                      {sortBy === col.key ? (
                        sortDir === "desc"
                          ? <ChevronDown className="h-3 w-3 text-primary" />
                          : <ChevronUp className="h-3 w-3 text-primary" />
                      ) : (
                        <ChevronDown className="h-3 w-3 text-muted-foreground/30" />
                      )}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="border-border/50">
                    <TableCell className="pl-4 py-2.5">
                      <div className="h-3.5 bg-muted rounded animate-pulse w-48" />
                    </TableCell>
                    {activeCols.map((col) => (
                      <TableCell key={col.key} className="pr-4 text-right">
                        <div className="h-3.5 bg-muted rounded animate-pulse w-12 ml-auto" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : pages.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={activeCols.length + 1}
                    className="text-center py-12 text-sm text-muted-foreground"
                  >
                    Sin datos para el período seleccionado
                  </TableCell>
                </TableRow>
              ) : (
                pages.map((row, i) => (
                  <TableRow key={i} className="border-border/50 hover:bg-muted/30">
                    <TableCell
                      className="pl-4 py-2.5 text-sm text-foreground font-medium"
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
                          className={`pr-4 text-right text-sm tabular-nums ${isNull ? "text-muted-foreground/30" : "text-foreground"}`}
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
          <div className="px-4 py-2.5 border-t border-border">
            <p className="text-[10px] text-muted-foreground/60 font-mono">
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
