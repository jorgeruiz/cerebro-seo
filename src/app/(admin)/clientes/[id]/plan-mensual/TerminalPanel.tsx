"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Terminal, Send, Save, X, Loader2,
  DollarSign, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface StreamMessage {
  type: string;
  text?: string;
  message?: string;
  tool?: string;
  input?: string;
  status?: string;
  costUsd?: number;
  saved?: boolean;
  sha?: string;
  branch?: string;
  detail?: string;
  is_error?: boolean;
}

interface Props {
  planId: string;
  taskId?: string | null;
  isAdmin: boolean;
  planLocked: boolean;
}

// ─── Terminal Panel ──────────────────────────────────────────────────────────

export function TerminalPanel({ planId, taskId, isAdmin, planLocked }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StreamMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "saving" | "closed" | "disconnected">("disconnected");
  const [cost, setCost] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // SSE connection
  const connectSSE = useCallback((sid: string) => {
    if (eventSourceRef.current) eventSourceRef.current.close();

    const es = new EventSource(`/api/terminal/stream/${sid}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const msg: StreamMessage = JSON.parse(event.data);
        setMessages((prev) => [...prev, msg]);

        if (msg.type === "status" && msg.status) {
          setStatus(msg.status as typeof status);
          if (msg.status === "closed") {
            es.close();
            setSessionId(null);
          }
        }

        if (msg.type === "cost_update" && msg.costUsd != null) {
          setCost(msg.costUsd);
        }

        if (msg.type === "error" && msg.message) {
          setError(msg.message);
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      setStatus("disconnected");
      // Auto-reconnect after 3s (EventSource does this, but signal the UI)
    };

    setStatus("idle");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  // ─── Actions ─────────────────────────────────────────────────────────────

  async function handleOpen() {
    setIsOpening(true);
    setError(null);
    try {
      const res = await fetch("/api/terminal/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, taskId }),
      });
      const data = await res.json();
      if (data.sessionId) {
        setSessionId(data.sessionId);
        setMessages([]);
        setCost(0);
        connectSSE(data.sessionId);
      } else {
        setError(data.error ?? "Error al abrir terminal");
      }
    } catch (_err) {
      setError("Error de conexión");
    }
    setIsOpening(false);
  }

  async function handleSend() {
    if (!sessionId || !input.trim() || status === "running") return;
    const prompt = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { type: "user_input", text: prompt }]);

    try {
      await fetch("/api/terminal/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, prompt }),
      });
    } catch {
      setError("Error al enviar mensaje");
    }
  }

  async function handleSave() {
    if (!sessionId) return;
    try {
      await fetch("/api/terminal/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    } catch {
      setError("Error al guardar");
    }
  }

  async function handleClose() {
    if (!sessionId) return;
    try {
      await fetch("/api/terminal/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    } catch {
      setError("Error al cerrar");
    }
  }

  // ─── Render: not opened yet ──────────────────────────────────────────────

  if (!sessionId) {
    return (
      <div className="sticky top-8 bg-card rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground/60" />
          <span className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
            Terminal
          </span>
        </div>

        {planLocked && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
            <p className="font-mono text-[0.6rem] text-yellow-600">
              Hay una tarea en ejecucion. Terminal en solo lectura.
            </p>
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-2">
            <p className="font-mono text-[0.6rem] text-destructive">{error}</p>
          </div>
        )}

        <div className="bg-zinc-950 rounded-lg p-4 min-h-[200px] flex items-center justify-center">
          {isAdmin && !planLocked ? (
            <button
              onClick={handleOpen}
              disabled={isOpening}
              className={cn(buttonVariants({ variant: "default", size: "sm" }), "gap-1.5")}
            >
              {isOpening ? <Loader2 className="h-3 w-3 animate-spin" /> : <Terminal className="h-3 w-3" />}
              Abrir terminal
            </button>
          ) : (
            <p className="font-mono text-[0.6rem] text-zinc-500 text-center">
              {!isAdmin ? "Solo administradores pueden usar la terminal" : "Terminal bloqueada"}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ─── Render: active session ──────────────────────────────────────────────

  return (
    <div className="sticky top-8 bg-card rounded-xl border border-border overflow-hidden flex flex-col" style={{ maxHeight: "calc(100vh - 100px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-zinc-950/50">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-emerald-500" />
          <span className="font-mono text-[0.65rem] text-emerald-500">
            {status === "running" ? "Ejecutando..." : status === "saving" ? "Guardando..." : "Terminal"}
          </span>
          {status === "running" && <Loader2 className="h-2.5 w-2.5 animate-spin text-emerald-500" />}
        </div>
        <div className="flex items-center gap-2">
          {cost > 0 && (
            <span className="font-mono text-[0.6rem] text-muted-foreground flex items-center gap-0.5">
              <DollarSign className="h-2.5 w-2.5" />
              {cost.toFixed(4)}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={status === "running" || status === "saving"}
            className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "h-6 text-[0.6rem] px-2 gap-1")}
            title="Guardar en la rama (build + commit + push)"
          >
            <Save className="h-2.5 w-2.5" /> Guardar
          </button>
          <button
            onClick={handleClose}
            className={cn(buttonVariants({ variant: "outline-mono", size: "sm" }), "h-6 text-[0.6rem] px-1.5")}
            title="Cerrar terminal"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-zinc-950 p-3 space-y-2 min-h-[300px]">
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-1.5 bg-destructive/10 border-t border-destructive/30">
          <p className="font-mono text-[0.6rem] text-destructive flex items-center gap-1">
            <AlertTriangle className="h-2.5 w-2.5" /> {error}
          </p>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border p-2 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder={status === "running" ? "Esperando al agente..." : "Escribe un mensaje..."}
          disabled={status === "running" || status === "saving"}
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || status === "running" || status === "saving"}
          className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-8 px-2")}
        >
          <Send className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Message Bubble ──────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: StreamMessage }) {
  switch (msg.type) {
    case "user_input":
      return (
        <div className="flex justify-end">
          <div className="bg-emerald-500/20 rounded-lg px-3 py-1.5 max-w-[85%]">
            <p className="font-mono text-xs text-emerald-200 whitespace-pre-wrap">{msg.text}</p>
          </div>
        </div>
      );

    case "agent_text":
      return (
        <div className="bg-zinc-900/50 rounded-lg px-3 py-1.5">
          <p className="font-mono text-xs text-zinc-300 whitespace-pre-wrap">{msg.text}</p>
        </div>
      );

    case "agent_tool_use":
      return (
        <div className="bg-blue-500/10 rounded-lg px-3 py-1.5 border border-blue-500/20">
          <p className="font-mono text-[0.6rem] text-blue-400">
            {msg.tool} <span className="text-zinc-500">{msg.input?.slice(0, 100)}</span>
          </p>
        </div>
      );

    case "result":
      return msg.is_error ? (
        <div className="bg-destructive/10 rounded-lg px-3 py-1.5">
          <p className="font-mono text-xs text-destructive">{msg.text}</p>
        </div>
      ) : null;

    case "save_result":
      return (
        <div className={cn(
          "rounded-lg px-3 py-1.5 flex items-center gap-1.5",
          msg.saved ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-yellow-500/10 border border-yellow-500/20"
        )}>
          {msg.saved ? <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" /> : <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />}
          <p className="font-mono text-[0.6rem] text-zinc-300">{msg.message}</p>
        </div>
      );

    case "wip_saved":
      return (
        <div className="bg-yellow-500/10 rounded-lg px-3 py-1.5 border border-yellow-500/20">
          <p className="font-mono text-[0.6rem] text-yellow-400">
            {msg.message}
          </p>
        </div>
      );

    case "save_warning":
      return (
        <div className="bg-yellow-500/10 rounded-lg px-3 py-1.5">
          <p className="font-mono text-[0.6rem] text-yellow-400">{msg.message}</p>
        </div>
      );

    case "error":
      return (
        <div className="bg-destructive/10 rounded-lg px-3 py-1.5">
          <p className="font-mono text-[0.6rem] text-destructive">{msg.message}</p>
        </div>
      );

    case "cost_update":
      return null; // handled by the header

    case "status":
      if (msg.status === "closed") {
        return (
          <div className="text-center py-2">
            <p className="font-mono text-[0.6rem] text-zinc-500">Sesion cerrada</p>
          </div>
        );
      }
      return null;

    default:
      return null;
  }
}
