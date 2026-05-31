"use client";

import { useState } from "react";
import { Zap } from "lucide-react";
import { actionTriggerRankTracking } from "./actions";

export function TriggerTrackingButton({ clientId }: { clientId: string }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  async function trigger(mode: "priority" | "bulk") {
    setLoading(mode);
    setMsg("");
    const res = await actionTriggerRankTracking(clientId, mode);
    setLoading(null);
    if (res.error) {
      setMsg(`Error: ${res.error}`);
    } else {
      setMsg(`Job ${mode} encolado`);
      setTimeout(() => setMsg(""), 4000);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => trigger("priority")}
        disabled={loading !== null}
        className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide px-2.5 py-1 rounded-full border bg-ds-yellow/10 border-ds-yellow/40 text-ds-yellow hover:bg-ds-yellow/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <Zap className="h-3 w-3" />
        {loading === "priority" ? "Encolando..." : "Trackear priority"}
      </button>
      <button
        onClick={() => trigger("bulk")}
        disabled={loading !== null}
        className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide px-2.5 py-1 rounded-full border bg-muted border-border text-muted-foreground hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <Zap className="h-3 w-3" />
        {loading === "bulk" ? "Encolando..." : "Trackear bulk"}
      </button>
      {msg && (
        <span className="text-[10px] font-mono text-ds-green">{msg}</span>
      )}
    </div>
  );
}
