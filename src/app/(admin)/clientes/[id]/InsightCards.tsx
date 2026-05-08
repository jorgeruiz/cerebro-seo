"use client";

import { AlertCircle, TrendingUp, Trophy, Info } from "lucide-react";

type InsightType = "OPPORTUNITY" | "WARNING" | "WIN" | "INFO";

interface Insight {
  id: string;
  type: InsightType;
  severity: string;
  title: string;
  description: string;
  suggestedAction?: string | null;
}

const TYPE_CONFIG: Record<InsightType, { icon: typeof AlertCircle; bg: string; border: string; icon_color: string }> = {
  WARNING: {
    icon: AlertCircle,
    bg: "bg-red-50",
    border: "border-red-100",
    icon_color: "text-red-500",
  },
  OPPORTUNITY: {
    icon: TrendingUp,
    bg: "bg-green-50",
    border: "border-green-100",
    icon_color: "text-green-500",
  },
  WIN: {
    icon: Trophy,
    bg: "bg-yellow-50",
    border: "border-yellow-100",
    icon_color: "text-yellow-500",
  },
  INFO: {
    icon: Info,
    bg: "bg-blue-50",
    border: "border-blue-100",
    icon_color: "text-blue-500",
  },
};

export function InsightCards({ insights }: { insights: Insight[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {insights.map((insight) => {
        const config = TYPE_CONFIG[insight.type];
        const Icon = config.icon;
        return (
          <div
            key={insight.id}
            className={`rounded-xl border ${config.border} ${config.bg} p-4`}
          >
            <div className="flex items-start gap-3">
              <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.icon_color}`} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 leading-snug">{insight.title}</p>
                <p className="text-xs text-gray-600 mt-1 leading-relaxed">{insight.description}</p>
                {insight.suggestedAction && (
                  <p className="text-xs font-medium text-gray-700 mt-2">
                    → {insight.suggestedAction}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
