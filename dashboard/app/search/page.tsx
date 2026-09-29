"use client";

import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { fetchEdge } from "@/lib/api";
import { GateBadge } from "@/components/GateBadge";
import { Search, Zap, Layers, Hash, Clock, Cpu } from "lucide-react";

const DEMO_QUERIES = [
  "pump making noise",
  "P-200",
  "pump vibration after bearing change",
  "C-14 trips on high temp",
  "torque spec panel B",
];

export default function SearchPlayground() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"hybrid" | "dense" | "bm25">("hybrid");
  const [assetTagFilter, setAssetTagFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const searchMutation = useMutation({
    mutationFn: (searchParams: any) =>
      fetchEdge("/search", {
        method: "POST",
        body: JSON.stringify(searchParams),
      }),
  });

  const handleSearch = (e?: React.FormEvent, customQuery?: string, customMode?: "hybrid" | "dense" | "bm25") => {
    if (e) e.preventDefault();
    const q = customQuery !== undefined ? customQuery : query;
    const m = customMode !== undefined ? customMode : mode;
    if (!q.trim()) return;

    searchMutation.mutate({
      q,
      mode: m,
      asset_tag: assetTagFilter || null,
      category: categoryFilter || null,
      limit: 10,
    });
  };

  const results = searchMutation.data?.results || [];
  const latency = searchMutation.data?.latency_ms;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
            Search Playground
          </h1>
          <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[10px]">
            &lt;10ms Offline RRF
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Execute offline hybrid search (Dense 384 + BM25 with Reciprocal Rank Fusion) across private and shared shards.
        </p>
      </div>

      {/* Query Bar & Controls */}
      <div className="panel p-4 sm:p-5 space-y-4">
        <form onSubmit={(e) => handleSearch(e)} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask a technical maintenance question (e.g. pump cavitation, P-200, torque)..."
              className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500 transition-colors font-sans"
            />
          </div>

          <button
            type="submit"
            disabled={searchMutation.isPending || !query.trim()}
            className="px-4 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs transition-colors disabled:opacity-40 shrink-0 cursor-pointer shadow-xs"
          >
            {searchMutation.isPending ? "Searching..." : "Search"}
          </button>
        </form>

        {/* Quick Demo Chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs">
          <span className="text-slate-500 text-[11px] font-mono mr-1">Examples:</span>
          {DEMO_QUERIES.map((dq) => (
            <button
              key={dq}
              type="button"
              onClick={() => {
                setQuery(dq);
                handleSearch(undefined, dq);
              }}
              className="px-2 py-0.5 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white text-[11px] border border-slate-800 hover:border-slate-700 transition-colors font-mono cursor-pointer"
            >
              {dq}
            </button>
          ))}
        </div>

        {/* Mode Switcher & Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border">
          {/* Mode Switcher */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-900 border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setMode("hybrid");
                if (query) handleSearch(undefined, undefined, "hybrid");
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs transition-colors ${
                mode === "hybrid"
                  ? "bg-slate-800 text-white font-medium"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Zap className="w-3 h-3 text-sky-400" />
              <span>Hybrid (RRF)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("dense");
                if (query) handleSearch(undefined, undefined, "dense");
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs transition-colors ${
                mode === "dense"
                  ? "bg-slate-800 text-white font-medium"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Layers className="w-3 h-3 text-slate-400" />
              <span>Dense Only</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("bm25");
                if (query) handleSearch(undefined, undefined, "bm25");
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs transition-colors ${
                mode === "bm25"
                  ? "bg-slate-800 text-white font-medium"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Hash className="w-3 h-3 text-slate-400" />
              <span>BM25 Only</span>
            </button>
          </div>

          {/* Asset tag filter */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={assetTagFilter}
              onChange={(e) => setAssetTagFilter(e.target.value)}
              placeholder="Filter asset..."
              className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono uppercase text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500 w-32"
            />
          </div>
        </div>
      </div>

      {/* Latency & Results Banner */}
      {latency && (
        <div className="panel px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-4 text-slate-400">
            <span>
              Returned: <strong className="text-white font-semibold">{results.length}</strong> hits
            </span>
            <span>
              Mode: <strong className="text-sky-400 uppercase font-semibold">{mode}</strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-slate-400">
              <Cpu className="w-3 h-3 text-slate-500" />
              <span>Embed: <strong className="text-slate-200">{latency.embed}ms</strong></span>
            </span>
            <span className="flex items-center gap-1 text-slate-400">
              <Zap className="w-3 h-3 text-slate-500" />
              <span>Search: <strong className="text-slate-200">{latency.search}ms</strong></span>
            </span>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/30 border border-emerald-800/40 text-emerald-400 font-medium">
              <Clock className="w-3 h-3" />
              <span>Total: {latency.total}ms</span>
            </span>
          </div>
        </div>
      )}

      {/* Results List */}
      <div className="space-y-3">
        {results.length > 0 ? (
          results.map((hit: any, idx: number) => (
            <div
              key={hit.id}
              className="panel p-4 hover:border-slate-700 transition-colors space-y-2 group"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded bg-slate-800 font-mono text-[10px] font-semibold flex items-center justify-center text-slate-400">
                    #{idx + 1}
                  </span>
                  {hit.title && (
                    <span className="font-semibold text-xs text-slate-100">
                      {hit.title}
                    </span>
                  )}
                  {hit.asset_tag && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono font-medium text-slate-300 border border-slate-700">
                      {hit.asset_tag}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-slate-400">
                    score: <strong className="text-sky-400 font-medium">{hit.score}</strong>
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed font-sans">
                {hit.text}
              </p>

              <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px]">
                <GateBadge
                  category={hit.category}
                  source={hit.gate_source}
                  reason={hit.gate_reason}
                  piiHits={hit.pii_hits}
                  signals={hit.gate_signals}
                  flags={hit.gate_flags}
                  contextUsed={hit.gate_context}
                />
                <span className="font-mono text-slate-500 text-[10px]">
                  Origin: {hit.device_id || "device-a"} · v{hit.version || 1}
                </span>
              </div>
            </div>
          ))
        ) : searchMutation.isSuccess ? (
          <div className="panel p-8 text-center text-slate-400 text-xs">
            No memories matched your query or filters.
          </div>
        ) : null}
      </div>
    </div>
  );
}
