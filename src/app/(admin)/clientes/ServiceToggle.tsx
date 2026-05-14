"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

const STORAGE_KEY = "cerebroseo:clientFilter";

export function ServiceToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<"seo" | "all">("seo");

  // Inicializar desde localStorage en mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as "seo" | "all" | null;
    const urlFilter = searchParams.get("filter") as "seo" | "all" | null;
    const active = urlFilter ?? stored ?? "seo";
    setFilter(active);
    if (!urlFilter) {
      // Sincronizar URL con preferencia almacenada
      const params = new URLSearchParams(searchParams.toString());
      params.set("filter", active);
      router.replace(`${pathname}?${params.toString()}`);
    }
  }, []);

  function toggle(value: "seo" | "all") {
    setFilter(value);
    localStorage.setItem(STORAGE_KEY, value);
    const params = new URLSearchParams(searchParams.toString());
    params.set("filter", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
      <button
        onClick={() => toggle("seo")}
        className={[
          "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
          filter === "seo"
            ? "bg-white text-gray-900 shadow-sm"
            : "text-gray-500 hover:text-gray-700",
        ].join(" ")}
      >
        SEO
      </button>
      <button
        onClick={() => toggle("all")}
        className={[
          "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
          filter === "all"
            ? "bg-white text-gray-900 shadow-sm"
            : "text-gray-500 hover:text-gray-700",
        ].join(" ")}
      >
        Todos los activos
      </button>
    </div>
  );
}
