"use client";

import { useTransition, useState } from "react";
import { Plus, Check, Loader2 } from "lucide-react";
import { actionCreateKeyword } from "../configuracion/actions";

export function AddKeywordButton({
  clientId,
  keyword,
}: {
  clientId: string;
  keyword: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [added, setAdded] = useState(false);

  if (added) {
    return (
      <span className="inline-flex items-center justify-center h-6 w-6 rounded text-ds-green">
        <Check className="h-3 w-3" />
      </span>
    );
  }

  return (
    <button
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await actionCreateKeyword({
            clientId,
            term: keyword,
            isPriority: false,
            country: "MX",
            language: "es",
          });
          setAdded(true);
        });
      }}
      className="inline-flex items-center justify-center h-6 w-6 rounded border border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground transition-colors disabled:opacity-50"
    >
      {isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Plus className="h-3 w-3" />
      )}
    </button>
  );
}
