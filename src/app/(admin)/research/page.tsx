import { ResearchPanel } from "./ResearchPanel";

export const metadata = {
  title: "Research — Cerebro SEO",
};

export default function ResearchPage() {
  return (
    <div className="min-h-full">
      <div className="p-4 sm:p-6 lg:p-8 space-y-8">
        <div>
          <h1 className="font-display font-extrabold text-[clamp(1.6rem,2.5vw,2.4rem)] tracking-tight leading-[1.05] text-foreground">
            Research
          </h1>
          <p className="font-mono text-[0.75rem] text-muted-foreground mt-1">
            Investiga keywords o dominios sin necesidad de un cliente configurado
          </p>
        </div>
        <ResearchPanel />
      </div>
    </div>
  );
}
