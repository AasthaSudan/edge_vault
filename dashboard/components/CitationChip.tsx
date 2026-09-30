"use client";

import React from "react";
import Link from "next/link";
import { Source } from "@/lib/stream";

interface CitationChipProps {
  n: number;
  source?: Source;
  onClick?: (source?: Source) => void;
}

export const CitationChip: React.FC<CitationChipProps> = ({ n, source, onClick }) => {
  const category = source?.category || "shareable";
  const origin = source?.origin || "this device";

  const getBadgeStyle = () => {
    switch (category) {
      case "private":
        return "bg-rose-950/40 border-rose-800/50 text-rose-300 hover:bg-rose-900/50";
      case "routine":
        return "bg-slate-800/50 border-slate-700/50 text-slate-400 hover:bg-slate-700/50";
      case "shareable":
      default:
        if (source?.fleet_verified) {
          return "bg-emerald-950/40 border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/50";
        }
        return "bg-sky-950/40 border-sky-800/50 text-sky-300 hover:bg-sky-900/50";
    }
  };

  const verifiedBy = source?.corroborated_by?.length ?? 0;
  const label =
    category === "private"
      ? "Private"
      : category === "routine"
      ? "Routine"
      : source?.fleet_verified
      ? `Fleet verified · ${verifiedBy} devices`
      : `Fleet · ${origin}`;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={() => onClick(source)}
        title={source?.title ? `${source.title} (${category})` : `Note #${n}`}
        className={`inline-flex items-center gap-1 px-1.5 py-0.2 mx-0.5 rounded text-[11px] font-mono border font-medium cursor-pointer transition-colors ${getBadgeStyle()}`}
      >
        <span>[{n}]</span>
        <span className="text-[10px] opacity-80">{label}</span>
      </button>
    );
  }

  return (
    <Link
      href={`/memories?id=${source?.memory_id || ""}`}
      title={source?.title ? `${source.title} (${category})` : `Note #${n}`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.2 mx-0.5 rounded text-[11px] font-mono border font-medium cursor-pointer transition-colors ${getBadgeStyle()}`}
    >
      <span>[{n}]</span>
      <span className="text-[10px] opacity-80">{label}</span>
    </Link>
  );
};
