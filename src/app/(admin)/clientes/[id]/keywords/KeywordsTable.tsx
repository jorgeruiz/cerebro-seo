"use client";

import { useState } from "react";
import { ChevronUp, ChevronDown, Star, TrendingUp, TrendingDown, Minus, ExternalLink, Download } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { KeywordRow } from "./page";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function PositionBadge({ pos }: { pos: number | null }) {
  if (pos === null) {
    return <span className="text-xs text-gray-400 italic">—</span>;
  }
  const color =
    pos <= 3 ? "bg-green-100 text-green-800 border-green-200"
    : pos <= 10 ? "bg-blue-100 text-blue-800 border-blue-200"
    : pos <= 30 ? "bg-indigo-100 text-indigo-800 border-indigo-200"
    : "bg-gray-100 text-gray-600 border-gray-200";
  return (
    <span className={`inline-flex items-center justify-center w-9 h-7 rounded-lg border text-sm font-bold ${color}`}>
      {pos}
    </span>
  );
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-xs text-gray-300">—</span>;
  if (delta === 0) return (
    <span className="flex items-center gap-0.5 text-xs text-gray-400">
      <Minus className="h-3 w-3" /> 0
    </span>
  );
  if (delta > 0) return (
    <span className="flex items-center gap-0.5 text-xs font-medium text-green-700">
      <TrendingUp className="h-3 w-3" /> +{delta}
    </span>
  );
  return (
    <span className="flex items-center gap-0.5 text-xs font-medium text-red-600">
      <TrendingDown className="h-3 w-3" /> {delta}
    </span>
  );
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function MiniSparkline({ history }: { history: Array<{ date: Date; position: number | null }> }) {
  const points = [...history]
    .reverse() // history comes desc by date — reverse to chronological
    .filter((h): h is { date: Date; position: number } => h.position !== null);

  if (points.length < 2) {
    return <span className="text-xs text-gray-300">—</span>;
  }

  const W = 60, H = 24, PAD = 2;
  const positions = points.map((p) => p.position);
  const minPos = Math.min(...positions);
  const maxPos = Math.max(...positions);
  const range = maxPos - minPos || 1;

  // Lower position number = better = higher on chart (inverted Y)
  const toY = (pos: number) => PAD + ((pos - minPos) / range) * (H - PAD * 2);
  const toX = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);

  const polyPoints = points.map((p, i) => `${toX(i).toFixed(1)},${toY(p.position).toFixed(1)}`).join(" ");

  const first = points[0].position;
  const last = points[points.length - 1].position;
  const color = last < first ? "#22c55e" : last > first ? "#ef4444" : "#6b7280";

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <polyline
        points={polyPoints}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.8"
      />
    </svg>
  );
}

type SortField = "term" | "currentPosition" | "delta7d" | "delta30d" | "lastTracked";
type SortDir = "asc" | "desc";
type FilterType = "all" | "priority" | "bulk";
type FilterRange = "all" | "top3" | "top10" | "top30" | "out";

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  rows: KeywordRow[];
}

