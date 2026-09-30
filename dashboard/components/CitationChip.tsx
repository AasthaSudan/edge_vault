"use client";

import React from "react";
import { Source } from "@/lib/stream";
import { category } from "@/lib/format";
import { cn } from "./ui";

// Inline numbered reference inside an answer; opens the source it points to.
export function CitationChip({
  n,
  source,
  onClick,
}: {
  n: number;
  source?: Source;
  onClick: (source: Source) => void;
}) {
  const c = category(source?.category);
  const title = source
    ? `${source.title || "Untitled note"} · ${c.label}${source.fleet_verified ? " · confirmed by other devices" : ""}`
    : `Source ${n}`;

  return (
    <button
      type="button"
      disabled={!source}
      onClick={() => source && onClick(source)}
      title={title}
      className={cn(
        "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 mx-0.5 rounded-md align-[2px]",
        "text-[11px] font-semibold leading-none text-fg border border-transparent transition-colors hover:border-line-strong",
        c.soft
      )}
    >
      {n}
    </button>
  );
}
