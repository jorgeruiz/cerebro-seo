"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { actionSyncNotion } from "./sync-action";

export function SyncButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const handleSync = () => {
    setResult(null);
    startTransition(async () => {
      const res = await actionSyncNotion();
      if (res.ok) {
        setResult(`✓ ${res.total} clientes (${res.created} nuevos, ${res.updated} actualizados)`);
        // Reload page to show updated data
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setResult(`✗ ${res.error}`);
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleSync}
        disabled={isPending}
        className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "gap-1.5")}
        title="Sincronizar clientes desde Notion"
      >
        {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        Sync Notion
      </button>
      {result && (
        <span className={cn(
          "font-mono text-[0.6rem]",
          result.startsWith("✓") ? "text-emerald-500" : "text-destructive"
        )}>
          {result}
        </span>
      )}
    </div>
  );
}