export function KeywordsTable({ rows }: Props) {
  const [sortField, setSortField] = useState<SortField>("currentPosition");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [filterRange, setFilterRange] = useState<FilterRange>("all");
  const [page, setPage] = useState(0);

  const PAGE_SIZE = 50;

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    setPage(0);
  }

  // Filter
  let filtered = rows;
  if (filterType === "priority") filtered = filtered.filter((r) => r.isPriority);
  if (filterType === "bulk") filtered = filtered.filter((r) => !r.isPriority);
  if (filterRange === "top3") filtered = filtered.filter((r) => r.currentPosition !== null && r.currentPosition <= 3);
  if (filterRange === "top10") filtered = filtered.filter((r) => r.currentPosition !== null && r.currentPosition <= 10);
  if (filterRange === "top30") filtered = filtered.filter((r) => r.currentPosition !== null && r.currentPosition <= 30);
  if (filterRange === "out") filtered = filtered.filter((r) => r.currentPosition === null);

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let av: number | string | null, bv: number | string | null;
    switch (sortField) {
      case "term": av = a.term; bv = b.term; break;
      case "currentPosition": av = a.currentPosition ?? 999; bv = b.currentPosition ?? 999; break;
      case "delta7d": av = a.delta7d ?? -999; bv = b.delta7d ?? -999; break;
      case "delta30d": av = a.delta30d ?? -999; bv = b.delta30d ?? -999; break;
      case "lastTracked": av = a.lastTracked ? +a.lastTracked : 0; bv = b.lastTracked ? +b.lastTracked : 0; break;
    }
    if (av === bv) return 0;
    const cmp = (av ?? 0) < (bv ?? 0) ? -1 : 1;
    return sortDir === "asc" ? cmp : -cmp;
  });

  const pageData = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

  function exportCSV() {
    const headers = ["Keyword", "Tipo", "País", "Posición", "7d", "30d", "URL rankeando", "Actualizado"];
    const fmtDate = (d: Date | null) =>
      d ? new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" }).format(d) : "";
    const escape = (v: string | number | null) => {
      const s = v === null ? "" : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [
      headers.join(","),
      ...sorted.map((r) =>
        [
          escape(r.term),
          escape(r.isPriority ? "Priority" : "Bulk"),
          escape(r.country),
          escape(r.currentPosition),
          escape(r.delta7d),
          escape(r.delta30d),
          escape(r.rankingUrl),
          escape(fmtDate(r.lastTracked)),
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob(["\uFEFF" + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `keywords-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronUp className="h-3 w-3 text-gray-300" />;
    return sortDir === "asc"
      ? <ChevronUp className="h-3 w-3 text-indigo-500" />
      : <ChevronDown className="h-3 w-3 text-indigo-500" />;
  }

  const filterBtnClass = (active: boolean) =>
    `px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
      active ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
    }`;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
      {/* Filters */}
      <div className="p-4 border-b border-gray-100 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400">Tipo:</span>
          <button className={filterBtnClass(filterType === "all")} onClick={() => { setFilterType("all"); setPage(0); }}>Todas</button>
          <button className={filterBtnClass(filterType === "priority")} onClick={() => { setFilterType("priority"); setPage(0); }}>
            <span className="flex items-center gap-1"><Star className="h-3 w-3" />Priority</span>
          </button>
          <button className={filterBtnClass(filterType === "bulk")} onClick={() => { setFilterType("bulk"); setPage(0); }}>Bulk</button>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400">Posición:</span>
          {(["all", "top3", "top10", "top30", "out"] as FilterRange[]).map((r) => (
            <button key={r} className={filterBtnClass(filterRange === r)} onClick={() => { setFilterRange(r); setPage(0); }}>
              {r === "all" ? "Todas" : r === "out" ? "Fuera" : r.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-400">{sorted.length} keywords</span>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
          >
            <Download className="h-3 w-3" />
            CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>
              <button className="flex items-center gap-1 text-xs font-semibold hover:text-gray-800" onClick={() => toggleSort("term")}>
                Keyword <SortIcon field="term" />
              </button>
            </TableHead>
            <TableHead>
              <button className="flex items-center gap-1 text-xs font-semibold hover:text-gray-800" onClick={() => toggleSort("currentPosition")}>
                Posición <SortIcon field="currentPosition" />
              </button>
            </TableHead>
            <TableHead className="text-xs font-semibold text-gray-500">Tendencia</TableHead>
            <TableHead>
              <button className="flex items-center gap-1 text-xs font-semibold hover:text-gray-800" onClick={() => toggleSort("delta7d")}>
                7d <SortIcon field="delta7d" />
              </button>
            </TableHead>
            <TableHead>
              <button className="flex items-center gap-1 text-xs font-semibold hover:text-gray-800" onClick={() => toggleSort("delta30d")}>
                30d <SortIcon field="delta30d" />
              </button>
            </TableHead>
            <TableHead className="text-xs font-semibold">URL rankeando</TableHead>
            <TableHead>
              <button className="flex items-center gap-1 text-xs font-semibold hover:text-gray-800" onClick={() => toggleSort("lastTracked")}>
                Actualizado <SortIcon field="lastTracked" />
              </button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageData.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-sm text-gray-400 py-8">
                Sin keywords que coincidan con los filtros seleccionados
              </TableCell>
            </TableRow>
          ) : (
            pageData.map((row) => (
              <TableRow key={row.id} className="hover:bg-gray-50/50">
                <TableCell>
                  <div className="flex items-center gap-2">
                    {row.isPriority && <Star className="h-3.5 w-3.5 text-amber-400 shrink-0" fill="currentColor" />}
                    <span className="text-sm font-medium text-gray-900">{row.term}</span>
                    <span className="text-[10px] text-gray-400 uppercase">{row.country}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <PositionBadge pos={row.currentPosition} />
                </TableCell>
                <TableCell>
                  <MiniSparkline history={row.history} />
                </TableCell>
                <TableCell>
                  <DeltaBadge delta={row.delta7d} />
                </TableCell>
                <TableCell>
                  <DeltaBadge delta={row.delta30d} />
                </TableCell>
                <TableCell className="max-w-[200px]">
                  {row.rankingUrl ? (
                    <a
                      href={row.rankingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-indigo-600 hover:underline truncate"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="truncate">{row.rankingUrl.replace(/^https?:\/\//, "")}</span>
                    </a>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-xs text-gray-400">
                    {row.lastTracked
                      ? new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(row.lastTracked)
                      : "—"}
                  </span>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="p-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-400">Página {page + 1} de {totalPages}</span>
          <div className="flex items-center gap-2">
            <button
              className="text-xs px-3 py-1 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 0}
            >
              Anterior
            </button>
            <button
              className="text-xs px-3 py-1 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages - 1}
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
