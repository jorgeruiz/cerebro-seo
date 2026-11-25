"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Loader2,
  CheckCircle2,
  Pencil,
  Bot,
  User,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

interface Message {
  id?: string;
  role: "user" | "assistant" | "tool_use" | "tool_result";
  content: string;
  created_at?: string;
}

interface ChangeSummary {
  version: number;
  items: Array<{
    section: string;
    change_type: string;
    description: string;
    priority?: string;
  }>;
  general_notes?: string;
}

interface CreatedCR {
  id: string;
  request_code: string;
}

interface AgentChatPanelProps {
  clientId: string;
  onClose?: () => void;
}

export function AgentChatPanel({ clientId, onClose }: AgentChatPanelProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [pendingSummary, setPendingSummary] = useState<ChangeSummary | null>(
    null,
  );
  const [createdCR, setCreatedCR] = useState<CreatedCR | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming]);

  // Create conversation on mount
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const res = await fetch("/api/agent-chat/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId }),
        });
        if (!res.ok) {
          const d = await res.json();
          if (!cancelled) setError(d.error ?? "Error creando conversacion");
          return;
        }
        const data = await res.json();
        if (!cancelled) setConversationId(data.id);
      } catch {
        if (!cancelled) setError("Error de conexion");
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const sendMessage = useCallback(async () => {
    if (!conversationId || !input.trim() || streaming) return;

    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setStreaming(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/agent-chat/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: userMsg }),
        },
      );

      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "Error" }));
        setError(d.error ?? `Error ${res.status}`);
        setStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setStreaming(false);
        return;
      }

      const decoder = new TextDecoder();
      let assistantText = "";
      let buffer = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      const processEvent = (
        event: string,
        data: Record<string, unknown>,
      ) => {
        switch (event) {
          case "text": {
            assistantText += data.text as string;
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant") {
                copy[copy.length - 1] = { ...last, content: assistantText };
              }
              return copy;
            });
            break;
          }
          case "tool_result": {
            const result = data.result as string;
            try {
              const parsed = JSON.parse(result);
              if (parsed.type === "change_summary") {
                setPendingSummary(parsed as ChangeSummary);
              } else if (parsed.type === "change_request_created") {
                setCreatedCR({
                  id: parsed.id,
                  request_code: parsed.request_code,
                });
              }
            } catch {
              /* non-JSON tool result */
            }
            break;
          }
          case "error": {
            setError(data.error as string);
            break;
          }
          case "done":
            break;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              processEvent(currentEvent, data);
            } catch {
              /* skip malformed */
            }
            currentEvent = "";
          }
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error de conexion",
      );
    } finally {
      setStreaming(false);
    }
  }, [conversationId, input, streaming]);

  // Confirm summary -> send "si" to trigger submit
  const confirmSummary = useCallback(() => {
    if (!pendingSummary) return;
    setInput("Si, confirmo.");
    setPendingSummary(null);
    setTimeout(() => {
      const textarea = inputRef.current;
      if (textarea) {
        const form = textarea.closest("form");
        form?.requestSubmit();
      }
    }, 50);
  }, [pendingSummary]);

  const editSummary = useCallback(() => {
    setPendingSummary(null);
    setInput("Quiero ajustar el resumen: ");
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-card rounded-xl border border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            Agente de Cambios
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
      >
        {messages.length === 0 && !error && (
          <p className="text-sm text-center py-8 text-muted-foreground">
            Describe el cambio que necesitas para el sitio web.
          </p>
        )}

        {messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((msg, i) => (
            <div
              key={i}
              className={`flex gap-2 ${msg.role === "user" ? "justify-end" : ""}`}
            >
              {msg.role === "assistant" && (
                <div className="flex-shrink-0 mt-0.5">
                  <Bot className="size-4 text-primary" />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground",
                )}
              >
                {msg.content ||
                  (streaming && i === messages.length - 1 ? "..." : "")}
              </div>
              {msg.role === "user" && (
                <div className="flex-shrink-0 mt-0.5">
                  <User className="size-4 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}

        {streaming && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Procesando...
          </div>
        )}

        {/* Summary card */}
        {pendingSummary && !createdCR && (
          <div className="rounded-lg p-3 space-y-2 border border-primary/30 bg-primary/5">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Resumen de cambios
            </p>
            {pendingSummary.items.map((item, i) => (
              <div
                key={i}
                className={cn(
                  "text-sm pb-1.5 last:pb-0",
                  i < pendingSummary.items.length - 1
                    ? "border-b border-border"
                    : "",
                )}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {item.change_type}
                </span>
                <span className="mx-1 text-muted-foreground/50">
                  &middot;
                </span>
                <span className="font-medium text-foreground">
                  {item.section}
                </span>
                <p className="mt-0.5 text-muted-foreground">
                  {item.description}
                </p>
              </div>
            ))}
            {pendingSummary.general_notes && (
              <p className="text-xs italic text-muted-foreground">
                {pendingSummary.general_notes}
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={confirmSummary}
                className={cn(
                  buttonVariants({ variant: "default", size: "sm" }),
                  "h-7 text-xs gap-1",
                )}
              >
                <CheckCircle2 className="size-3" />
                Confirmar y enviar
              </button>
              <button
                onClick={editSummary}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "h-7 text-xs gap-1",
                )}
              >
                <Pencil className="size-3" />
                Editar
              </button>
            </div>
          </div>
        )}

        {/* CR created */}
        {createdCR && (
          <div className="rounded-lg p-3 space-y-1 border border-emerald-500/30 bg-emerald-500/5">
            <p className="text-sm font-semibold text-emerald-600">
              <CheckCircle2 className="size-4 inline mr-1" />
              Solicitud {createdCR.request_code} creada
            </p>
            <p className="text-xs text-muted-foreground">
              El equipo la procesara en Constructor.
            </p>
          </div>
        )}

        {error && (
          <div className="text-xs rounded-lg px-3 py-2 bg-destructive/10 text-destructive">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="px-3 py-2 flex gap-2 items-end border-t border-border"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            createdCR
              ? "Solicitud enviada. Cierra para abrir otra."
              : "Describe el cambio..."
          }
          disabled={streaming || !conversationId || !!createdCR}
          rows={1}
          className="flex-1 resize-none rounded-lg px-3 py-2 text-sm focus:outline-none disabled:opacity-50 bg-background border border-border text-foreground placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={
            streaming ||
            !input.trim() ||
            !conversationId ||
            !!createdCR
          }
          className={cn(
            buttonVariants({ variant: "default", size: "sm" }),
            "h-9 w-9 p-0 shrink-0",
          )}
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
