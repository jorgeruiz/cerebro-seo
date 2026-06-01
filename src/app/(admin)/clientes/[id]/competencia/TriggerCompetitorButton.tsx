"use client";

import { useTransition } from "react";
import { Zap, Loader2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { actionTriggerCompetitorAnalysis } from "./actions";

export function TriggerCompetitorButton({ clientId }: { clientId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await actionTriggerCompetitorAnalysis(clientId);
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
          Encolando...
        </>
      ) : (
        <>
          <Zap className="h-3.5 w-3.5" />
          Analizar ahora
        </>
      )}
    </button>
  );
}
