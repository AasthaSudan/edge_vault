"use client";

import React from "react";

interface GateBadgeProps {
  category: string;
  source?: string;
  reason?: string;
  piiHits?: string[];
}

export function GateBadge({ category, source, reason, piiHits }: GateBadgeProps) {
  const cat = (category || "private").toLowerCase();

  const getStyle = () => {
    switch (cat) {
      case "shareable":
        return "bg-sky-500/10 text-sky-400 border-sky-500/30";
      case "private":
        return "bg-rose-500/10 text-rose-400 border-rose-500/30";
      case "routine":
        return "bg-amber-500/10 text-amber-400 border-amber-500/30";
      default:
        return "bg-slate-500/10 text-slate-400 border-slate-500/30";
    }
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wider font-semibold border ${getStyle()}`}
        >
          {cat}
          {source && (
            <span className="opacity-75 font-normal ml-1 border-l border-current pl-1 text-[10px]">
              {source}
            </span>
          )}
        </span>
        {piiHits && piiHits.length > 0 && (
          <span className="text-[10px] font-mono px-1.5 py-0.2 bg-red-950/60 border border-red-800 text-red-300 rounded">
            rule:{piiHits.join(",")}
          </span>
        )}
      </div>
      {reason && (
        <span className="text-[11px] text-muted-foreground line-clamp-1 italic">
          {reason}
        </span>
      )}
    </div>
  );
}
