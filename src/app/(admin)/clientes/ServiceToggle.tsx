"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "cerebroseo:clientFilter";

export function ServiceToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<"seo" | "all">("seo");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as "seo" | "all" | null;
    const urlFilter = searchParams.get("filter") as "seo" | "all" | null;
    const active = urlFilter ?? stored ?? "seo";
    setFilter(active);
    if (!urlFilter) {
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
    <div className="inline-flex items-center bg-card border border-border rounded-full p-0.5">
      <button
        onClick={() => toggle("seo")}
        className={cn(
          "px-3 py-1 font-mono text-[0.75rem] uppercase tracking-wide rounded-full transition-colors",
          filter === "seo"
            ? "bg-primary/15 text-ds-green border border-ds-gd"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        SEO
      </button>
      <button
        onClick={() => toggle("all")}
        className={cn(
          "px-3 py-1 font-mono text-[0.75rem] uppercase tracking-wide rounded-full transition-colors",
          filter === "all"
            ? "bg-primary/15 text-ds-green border border-ds-gd"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        Todos
      </button>
    </div>
  );
}
