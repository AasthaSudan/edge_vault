"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchEdge } from "@/lib/api";
import { Cpu } from "lucide-react";

export const LlmStatus: React.FC = () => {
  const { data, isError } = useQuery({
    queryKey: ["llm-status"],
    queryFn: () => fetchEdge("/llm/status"),
    refetchInterval: 5000,
  });

  if (isError || !data) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-400 text-xs font-mono">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        <span className="hidden sm:inline">LLM Standby</span>
        <span className="sm:hidden">Offline</span>
      </div>
    );
  }

  const modelName = data.model || "qwen2.5:1.5b";

  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300 text-xs font-mono">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
      <span>{modelName}</span>
      {data.stats?.p95_ms && (
        <span className="text-slate-500 hidden md:inline">({data.stats.p95_ms}ms)</span>
      )}
    </div>
  );
};
