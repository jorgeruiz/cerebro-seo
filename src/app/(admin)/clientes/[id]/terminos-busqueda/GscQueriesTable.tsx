"use client";

import { useState, useTransition } from "react";
import { ChevronUp, ChevronDown, Loader2 } from "lucide-react";
import { InfoTooltip } from "@/components/ui-darkui";
import { QueryClipboardButton } from "./QueryClipboardButton";
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

const COLUMNS: { key: GscQueriesSortBy; label: string; align: "left" | "right"; tooltip: string }[] = [
  { key: "clicks",      label: "Clics",       align: "right", tooltip: "Clics orgánicos desde Google Search Console para esta query en el período seleccionado." },
  { key: "impressions", label: "Impresiones",  align: "right", tooltip: "Veces que el sitio apareció en Google para esta query, aunque el usuario no haya hecho clic." },
  { key: "ctr",         label: "CTR",          align: "right", tooltip: "Click-Through Rate: % de impresiones que generaron un clic. CTR bajo en buenas posiciones indica que el title/meta se puede mejorar." },
  { key: "position",    label: "Posición",     align: "right", tooltip: "Posición promedio del sitio en Google para esta query. 1 = primer resultado orgánico." },
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

        {/* Select device */}
        <select
          value={device}
          onChange={(e) => handleDevice(e.target.value as GscQueriesDevice)}
          className="border border-border rounded-lg px-3 py-1.5 text-xs text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {DEVICES.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>

        {/* Select country */}
        <select
          value={country}
          onChange={(e) => handleCountry(e.target.value)}
          className="border border-border rounded-lg px-3 py-1.5 text-xs text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {COUNTRIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>

        {isPending && (
          <Loader2 className="h-4 w-4 animate-spin text-primary ml-auto" />
        )}

        {data && (
          <span className="ml-auto text-xs text-muted-foreground font-mono">
            {data.total > 200
              ? `Mostrando top 200 de ${fmt.format(data.total)} queries`
              : `${fmt.format(data.total)} queries`}
          </span>
        )}
      </div>

      {/* Tabla */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border">
              <TableHead className="w-10 py-3 pl-3" />
              <TableHead className="text-xs font-mono text-muted-foreground py-3 pl-2">Query</TableHead>
              {COLUMNS.map((col) => (
                <TableHead
                  key={col.key}
                  className="text-xs font-mono text-muted-foreground py-3 pr-4 text-right cursor-pointer select-none hover:text-foreground transition-colors"
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
                  <TableCell className="pl-3 py-2.5 w-10" />
                  <TableCell className="pl-2 py-2.5">
                    <div className="h-3.5 bg-muted rounded animate-pulse w-48" />
                  </TableCell>
                  {COLUMNS.map((col) => (
                    <TableCell key={col.key} className="pr-4 text-right">
                      <div className="h-3.5 bg-muted rounded animate-pulse w-12 ml-auto" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : queries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-sm text-muted-foreground">
                  Sin queries para los filtros seleccionados
                </TableCell>
              </TableRow>
            ) : (
              queries.map((row, i) => (
                <TableRow key={i} className="border-border/50 hover:bg-muted/30">
                  <TableCell className="pl-3 py-2.5 w-10">
                    <QueryClipboardButton
                      query={row.query}
                      clicks={row.clicks}
                      impressions={row.impressions}
                      ctr={row.ctr}
                      position={row.position}
                    />
                  </TableCell>
                  <TableCell className="pl-2 py-2.5 text-sm text-foreground font-medium max-w-xs truncate">
                    {row.query}
                  </TableCell>
                  <TableCell className="pr-4 text-right text-sm text-foreground tabular-nums">
                    {fmt.format(row.clicks)}
                  </TableCell>
                  <TableCell className="pr-4 text-right text-sm text-foreground tabular-nums">
                    {fmt.format(row.impressions)}
                  </TableCell>
                  <TableCell className="pr-4 text-right text-sm text-foreground tabular-nums">
                    {row.ctr.toFixed(2)}%
                  </TableCell>
                  <TableCell className="pr-4 text-right text-sm text-foreground tabular-nums">
                    {row.position.toFixed(1)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {!isPending && queries.length > 0 && (
          <div className="px-4 py-2.5 border-t border-border">
            <p className="text-[10px] text-muted-foreground/60 font-mono">
              Fuente: Google Search Console · Caché 24h · Filtrado: {device === "all" ? "todos los dispositivos" : device} · {COUNTRIES.find(c => c.value === country)?.label ?? country}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
