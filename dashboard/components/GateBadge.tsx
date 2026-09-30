"use client";

import React from "react";
import { Loader2, ShieldAlert } from "lucide-react";

interface GateBadgeProps {
  category: string;
  source?: string;
  reason?: string;
  piiHits?: string[];
  signals?: string[];
  flags?: string[];
  contextUsed?: {
    neighbours?: number;
    corrections?: number;
  };
}

export function GateBadge({
  category,
  source,
  reason,
  piiHits,
  signals,
  flags,
  contextUsed,
}: GateBadgeProps) {
  const cat = (category || "private").toLowerCase();
  const isPending = source === "pending";

  const getStyle = () => {
    if (isPending) {
      return "bg-amber-950/30 text-amber-400 border-amber-800/50";
    }
    switch (cat) {
      case "shareable":
        return "bg-sky-950/30 text-sky-400 border-sky-800/40";
      case "private":
        return "bg-rose-950/30 text-rose-400 border-rose-800/40";
      case "routine":
        return "bg-slate-800/40 text-slate-400 border-slate-700/40";
      default:
        return "bg-slate-800/40 text-slate-400 border-slate-700/40";
    }
  };

  // Gate explanation (spec §8.4): signals and how much on-device context was used
  const explain = [
    signals && signals.length > 0 ? `Signals: ${signals.join(", ")}` : null,
    contextUsed && (contextUsed.neighbours !== undefined || contextUsed.corrections !== undefined)
      ? `Used ${contextUsed.neighbours ?? 0} similar notes, ${contextUsed.corrections ?? 0} corrections`
      : null,
  ].filter(Boolean).join("\n");

  return (
    <div className="flex flex-col gap-1 max-w-xs" title={explain || undefined}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono uppercase font-medium border ${getStyle()}`}
        >
          {isPending ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
              <span>CLASSIFYING…</span>
            </>
          ) : (
            <>
              <span>{cat}</span>
              {source && (
                <span className="opacity-60 text-[10px] border-l border-current pl-1 ml-0.5">
                  {source}
                </span>
              )}
            </>
          )}
        </span>

        {/* PII hits */}
        {piiHits && piiHits.length > 0 && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-rose-950/40 border border-rose-800/40 text-rose-300 rounded flex items-center gap-1">
            <ShieldAlert className="w-3 h-3 text-rose-400" />
            <span>rule:{piiHits.join(",")}</span>
          </span>
        )}

        {/* Veto flags (rule_hit is already shown by the PII chip) */}
        {flags && flags.filter((f) => f.endsWith("_veto")).map((flag) => (
          <span
            key={flag}
            className="text-[10px] font-mono px-1.5 py-0.5 bg-amber-950/40 border border-amber-800/40 text-amber-400 rounded"
          >
            veto:{flag.replace("_veto", "")}
          </span>
        ))}
        {flags?.includes("llm_unavailable") && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-amber-950/40 border border-amber-800/40 text-amber-400 rounded">
            llm offline · kept private
          </span>
        )}
      </div>

      {/* Reason or signals */}
      {reason && (
        <span className="text-[11px] text-slate-400 line-clamp-1 italic">
          {reason}
        </span>
      )}
    </div>
  );
}
