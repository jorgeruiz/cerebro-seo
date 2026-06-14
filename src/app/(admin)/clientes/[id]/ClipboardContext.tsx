"use client";

/**
 * ClipboardContext — Portapapeles de estrategia por cliente.
 *
 * EN MEMORIA. No persiste en BD, localStorage ni sessionStorage.
 * Se pierde al salir del cliente o cerrar la pestaña — por diseño.
 * El ClipboardProvider se monta en el layout del cliente ([id]/layout.tsx)
 * y se desmonta al cambiar de cliente (key={clientId}).
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";

// ─── Tipos ─────────────────────────────────────────────────────────────────

export type ClipboardItemType = "keyword" | "aeo_cluster" | "content_idea";

export interface ClipboardItem {
  id: string;
  type: ClipboardItemType;
  label: string;   // texto de display y clave de dedup
  payload: string; // markdown listo para pegar en Cerebro
}

interface ClipboardContextValue {
  items: ClipboardItem[];
  count: number;
  hasItem: (label: string, type: ClipboardItemType) => boolean;
  toggleItem: (item: Omit<ClipboardItem, "id">) => void;
  removeItem: (id: string) => void;
  clear: () => void;
}

// ─── Context ────────────────────────────────────────────────────────────────

const ClipboardCtx = createContext<ClipboardContextValue | null>(null);

export function useClipboard(): ClipboardContextValue {
  const ctx = useContext(ClipboardCtx);
  if (!ctx) throw new Error("useClipboard debe usarse dentro de ClipboardProvider");
  return ctx;
}

// ─── ID helper ──────────────────────────────────────────────────────────────

let _seq = 0;
function uid() {
  return `clip_${Date.now()}_${++_seq}`;
}

// ─── Provider ───────────────────────────────────────────────────────────────

interface ProviderProps {
  children: ReactNode;
  clientId: string;
}

export function ClipboardProvider({ children, clientId }: ProviderProps) {
  const [items, setItems] = useState<ClipboardItem[]>([]);

  // Resetear items cuando cambia el cliente (defensa adicional al key= del layout)
  useEffect(() => {
    setItems([]);
  }, [clientId]);

  // Guard beforeunload: aviso nativo del navegador cuando hay items pendientes
  useEffect(() => {
    if (items.length === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [items.length]);

  // ─── Métodos ──────────────────────────────────────────────────────────────

  function hasItem(label: string, type: ClipboardItemType): boolean {
    return items.some((i) => i.label === label && i.type === type);
  }

  function toggleItem(item: Omit<ClipboardItem, "id">) {
    const existing = items.find(
      (i) => i.label === item.label && i.type === item.type
    );
    if (existing) {
      setItems((prev) => prev.filter((i) => i.id !== existing.id));
    } else {
      setItems((prev) => [...prev, { ...item, id: uid() }]);
    }
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function clear() {
    setItems([]);
  }

  return (
    <ClipboardCtx.Provider
      value={{ items, count: items.length, hasItem, toggleItem, removeItem, clear }}
    >
      {children}
    </ClipboardCtx.Provider>
  );
}
