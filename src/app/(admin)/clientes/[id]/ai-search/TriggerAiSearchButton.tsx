"use client";

import { useTransition } from "react";
import { Zap, Loader2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { actionTriggerAiSearch } from "./actions";

export function TriggerAiSearchButton({ clientId }: { clientId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await actionTriggerAiSearch(clientId);
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className={buttonVariants({ variant: "outline-mono", size: "sm" }) + " gap-1.5"}
    >
      {isPending ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Consultando LLMs...
        </>
      ) : (
        <>
          <Zap className="h-3.5 w-3.5" />
          Medir ahora
        </>
      )}
    </button>
  );
}
